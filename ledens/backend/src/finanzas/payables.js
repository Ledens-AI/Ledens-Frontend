// Cuentas por pagar (Gestión financiera → Cuentas por pagar, migration 034).
// What the company owes and has not paid yet:
//  - jornales: every day that passes, each active worker with a daily pay who
//    worked that day accrues one payable of their daily pay (ledens.employees.daily_pay).
//    Monday–Friday are worked unless marked otherwise; Saturdays only when marked
//    (optional, each worker decides). `generate()` is idempotent (one jornal per
//    worker and day, unique index) and runs every hour and on every read.
//  - manual: anything else, entered by hand, with project, amount, due date…
// Only admins: daily pay is personal data (WorkersService hides it from jefes).
// Nothing here counts in profitability: it is the forecast of what has to be paid
// at the end of the week (workers paid weekly) or of the month (paid monthly).
import {uuid} from '../finance/service.js';
import {FinError} from './service.js';

export const FREQUENCIES=['semanal','mensual'];
export const PAYABLE_STATUSES=['pendiente','pagada','anulada'];
const DATE=/^\d{4}-\d{2}-\d{2}$/;

// Dates are 'YYYY-MM-DD' strings, computed in UTC so no timezone shifts them.
export const madridToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const addDays=(s,n)=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
export const isoDow=(s)=>{const g=new Date(s+'T00:00:00Z').getUTCDay();return g===0?7:g;};
export const mondayOf=(s)=>addDays(s,1-isoDow(s));
export const monthEnd=(s)=>{const [y,m]=s.split('-').map(Number);return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);};
const validDate=(s)=>typeof s==='string'&&DATE.test(s)&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const fmt=(s)=>s?`${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)}`:'—';
const cents=(v)=>{const t=String(v??'').trim().replace(/\s|€/g,'');const n=t.includes(',')?t.replace(/\./g,'').replace(',','.'):t;return /^\d{1,9}(\.\d{1,2})?$/.test(n)&&Number(n)>0?n:null;};
const text=(v,max,label,required=false)=>{
 const s=typeof v==='string'?v.trim():v==null?'':null;
 if(s===null||s.length>max)throw new FinError(400,`${label} no válido (máximo ${max} caracteres)`);
 if(required&&!s)throw new FinError(400,`${label} es obligatorio`);
 return s||null;
};

// Due date of a jornal: Saturday of its week (semanal) or last day of its month (mensual).
const DUE=(d,f)=>`CASE WHEN ${f}='mensual' THEN (date_trunc('month',${d})+interval '1 month'-interval '1 day')::date ELSE (date_trunc('week',${d})+interval '5 days')::date END`;
// Every day in [from, to] that accrues a jornal for a worker, from the calendar and
// the worker's settings (never from existing payables).
const ACCRUAL=(from,to)=>`SELECT e.id employee_id,d::date work_date,round(e.daily_pay,2) amount,coalesce(s.frequency,'semanal') frequency,e.name
 FROM ledens.employees e
 LEFT JOIN ledens.worker_pay_settings s ON s.employee_id=e.id
 CROSS JOIN ledens.payables_config c
 CROSS JOIN LATERAL generate_series(greatest(coalesce(s.starts_on,c.jornales_desde),${from}::date)::timestamp,${to}::date::timestamp,interval '1 day') d
 LEFT JOIN ledens.worker_attendance a ON a.employee_id=e.id AND a.work_date=d::date
 WHERE coalesce(e.activo,true) AND e.daily_pay>0 AND coalesce(s.accrues,true) AND coalesce(a.works,extract(isodow FROM d)<=5)`;

const SELECT=`SELECT p.id,p.origin,p.employee_id,e.name employee,p.work_date::text work_date,p.project_id,pr.name project,pr.project_id project_code,
 p.concept,p.counterparty,p.amount::text amount,p.due_on::text due_on,p.status,p.paid_on::text paid_on,p.notes,p.created_at,p.updated_at,
 coalesce(s.frequency,CASE WHEN p.origin='jornal' THEN 'semanal' END) frequency,md5(to_jsonb(p)::text) version
 FROM ledens.payables p LEFT JOIN ledens.employees e ON e.id=p.employee_id LEFT JOIN ledens.projects pr ON pr.id=p.project_id
 LEFT JOIN ledens.worker_pay_settings s ON s.employee_id=p.employee_id`;

