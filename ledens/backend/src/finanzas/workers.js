// Trabajadores (Gestión financiera → Trabajadores): the master list of ledens.employees.
// Admins create, edit, deactivate and reactivate; anyone else with finance access
// sees the list without the daily pay. Deactivating never deletes: worker_payments
// keep pointing at the employee, who just stops being offered for new payments.
// Rows created here have no source_id/raw_id; every change goes to audit_log.
//
// The code is never typed: a new worker takes the next EMP-<NNN> (one more than
// the highest code of that form, imported ones included, any case, with or
// without the dash) and keeps it; a code sent in a form is ignored.
import {uuid} from '../finance/service.js';
import {FinError} from './service.js';
import {startAccruingToday} from './payables.js';

const FIELDS=['name','positionId','tipo','dailyPay','hours'];
const COLUMN={code:'empleadoid',name:'name',positionId:'primary_position_id',tipo:'tipo',dailyPay:'daily_pay',hours:'horasjornada'};
const LABEL={code:'Código',name:'Nombre',positionId:'Puesto',tipo:'Tipo',dailyPay:'Pago diario',hours:'Horas por jornada'};
const NUMERIC=['dailyPay','hours'];
const SELECT=`SELECT e.id,e.empleadoid code,e.name,e.primary_position_id position_id,po.name puesto,e.tipo,e.daily_pay::text daily_pay,
 e.horasjornada::text hours,coalesce(e.activo,true) activo,(e.source_id IS NOT NULL) importado,md5(to_jsonb(e)::text) version,
 (SELECT count(*)::int FROM ledens.worker_payments w WHERE w.employee_id=e.id) pagos
 FROM ledens.employees e LEFT JOIN ledens.positions po ON po.id=e.primary_position_id`;
const same=(f,a,b)=>(NUMERIC.includes(f)&&a!==null&&b!==null?Number(a)===Number(b):(a??null)===(b??null));

