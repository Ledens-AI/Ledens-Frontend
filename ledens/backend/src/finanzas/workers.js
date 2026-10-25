// Trabajadores (Gestión financiera → Trabajadores): the master list of ledens.employees.
// Admins create, edit, deactivate and reactivate; anyone else with finance access
// sees the list without the daily pay. Deactivating never deletes: worker_payments
// keep pointing at the employee, who just stops being offered for new payments.
// Rows created here have no source_id/raw_id; every change goes to audit_log.
import {uuid} from '../finance/service.js';
import {FinError} from './service.js';

const FIELDS=['code','name','positionId','tipo','dailyPay','hours'];
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
 async options(){
  this.access();
  const positions=(await this.pool.query('SELECT id,name FROM ledens.positions WHERE coalesce(activo,true) ORDER BY name,id')).rows;
  return {positions,canEdit:this.canEdit()};
 }
 async clean(c,body,id=null){
  const v={};
  for(const f of FIELDS){const x=body?.[f];v[f]=typeof x==='string'?(x.trim()||null):(x??null);}
  if(!v.name)throw new FinError(400,'El nombre es obligatorio');
  for(const f of ['code','name','tipo'])if(v[f]!==null&&(typeof v[f]!=='string'||v[f].length>(f==='code'?50:200)))throw new FinError(400,`${LABEL[f]} no válido (máximo ${f==='code'?50:200} caracteres)`);
  if(v.dailyPay!==null){v.dailyPay=String(v.dailyPay).replace(',','.');if(!/^\d{1,7}(\.\d{1,2})?$/.test(v.dailyPay))throw new FinError(400,'Pago diario no válido (euros con hasta 2 decimales)');}
  if(v.hours!==null){v.hours=String(v.hours).replace(',','.');if(!/^\d{1,2}(\.\d{1,2})?$/.test(v.hours)||Number(v.hours)<=0||Number(v.hours)>24)throw new FinError(400,'Horas por jornada no válidas (entre 0 y 24)');}
  if(v.positionId!==null&&(!uuid(v.positionId)||!(await c.query('SELECT 1 FROM ledens.positions WHERE id=$1',[v.positionId])).rows.length))throw new FinError(400,'Puesto no válido');
  // The employee code identifies the worker in the accounting import: never two alike.
  if(v.code){
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,7))',['employee-code|'+v.code.toLowerCase()]);
   const dup=(await c.query('SELECT name FROM ledens.employees WHERE lower(btrim(empleadoid))=lower($1) AND ($2::uuid IS NULL OR id<>$2) LIMIT 1',[v.code,id])).rows[0];
   if(dup)throw new FinError(409,`El código ${v.code} ya lo usa ${dup.name}`);
  }
  return v;
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
   const cols=FIELDS.map(f=>COLUMN[f]);
   const id=(await c.query(`INSERT INTO ledens.employees(${cols.join(',')},activo) VALUES(${cols.map((_,i)=>'$'+(i+1)).join(',')},true) RETURNING id`,FIELDS.map(f=>v[f]))).rows[0].id;
   const w=await this.get(c,id);
   await this.audit(c,'Trabajador dado de alta',w,`${w.name}${w.puesto?` · ${w.puesto}`:''}${w.code?` (${w.code})`:''}`);
   return w;
  });
 }
 async update(id,body){
  if(!this.canEdit())throw new FinError(403,'Solo un administrador puede editar trabajadores');
  return this.transaction(async c=>{
   const before=await this.locked(c,id,body?.version);
   const v=await this.clean(c,body,id);
   const old={code:before.code,name:before.name,positionId:before.position_id,tipo:before.tipo,dailyPay:before.daily_pay,hours:before.hours};
   const changed=FIELDS.filter(f=>!same(f,old[f],v[f]));
   if(!changed.length)return {...before,changed:false};
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
   const after=await this.get(c,id);
   await this.audit(c,activo?'Trabajador reactivado':'Trabajador dado de baja',after,`${after.name}${reason?.trim()?` · ${reason.trim()}`:''}`);
   return {...after,changed:true};
  });
 }
}