export class PayablesService {
 constructor(pool,user={role:'client',id:null},{today=madridToday}={}){this.pool=pool;this.user=user;this.today=today;}
 access(){if(this.user.role!=='admin')throw new FinError(403,'Solo un administrador puede ver las cuentas por pagar');}
 async transaction(fn){const c=await this.pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 async audit(c,action,target,detail){
  await c.query('INSERT INTO public.audit_log(actor_id,actor_label,action,target_label,detail) VALUES($1,$2,$3,$4,$5)',
   [this.user.id||null,this.user.name||this.user.email||this.user.label||'Administrador',action,target,String(detail||'').slice(0,2000)]);
 }

 // The automation: one jornal per worker and past day that accrues, up to yesterday
 // (a day is owed once it has passed). Safe to run any number of times at once.
 // Attendance and settings changes take the same lock, so a jornal is never
 // generated from attendance another transaction is about to change.
 async generate(db=this.pool){
  if(db===this.pool)return this.transaction((c)=>this.generate(c));
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('ledens-payables-jornales',0))");
  const r=await db.query(`INSERT INTO ledens.payables(origin,employee_id,work_date,concept,counterparty,amount,due_on)
   SELECT 'jornal',x.employee_id,x.work_date,'Jornal '||to_char(x.work_date,'DD/MM/YYYY'),x.name,x.amount,${DUE('x.work_date','x.frequency')}
   FROM (${ACCRUAL("'2000-01-01'",'$1')}) x
   ON CONFLICT (employee_id,work_date) WHERE origin='jornal' DO NOTHING`,[addDays(this.today(),-1)]);
  return r.rowCount??r.affectedRows??0;
 }

 // ── Jornales: workers × days ────────────────────────────────────────────────
 async grid({desde,periodo='semana'}={}){
  this.access();
  if(!['semana','mes'].includes(periodo))throw new FinError(400,'Periodo no válido');
  const today=this.today();
  const ref=desde===undefined||desde===''?today:desde;
  if(!validDate(ref))throw new FinError(400,'Fecha no válida');
  await this.generate();
  const from=periodo==='semana'?mondayOf(ref):ref.slice(0,8)+'01';
  const to=periodo==='semana'?addDays(from,5):monthEnd(from);
  const days=[];for(let d=from;d<=to;d=addDays(d,1))if(isoDow(d)!==7)days.push({date:d,dow:isoDow(d),past:d<today,today:d===today});
  const config=(await this.pool.query('SELECT jornales_desde::text desde FROM ledens.payables_config')).rows[0];
  const workers=(await this.pool.query(`SELECT e.id,e.name,e.empleadoid code,e.daily_pay::text daily_pay,coalesce(e.activo,true) activo,
    coalesce(s.frequency,'semanal') frequency,coalesce(s.accrues,true) accrues,coalesce(s.starts_on,c.jornales_desde)::text starts_on
    FROM ledens.employees e LEFT JOIN ledens.worker_pay_settings s ON s.employee_id=e.id CROSS JOIN ledens.payables_config c
    WHERE coalesce(e.activo,true) OR EXISTS(SELECT 1 FROM ledens.payables p WHERE p.employee_id=e.id AND p.origin='jornal' AND p.work_date BETWEEN $1 AND $2)
    ORDER BY e.name,e.id`,[from,to])).rows;
  const marks=(await this.pool.query('SELECT employee_id,work_date::text d,works FROM ledens.worker_attendance WHERE work_date BETWEEN $1 AND $2',[from,to])).rows;
  const jornales=(await this.pool.query(`SELECT id,employee_id,work_date::text d,amount::text amount,status,project_id FROM ledens.payables
    WHERE origin='jornal' AND work_date BETWEEN $1 AND $2`,[from,to])).rows;
  const key=(e,d)=>e+'|'+d;
  const mark=new Map(marks.map((m)=>[key(m.employee_id,m.d),m.works]));
  const pay=new Map(jornales.map((j)=>[key(j.employee_id,j.d),j]));
  const dayTotals=Object.fromEntries(days.map((d)=>[d.date,0]));
  const rows=workers.map((w)=>{
   const pays=Number(w.daily_pay)>0,accrues=w.activo&&pays&&w.accrues;
   let devengado=0,previsto=0,pagado=0;
   const cells=days.map((d)=>{
    const explicit=mark.has(key(w.id,d.date));
    const works=explicit?mark.get(key(w.id,d.date)):d.dow<=5;
    const j=pay.get(key(w.id,d.date))||null;
    const forecast=!j&&works&&accrues&&d.date>=w.starts_on&&d.date>=today?Math.round(Number(w.daily_pay)*100)/100:null;
    if(j&&j.status!=='anulada'){devengado+=Number(j.amount);if(j.status==='pagada')pagado+=Number(j.amount);dayTotals[d.date]+=Number(j.amount);}
    if(forecast){previsto+=forecast;dayTotals[d.date]+=forecast;}
    return {date:d.date,works,explicit,payable:j?{id:j.id,amount:j.amount,status:j.status}:null,forecast};
   });
   const r2=(n)=>Math.round(n*100)/100;
   return {...w,warning:!w.activo?'De baja':!pays?'Sin pago diario':!w.accrues?'No genera jornales':null,cells,devengado:r2(devengado),pagado:r2(pagado),previsto:r2(previsto),total:r2(devengado+previsto)};
  });
  for(const d of Object.keys(dayTotals))dayTotals[d]=Math.round(dayTotals[d]*100)/100;
  return {from,to,periodo,today,jornalesDesde:config?.desde||null,days,rows,dayTotals,necesidad:await this.need(today)};
 }