export class WorkersService {
 constructor(pool,user={role:'client',id:null}){this.pool=pool;this.user=user;}
 canEdit(){return this.user.role==='admin';}
 access(){if(this.user.role==='client')throw new FinError(403,'No tienes acceso a las finanzas');}
 // Pay is personal data: only admins get it.
 view(r){return this.canEdit()?r:{...r,daily_pay:null};}
 async list({q='',estado='activos',puesto='',page=1,pageSize=25}={}){
  this.access();
  const size=Math.min(100,Math.max(1,Number(pageSize)||25)),p=Math.max(1,Math.min(4000,Number(page)||1));
  if(!['activos','bajas','todos'].includes(estado))throw new FinError(400,'Estado no válido');
  const params=['%'+String(q).slice(0,100)+'%'];const where=[`concat_ws(' ',e.empleadoid,e.name,e.tipo,po.name) ILIKE $1`];
  if(estado!=='todos')where.push(estado==='activos'?'coalesce(e.activo,true)':'NOT coalesce(e.activo,true)');
  if(puesto){if(!uuid(puesto))throw new FinError(400,'Puesto no válido');params.push(puesto);where.push('e.primary_position_id=$'+params.length);}
  const w=' WHERE '+where.join(' AND ');
  const rows=(await this.pool.query(`${SELECT}${w} ORDER BY coalesce(e.activo,true) DESC,e.name,e.id LIMIT ${size} OFFSET ${(p-1)*size}`,params)).rows.map((r)=>this.view(r));
  const total=(await this.pool.query(`SELECT count(*)::int n FROM ledens.employees e LEFT JOIN ledens.positions po ON po.id=e.primary_position_id${w}`,params)).rows[0].n;
  return {rows,total,page:p,pageSize:size,canEdit:this.canEdit()};
 }
 // One worker by its immutable id (used to reload after a conflict).
 async one(id){
  this.access();
  if(!uuid(id))throw new FinError(404,'Trabajador no encontrado');
  const r=(await this.pool.query(`${SELECT} WHERE e.id=$1`,[id])).rows[0];
  if(!r)throw new FinError(404,'Trabajador no encontrado');
  return this.view(r);
 }
 async options(){
  this.access();
  const positions=(await this.pool.query('SELECT id,name FROM ledens.positions WHERE coalesce(activo,true) ORDER BY name,id')).rows;
  return {positions,canEdit:this.canEdit(),...(this.canEdit()?{nextCode:await this.peekCode(this.pool)}:{})};
 }
 async clean(c,body){
  const v={};
  for(const f of FIELDS){const x=body?.[f];v[f]=typeof x==='string'?(x.trim()||null):(x??null);}
  if(!v.name)throw new FinError(400,'El nombre es obligatorio');
  for(const f of ['name','tipo'])if(v[f]!==null&&(typeof v[f]!=='string'||v[f].length>200))throw new FinError(400,`${LABEL[f]} no válido (máximo 200 caracteres)`);
  if(v.dailyPay!==null){v.dailyPay=String(v.dailyPay).replace(',','.');if(!/^\d{1,7}(\.\d{1,2})?$/.test(v.dailyPay))throw new FinError(400,'Pago diario no válido (euros con hasta 2 decimales)');}
  if(v.hours!==null){v.hours=String(v.hours).replace(',','.');if(!/^\d{1,2}(\.\d{1,2})?$/.test(v.hours)||Number(v.hours)<=0||Number(v.hours)>24)throw new FinError(400,'Horas por jornada no válidas (entre 0 y 24)');}
  if(v.positionId!==null&&(!uuid(v.positionId)||!(await c.query('SELECT 1 FROM ledens.positions WHERE id=$1',[v.positionId])).rows.length))throw new FinError(400,'Puesto no válido');
  return v;
 }
 // Next code, without reserving it (the form shows it as a preview).
 async peekCode(c){
  const n=(await c.query(`SELECT coalesce(max(substring(upper(btrim(empleadoid)) from $1)::numeric),0)+1 n FROM ledens.employees WHERE upper(btrim(empleadoid)) ~ $1`,
   ['^EMP-?([0-9]+)$'])).rows[0].n;
  return `EMP-${String(n).padStart(3,'0')}`;
 }
 // The employee code identifies the worker in the accounting import: never two
 // alike. One lock for the sequence, so two altas at once never take the same number.
 async nextCode(c){
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,7))',['employee-code-seq']);
  return this.peekCode(c);
 }
 async transaction(fn){const c=await this.pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 async audit(c,action,w,detail){
  await c.query(`INSERT INTO public.audit_log(actor_id,actor_label,action,target_label,detail) VALUES($1,$2,$3,$4,$5)`,
   [this.user.id,this.user.name||this.user.email||'Administrador',action,`Trabajador ${w.code||w.name}`,detail]);
 }
 async get(c,id){return (await c.query(`${SELECT} WHERE e.id=$1`,[id])).rows[0];}
 async locked(c,id,version){
  if(!uuid(id))throw new FinError(404,'Trabajador no encontrado');
  const before=(await c.query(`${SELECT} WHERE e.id=$1 FOR UPDATE OF e`,[id])).rows[0];
  if(!before)throw new FinError(404,'Trabajador no encontrado');
  if(version!==before.version)throw new FinError(409,'Otra persona ha cambiado este trabajador. Se han recargado los datos: revísalos y vuelve a guardar.');
  return before;
 }
 async create(body){
  if(!this.canEdit())throw new FinError(403,'Solo un administrador puede dar de alta trabajadores');
  return this.transaction(async c=>{
   const v=await this.clean(c,body);
   v.code=await this.nextCode(c);
   const fields=['code',...FIELDS],cols=fields.map(f=>COLUMN[f]);
   const id=(await c.query(`INSERT INTO ledens.employees(${cols.join(',')},activo) VALUES(${cols.map((_,i)=>'$'+(i+1)).join(',')},true) RETURNING id`,fields.map(f=>v[f]))).rows[0].id;
   // Cuentas por pagar: a new worker accrues jornales from today, never before.
   await startAccruingToday(c,id);
   const w=await this.get(c,id);
   await this.audit(c,'Trabajador dado de alta',w,`${w.name}${w.puesto?` · ${w.puesto}`:''}${w.code?` (${w.code})`:''}`);
   return w;
  });
 }
 async update(id,body){
  if(!this.canEdit())throw new FinError(403,'Solo un administrador puede editar trabajadores');
  return this.transaction(async c=>{
   const before=await this.locked(c,id,body?.version);
   const v=await this.clean(c,body);
   const old={name:before.name,positionId:before.position_id,tipo:before.tipo,dailyPay:before.daily_pay,hours:before.hours};
   const changed=FIELDS.filter(f=>!same(f,old[f],v[f]));
   if(!changed.length)return {...before,changed:false};
   if(changed.includes('dailyPay')&&!(Number(old.dailyPay)>0)&&Number(v.dailyPay)>0)await startAccruingToday(c,id);
   await c.query(`UPDATE ledens.employees SET ${changed.map((f,i)=>COLUMN[f]+'=$'+(i+2)).join(',')} WHERE id=$1`,[id,...changed.map(f=>v[f])]);
   const after=await this.get(c,id);
   await this.audit(c,'Trabajador editado',after,changed.map(f=>`${LABEL[f]}: ${f==='positionId'?before.puesto??'—':old[f]??'—'} → ${f==='positionId'?after.puesto??'—':v[f]??'—'}`).join(' · '));
   return {...after,changed:true};
  });
 }
 // Baja / reactivación. A baja keeps the history and takes the worker out of
 // «Pendiente de trabajador» (which only offers active employees).
 async setActive(id,{activo,version,reason}={}){
  if(!this.canEdit())throw new FinError(403,'Solo un administrador puede dar de baja o reactivar trabajadores');
  if(typeof activo!=='boolean')throw new FinError(400,'Indica si el trabajador queda activo');
  if(reason!==undefined&&reason!==null&&(typeof reason!=='string'||reason.length>500))throw new FinError(400,'Motivo no válido');
  return this.transaction(async c=>{
   const before=await this.locked(c,id,version);
   if(before.activo===activo)return {...before,changed:false};
   await c.query('UPDATE ledens.employees SET activo=$2 WHERE id=$1',[id,activo]);
   // Cuentas por pagar: the days on baja never accrue a jornal.
   if(activo)await startAccruingToday(c,id);
   const after=await this.get(c,id);
   await this.audit(c,activo?'Trabajador reactivado':'Trabajador dado de baja',after,`${after.name}${reason?.trim()?` · ${reason.trim()}`:''}`);
   return {...after,changed:true};
  });
 }
}
