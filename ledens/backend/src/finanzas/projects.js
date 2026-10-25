// Proyectos (Gestión financiera → Proyectos): the master list of ledens.projects.
// Admins create and edit; anyone else with finance access only sees the projects
// they were granted. Rows created here have no source_id/raw_id (the table's own
// check keeps imported provenance and new rows apart). Every change is written to
// audit_log with the fields that changed.
import {uuid} from '../finance/service.js';
import {FinError} from './service.js';

const FIELDS=['code','name','customerId','customerName','salesman','address','municipio','provincia','statusId','startDate','endDate'];
const COLUMN={code:'project_id',name:'name',customerId:'customer_id',customerName:'customer_name_source',salesman:'salesman',address:'address',
 municipio:'municipio',provincia:'provincia',statusId:'status_id',startDate:'start_date',endDate:'end_date'};
const LABEL={code:'Código',name:'Nombre',customerId:'Cliente',customerName:'Cliente (texto)',salesman:'Comercial',address:'Dirección',
 municipio:'Municipio',provincia:'Provincia',statusId:'Estado',startDate:'Inicio',endDate:'Fin'};
const SELECT=`SELECT p.id,p.project_id code,p.name,p.customer_id,coalesce(c.display_name,p.customer_name_source) cliente,p.customer_name_source,
 p.salesman,p.address,p.municipio,p.provincia,p.status_id,ps.name estado,p.start_date::text start_date,p.end_date::text end_date,(p.source_id IS NOT NULL) importado,
 md5(to_jsonb(p)::text) version
 FROM ledens.projects p LEFT JOIN ledens.customers c ON c.id=p.customer_id LEFT JOIN ledens.project_statuses ps ON ps.id=p.status_id`;