 // What will be needed: weekly workers at the end of this week, monthly workers at the
 // end of this month (everything still pending + the days still to come), and the
 // manual payables.
 async need(today=this.today()){
  const weekEnd=addDays(mondayOf(today),5),mEnd=monthEnd(today);
  const pending=(await this.pool.query(`SELECT coalesce(s.frequency,'semanal') f,sum(p.amount)::text n FROM ledens.payables p
    LEFT JOIN ledens.worker_pay_settings s ON s.employee_id=p.employee_id WHERE p.origin='jornal' AND p.status='pendiente' GROUP BY 1`)).rows;
  const forecast=async(f,to)=>to<today?'0':(await this.pool.query(`SELECT coalesce(sum(x.amount),0)::text n FROM (${ACCRUAL('$1','$2')}) x
    WHERE x.frequency=$3 AND NOT EXISTS(SELECT 1 FROM ledens.payables p WHERE p.origin='jornal' AND p.employee_id=x.employee_id AND p.work_date=x.work_date)`,[today,to,f])).rows[0].n;
  const manual=(await this.pool.query(`SELECT coalesce(sum(amount),0)::text total,coalesce(sum(amount) FILTER (WHERE due_on IS NULL OR due_on<=$1),0)::text semana,
    coalesce(sum(amount) FILTER (WHERE due_on IS NULL OR due_on<=$2),0)::text mes FROM ledens.payables WHERE origin='manual' AND status='pendiente'`,[weekEnd,mEnd])).rows[0];
  const p=(f)=>pending.find((r)=>r.f===f)?.n||'0';
  return {
   semana:{hasta:weekEnd,pendiente:p('semanal'),previsto:await forecast('semanal',weekEnd)},
   mes:{hasta:mEnd,pendiente:p('mensual'),previsto:await forecast('mensual',mEnd)},
   otras:manual,
  };
 }

 // items: [{ employeeId, date, works: true | false | null }] — null goes back to the
 // calendar (Mon–Fri worked, Saturday not). A past day's jornal follows at once:
 // annulled when the day is no longer worked, reactivated or generated when it is.
 async setAttendance(items){
  this.access();
  if(!Array.isArray(items)||!items.length||items.length>500)throw new FinError(400,'Indica entre 1 y 500 días');
  const clean=items.map((i)=>{
   if(!uuid(i?.employeeId))throw new FinError(400,'Trabajador no válido');
   if(!validDate(i?.date))throw new FinError(400,'Fecha no válida');
   if(i.works!==null&&typeof i.works!=='boolean')throw new FinError(400,'Indica si trabaja ese día');
   return {employeeId:i.employeeId,date:i.date,works:i.works};
  });
  const out=await this.transaction(async(c)=>{
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('ledens-payables-jornales',0))");
   const names=new Map((await c.query('SELECT id,name FROM ledens.employees WHERE id=ANY($1::uuid[])',[[...new Set(clean.map((i)=>i.employeeId))]])).rows.map((r)=>[r.id,r.name]));
   const log=[];let annulled=0,restored=0;
   for(const i of clean){
    if(!names.has(i.employeeId))throw new FinError(404,'Trabajador no encontrado');
    const works=i.works??isoDow(i.date)<=5;
    const j=(await c.query("SELECT id,status FROM ledens.payables WHERE origin='jornal' AND employee_id=$1 AND work_date=$2 FOR UPDATE",[i.employeeId,i.date])).rows[0];
    if(j&&!works&&j.status==='pagada')throw new FinError(409,`El jornal de ${names.get(i.employeeId)} del ${fmt(i.date)} ya está pagado. Márcalo como pendiente antes de quitar ese día.`);
    if(i.works===null)await c.query('DELETE FROM ledens.worker_attendance WHERE employee_id=$1 AND work_date=$2',[i.employeeId,i.date]);
    else await c.query(`INSERT INTO ledens.worker_attendance(employee_id,work_date,works,updated_by) VALUES($1,$2,$3,$4)
     ON CONFLICT (employee_id,work_date) DO UPDATE SET works=EXCLUDED.works,updated_by=EXCLUDED.updated_by,updated_at=now()`,[i.employeeId,i.date,i.works,this.user.id||null]);
    if(j&&!works&&j.status==='pendiente'){await c.query("UPDATE ledens.payables SET status='anulada',updated_by=$2,updated_at=now() WHERE id=$1",[j.id,this.user.id||null]);annulled++;}
    if(j&&works&&j.status==='anulada'){
     // Back to the worker's current daily pay (it may have changed since).
     await c.query(`UPDATE ledens.payables p SET status='pendiente',amount=CASE WHEN e.daily_pay>0 THEN round(e.daily_pay,2) ELSE p.amount END,updated_by=$2,updated_at=now()
      FROM ledens.employees e WHERE p.id=$1 AND e.id=p.employee_id`,[j.id,this.user.id||null]);restored++;
    }
    log.push(`${names.get(i.employeeId)} ${fmt(i.date)}: ${i.works===null?'según calendario':works?'trabaja':'no trabaja'}`);
   }
   const generated=await this.generate(c);
   await this.audit(c,'Asistencia de trabajadores',`Cuentas por pagar · ${clean.length} ${clean.length===1?'día':'días'}`,log.join(' · '));
   return {updated:clean.length,annulled,restored,generated};
  });
  return out;
 }

 // { frequency: 'semanal' | 'mensual', accrues: boolean }
 async setSettings(employeeId,{frequency,accrues}={}){
  this.access();
  if(!uuid(employeeId))throw new FinError(404,'Trabajador no encontrado');
  if(frequency!==undefined&&!FREQUENCIES.includes(frequency))throw new FinError(400,'Frecuencia de pago no válida');
  if(accrues!==undefined&&typeof accrues!=='boolean')throw new FinError(400,'Indica si genera jornales');
  return this.transaction(async(c)=>{
   // Days already passed are owed under the settings they were worked with.
   await this.generate(c);
   const w=(await c.query(`SELECT e.id,e.name,coalesce(s.frequency,'semanal') frequency,coalesce(s.accrues,true) accrues FROM ledens.employees e
    LEFT JOIN ledens.worker_pay_settings s ON s.employee_id=e.id WHERE e.id=$1 FOR UPDATE OF e`,[employeeId])).rows[0];
   if(!w)throw new FinError(404,'Trabajador no encontrado');
   const f=frequency??w.frequency,a=accrues??w.accrues;
   if(f===w.frequency&&a===w.accrues)return {employeeId,frequency:f,accrues:a,changed:false};
   // Accruing again never backfills the days it was switched off.
   const restart=a&&!w.accrues?this.today():null;
   await c.query(`INSERT INTO ledens.worker_pay_settings(employee_id,frequency,accrues,starts_on,updated_by) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT (employee_id) DO UPDATE SET frequency=EXCLUDED.frequency,accrues=EXCLUDED.accrues,
     starts_on=coalesce(EXCLUDED.starts_on,ledens.worker_pay_settings.starts_on),updated_by=EXCLUDED.updated_by,updated_at=now()`,[employeeId,f,a,restart,this.user.id||null]);
   if(f!==w.frequency)await c.query(`UPDATE ledens.payables SET due_on=${DUE('work_date','$2')},updated_at=now() WHERE origin='jornal' AND employee_id=$1 AND status='pendiente'`,[employeeId,f]);
   const changes=[f!==w.frequency?`Pago: ${w.frequency} → ${f}`:null,a!==w.accrues?(a?'Vuelve a generar jornales':'Deja de generar jornales'):null].filter(Boolean);
   await this.audit(c,'Ajustes de pago de trabajador',`Trabajador ${w.name}`,changes.join(' · '));
   return {employeeId,frequency:f,accrues:a,changed:true};
  });
 }

 // ── The list ────────────────────────────────────────────────────────────────
 async list({estado='pendiente',origen='',trabajador='',proyecto='',desde='',hasta='',q='',page=1,pageSize=50}={}){
  this.access();
  await this.generate();
  const size=Math.min(200,Math.max(1,Number(pageSize)||50)),p=Math.max(1,Math.min(4000,Number(page)||1));
  const params=[],where=[];const bind=(v)=>{params.push(v);return '$'+params.length;};
  if(estado&&estado!=='todas'){if(!PAYABLE_STATUSES.includes(estado))throw new FinError(400,'Estado no válido');where.push('p.status='+bind(estado));}
  if(origen){if(!['jornal','manual'].includes(origen))throw new FinError(400,'Origen no válido');where.push('p.origin='+bind(origen));}
  if(trabajador){if(!uuid(trabajador))throw new FinError(400,'Trabajador no válido');where.push('p.employee_id='+bind(trabajador));}
  if(proyecto==='sin')where.push('p.project_id IS NULL');
  else if(proyecto){if(!uuid(proyecto))throw new FinError(400,'Proyecto no válido');where.push('p.project_id='+bind(proyecto));}
  for(const [v,op] of [[desde,'>='],[hasta,'<=']])if(v){if(!validDate(v))throw new FinError(400,'Fecha no válida');where.push(`coalesce(p.due_on,p.work_date) ${op} ${bind(v)}::date`);}
  if(q)where.push(`concat_ws(' ',p.concept,p.counterparty,e.name,pr.name,pr.project_id,p.notes) ILIKE ${bind('%'+String(q).slice(0,100)+'%')}`);
  const w=where.length?' WHERE '+where.join(' AND '):'';
  const rows=(await this.pool.query(`${SELECT}${w} ORDER BY coalesce(p.due_on,p.work_date) NULLS LAST,p.work_date,e.name,p.created_at,p.id LIMIT ${size} OFFSET ${(p-1)*size}`,params)).rows;
  const t=(await this.pool.query(`SELECT count(*)::int n,coalesce(sum(p.amount),0)::text importe FROM ledens.payables p LEFT JOIN ledens.employees e ON e.id=p.employee_id
   LEFT JOIN ledens.projects pr ON pr.id=p.project_id${w}`,params)).rows[0];
  return {rows,total:t.n,importe:t.importe,page:p,pageSize:size,necesidad:await this.need()};
 }
 async options(){
  this.access();
  const employees=(await this.pool.query('SELECT id,name FROM ledens.employees WHERE coalesce(activo,true) ORDER BY name,id')).rows;
  return {employees};
 }
 async get(c,id){return (await c.query(`${SELECT} WHERE p.id=$1`,[id])).rows[0];}
 async locked(c,id,version){
  if(!uuid(id))throw new FinError(404,'Cuenta por pagar no encontrada');
  const before=(await c.query(`${SELECT} WHERE p.id=$1 FOR UPDATE OF p`,[id])).rows[0];
  if(!before)throw new FinError(404,'Cuenta por pagar no encontrada');
  if(version!==undefined&&version!==before.version)throw new FinError(409,'Otra persona ha cambiado esta cuenta. Se han recargado los datos: revísalos y vuelve a guardar.');
  return before;
 }
 async checkRefs(c,{projectId,employeeId}){
  if(projectId&&(!uuid(projectId)||!(await c.query('SELECT 1 FROM ledens.projects WHERE id=$1',[projectId])).rows.length))throw new FinError(400,'Proyecto no válido');
  if(employeeId&&(!uuid(employeeId)||!(await c.query('SELECT 1 FROM ledens.employees WHERE id=$1',[employeeId])).rows.length))throw new FinError(400,'Trabajador no válido');
 }
 fields(body,{jornal=false}={}){
  const v={};
  const amount=cents(body?.amount);if(amount===null)throw new FinError(400,'Importe no válido (euros, mayor que cero, hasta 2 decimales)');v.amount=amount;
  v.dueOn=body?.dueOn||null;if(v.dueOn!==null&&!validDate(v.dueOn))throw new FinError(400,'Fecha de vencimiento no válida');
  v.projectId=body?.projectId||null;v.notes=text(body?.notes,1000,'Notas');
  if(!jornal){v.concept=text(body?.concept,300,'El concepto',true);v.counterparty=text(body?.counterparty,200,'Acreedor');v.employeeId=body?.employeeId||null;}
  return v;
 }
 // A manual payable: { concept, amount, counterparty?, dueOn?, projectId?, employeeId?, notes? }
 async create(body){
  this.access();
  const v=this.fields(body);
  return this.transaction(async(c)=>{
   await this.checkRefs(c,v);
   let counterparty=v.counterparty;
   if(!counterparty&&v.employeeId)counterparty=(await c.query('SELECT name FROM ledens.employees WHERE id=$1',[v.employeeId])).rows[0]?.name||null;
   const id=(await c.query(`INSERT INTO ledens.payables(origin,employee_id,project_id,concept,counterparty,amount,due_on,notes,created_by,updated_by)
    VALUES('manual',$1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id`,[v.employeeId,v.projectId,v.concept,counterparty,v.amount,v.dueOn,v.notes,this.user.id||null])).rows[0].id;
   const r=await this.get(c,id);
   await this.audit(c,'Cuenta por pagar creada',`Cuenta por pagar ${r.concept}`,`${r.amount} €${r.counterparty?` · ${r.counterparty}`:''}${r.project?` · ${r.project}`:''}${r.due_on?` · vence ${fmt(r.due_on)}`:''}`);
   return r;
  });
 }
 // A jornal keeps its worker, day and concept: only amount, due date, project and notes change.
 async update(id,body){
  this.access();
  return this.transaction(async(c)=>{
   const before=await this.locked(c,id,body?.version);
   const jornal=before.origin==='jornal';
   const v=this.fields(body,{jornal});
   if(before.status!=='pendiente'&&Number(v.amount)!==Number(before.amount))throw new FinError(409,'Solo se puede cambiar el importe de una cuenta pendiente');
   await this.checkRefs(c,v);
   const cols={amount:'amount',dueOn:'due_on',projectId:'project_id',notes:'notes',...(jornal?{}:{concept:'concept',counterparty:'counterparty',employeeId:'employee_id'})};
   const old={amount:before.amount,dueOn:before.due_on,projectId:before.project_id,notes:before.notes,concept:before.concept,counterparty:before.counterparty,employeeId:before.employee_id};
   const changed=Object.keys(cols).filter((k)=>(k==='amount'?Number(old[k])!==Number(v[k]):(old[k]??null)!==(v[k]??null)));
   if(!changed.length)return {...before,changed:false};
   await c.query(`UPDATE ledens.payables SET ${changed.map((k,i)=>cols[k]+'=$'+(i+2)).join(',')},updated_by=$${changed.length+2},updated_at=now() WHERE id=$1`,[id,...changed.map((k)=>v[k]),this.user.id||null]);
   const after=await this.get(c,id);
   const LABEL={amount:'Importe',dueOn:'Vence',projectId:'Proyecto',notes:'Notas',concept:'Concepto',counterparty:'Acreedor',employeeId:'Trabajador'};
   const show=(k,r,x)=>k==='projectId'?r.project??'—':k==='employeeId'?r.employee??'—':x??'—';
   await this.audit(c,'Cuenta por pagar editada',`Cuenta por pagar ${after.concept}`,changed.map((k)=>`${LABEL[k]}: ${show(k,before,old[k])} → ${show(k,after,v[k])}`).join(' · '));
   return {...after,changed:true};
  });
 }
 // { ids, status: 'pagada' | 'pendiente' | 'anulada', paidOn? } — all or nothing.
 async setStatus({ids,status,paidOn}={}){
  this.access();
  if(!PAYABLE_STATUSES.includes(status))throw new FinError(400,'Estado no válido');
  if(!Array.isArray(ids)||!ids.length||ids.length>200||!ids.every(uuid))throw new FinError(400,'Selecciona entre 1 y 200 cuentas');
  const day=status==='pagada'?(paidOn||this.today()):null;
  if(day&&!validDate(day))throw new FinError(400,'Fecha de pago no válida');
  return this.transaction(async(c)=>{
   const rows=(await c.query(`${SELECT} WHERE p.id=ANY($1::uuid[]) ORDER BY p.id FOR UPDATE OF p`,[[...new Set(ids)]])).rows;
   if(rows.length!==new Set(ids).size)throw new FinError(404,'Alguna cuenta ya no existe. Recarga la lista.');
   if(status==='anulada'){const j=rows.find((r)=>r.origin==='jornal');if(j)throw new FinError(409,`${j.concept} de ${j.employee}: un jornal no se anula aquí. Marca ese día como «No trabaja» en la tabla de jornales.`);}
   if(status!=='anulada'){const j=rows.find((r)=>r.origin==='jornal'&&r.status==='anulada');if(j)throw new FinError(409,`${j.concept} de ${j.employee} está anulado: marca ese día como «Trabaja» en la tabla de jornales.`);}
   const todo=rows.filter((r)=>r.status!==status);
   if(todo.length)await c.query('UPDATE ledens.payables SET status=$2,paid_on=$3,updated_by=$4,updated_at=now() WHERE id=ANY($1::uuid[])',[todo.map((r)=>r.id),status,day,this.user.id||null]);
   const total=todo.reduce((s,r)=>s+Math.round(Number(r.amount)*100),0)/100;
   const ACTION={pagada:'Cuentas por pagar pagadas',pendiente:'Cuentas por pagar pendientes de nuevo',anulada:'Cuentas por pagar anuladas'};
   if(todo.length)await this.audit(c,ACTION[status],`Cuentas por pagar · ${todo.length}`,`${total.toFixed(2)} €${day?` · pagado el ${fmt(day)}`:''} · ${todo.slice(0,20).map((r)=>`${r.concept}${r.employee?` (${r.employee})`:''}`).join(' · ')}`);
   return {updated:todo.length,importe:total.toFixed(2),status};
  });
 }
 // { ids, projectId | null }
 async setProject({ids,projectId}={}){
  this.access();
  if(!Array.isArray(ids)||!ids.length||ids.length>200||!ids.every(uuid))throw new FinError(400,'Selecciona entre 1 y 200 cuentas');
  return this.transaction(async(c)=>{
   await this.checkRefs(c,{projectId});
   const r=await c.query('UPDATE ledens.payables SET project_id=$2,updated_by=$3,updated_at=now() WHERE id=ANY($1::uuid[]) AND project_id IS DISTINCT FROM $2',[[...new Set(ids)],projectId||null,this.user.id||null]);
   const n=r.rowCount??0;
   const name=projectId?(await c.query('SELECT name FROM ledens.projects WHERE id=$1',[projectId])).rows[0]?.name:'sin proyecto';
   if(n)await this.audit(c,'Cuentas por pagar imputadas',`Cuentas por pagar · ${n}`,`Proyecto: ${name}`);
   return {updated:n};
  });
 }
}

// Called by WorkersService: a worker added, given a daily pay for the first time
// or reactivated accrues from today, never from the days before.
export async function startAccruingToday(c,employeeId,today=madridToday()){
 await c.query(`INSERT INTO ledens.worker_pay_settings(employee_id,starts_on) VALUES($1,$2)
  ON CONFLICT (employee_id) DO UPDATE SET starts_on=greatest(coalesce(ledens.worker_pay_settings.starts_on,(SELECT jornales_desde FROM ledens.payables_config)),EXCLUDED.starts_on),updated_at=now()`,[employeeId,today]);
}

// The automation in the background: once at startup and every hour. Each replica
// runs it; the unique index makes concurrent runs harmless.
export function startPayablesScheduler(pool,{everyMs=60*60*1000,log=console}={}){
 const svc=new PayablesService(pool,{role:'admin',id:null,label:'Sistema (jornales)'});
 const run=()=>svc.generate().then((n)=>{if(n)log.log(`[cuentas-por-pagar] ${n} jornales generados`);},(e)=>log.error('[cuentas-por-pagar] jornales no generados',e.code||e.message));
 run();
 const t=setInterval(run,everyMs);t.unref?.();
 return ()=>clearInterval(t);
}