export class ProjectsService {
 constructor(pool,user={role:'client',id:null}){this.pool=pool;this.user=user;}
 canEdit(){return this.user.role==='admin';}
 access(){if(this.user.role==='client')throw new FinError(403,'No tienes acceso a las finanzas');}
 async list({q='',estado='',page=1,pageSize=25}={}){
  this.access();
  const size=Math.min(100,Math.max(1,Number(pageSize)||25)),p=Math.max(1,Math.min(4000,Number(page)||1));
  const params=[this.user.role==='admin',this.user.id,'%'+String(q).slice(0,100)+'%'];const where=[
   `($1 OR EXISTS(SELECT 1 FROM ledens.finance_project_permissions fp WHERE fp.user_id=$2 AND fp.project_id=p.id))`,
   `concat_ws(' ',p.project_id,p.name,p.address,p.municipio,p.provincia,p.salesman,c.display_name,p.customer_name_source) ILIKE $3`];
  if(estado){if(!uuid(estado))throw new FinError(400,'Estado no válido');params.push(estado);where.push('p.status_id=$'+params.length);}
  const w=' WHERE '+where.join(' AND ');
  const rows=(await this.pool.query(`${SELECT}${w} ORDER BY p.start_date DESC NULLS LAST,p.name,p.id LIMIT ${size} OFFSET ${(p-1)*size}`,params)).rows;
  const total=(await this.pool.query(`SELECT count(*)::int n FROM ledens.projects p LEFT JOIN ledens.customers c ON c.id=p.customer_id${w}`,params)).rows[0].n;
  return {rows,total,page:p,pageSize:size,canEdit:this.canEdit()};
 }
 // One project by its immutable id (used to reload after a conflict, when code
 // or name may have changed). Same visibility rule as the list.
 async one(id){
  this.access();
  if(!uuid(id))throw new FinError(404,'Proyecto no encontrado');
  const r=(await this.pool.query(`${SELECT} WHERE p.id=$3 AND ($1 OR EXISTS(SELECT 1 FROM ledens.finance_project_permissions fp WHERE fp.user_id=$2 AND fp.project_id=p.id))`,
   [this.user.role==='admin',this.user.id,id])).rows[0];
  if(!r)throw new FinError(404,'Proyecto no encontrado');
  return r;
 }
 async options(){
  this.access();
  const [statuses,customers]=await Promise.all([
   this.pool.query('SELECT id,code,name FROM ledens.project_statuses ORDER BY name,id'),
   this.pool.query('SELECT id,display_name name FROM ledens.customers ORDER BY display_name,id'),
  ]);
  return {statuses:statuses.rows,customers:customers.rows,canEdit:this.canEdit()};
 }
 // Validates and normalizes the form. Empty strings become NULL; name is required.
 // `before` is the stored row when editing.
 async clean(c,body,id=null,before=null){
  const v={};
  for(const f of FIELDS){const x=body?.[f];v[f]=typeof x==='string'?(x.trim()||null):(x??null);}
  if(!v.name)throw new FinError(400,'El nombre es obligatorio');
  for(const f of ['code','name','customerName','salesman','address','municipio','provincia'])
   if(v[f]!==null&&(typeof v[f]!=='string'||v[f].length>(f==='code'?50:200)))throw new FinError(400,`${LABEL[f]} no válido (máximo ${f==='code'?50:200} caracteres)`);
  for(const f of ['startDate','endDate'])if(v[f]!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(v[f])||!Number.isFinite(Date.parse(v[f]))))throw new FinError(400,`Fecha de ${LABEL[f].toLowerCase()} no válida`);
  if(v.startDate&&v.endDate&&v.endDate<v.startDate)throw new FinError(400,'La fecha de fin no puede ser anterior a la de inicio');
  if(v.statusId!==null&&(!uuid(v.statusId)||!(await c.query('SELECT 1 FROM ledens.project_statuses WHERE id=$1',[v.statusId])).rows.length))throw new FinError(400,'Estado no válido');
  if(v.customerId!==null){
   const cu=uuid(v.customerId)&&(await c.query('SELECT display_name FROM ledens.customers WHERE id=$1',[v.customerId])).rows[0];
   if(!cu)throw new FinError(400,'Cliente no válido');
   // Choosing a registered client replaces any free text typed before; an
   // unchanged client keeps its stored text (imported rows may differ).
   if(!before||before.customer_id!==v.customerId||!v.customerName)v.customerName=cu.display_name;
  }
  // Project codes identify works in invoices and suggestions: never two alike.
  if(v.code){
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,7))',['project-code|'+v.code.toLowerCase()]);
   const dup=(await c.query('SELECT name FROM ledens.projects WHERE lower(btrim(project_id))=lower($1) AND ($2::uuid IS NULL OR id<>$2) LIMIT 1',[v.code,id])).rows[0];
   if(dup)throw new FinError(409,`El código ${v.code} ya lo usa el proyecto «${dup.name}»`);
  }
  return v;
 }
 async transaction(fn){const c=await this.pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 async audit(c,action,project,detail){
  await c.query(`INSERT INTO public.audit_log(actor_id,actor_label,action,target_label,detail) VALUES($1,$2,$3,$4,$5)`,
   [this.user.id,this.user.name||this.user.email||'Administrador',action,`Proyecto ${project.code||project.name}`,detail]);
 }
 async get(c,id){return (await c.query(`${SELECT} WHERE p.id=$1`,[id])).rows[0];}
 async create(body){
  if(!this.canEdit())throw new FinError(403,'Solo un administrador puede crear proyectos');
  return this.transaction(async c=>{
   const v=await this.clean(c,body);
   const cols=FIELDS.map(f=>COLUMN[f]);
   const id=(await c.query(`INSERT INTO ledens.projects(${cols.join(',')}) VALUES(${cols.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING id`,FIELDS.map(f=>v[f]))).rows[0].id;
   const p=await this.get(c,id);
   await this.audit(c,'Proyecto creado',p,`${p.name}${p.code?` (${p.code})`:''}`);
   return p;
  });
 }
 // `version` is the md5 of the row the person edited: a change made meanwhile
 // by someone else (or by an import) is never silently overwritten.
 async update(id,body){
  if(!this.canEdit())throw new FinError(403,'Solo un administrador puede editar proyectos');
  if(!uuid(id))throw new FinError(404,'Proyecto no encontrado');
  return this.transaction(async c=>{
   const before=(await c.query(`${SELECT} WHERE p.id=$1 FOR UPDATE OF p`,[id])).rows[0];
   if(!before)throw new FinError(404,'Proyecto no encontrado');
   if(body?.version!==before.version)throw new FinError(409,'Otra persona ha cambiado este proyecto. Se han recargado los datos: revísalos y vuelve a guardar.');
   const v=await this.clean(c,body,id,before);
   const old={code:before.code,name:before.name,customerId:before.customer_id,customerName:before.customer_name_source,salesman:before.salesman,address:before.address,
    municipio:before.municipio,provincia:before.provincia,statusId:before.status_id,startDate:before.start_date,endDate:before.end_date};
   const changed=FIELDS.filter(f=>(old[f]??null)!==(v[f]??null));
   if(!changed.length)return {...before,changed:false};
   await c.query(`UPDATE ledens.projects SET ${changed.map((f,i)=>COLUMN[f]+'=$'+(i+2)).join(',')} WHERE id=$1`,[id,...changed.map(f=>v[f])]);
   const after=await this.get(c,id);
   await this.audit(c,'Proyecto editado',after,changed.map(f=>`${LABEL[f]}: ${f==='customerId'?before.cliente??'—':f==='statusId'?before.estado??'—':old[f]??'—'} → ${f==='customerId'?after.cliente??'—':f==='statusId'?after.estado??'—':v[f]??'—'}`).join(' · '));
   return {...after,changed:true};
  });
 }
}
