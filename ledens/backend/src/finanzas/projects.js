// Proyectos (Gestión financiera → Proyectos): the master list of ledens.projects.
// Admins create and edit; anyone else with finance access only sees the projects
// they were granted. Rows created here have no source_id/raw_id (the table's own
// check keeps imported provenance and new rows apart). Every change is written to
// audit_log with the fields that changed.
//
// The code is never typed: a new project takes the next P<año>-<NNN> of the
// current year in Madrid (one more than the highest code of that form, imported
// ones included, any case) and keeps it; a code sent in a form is ignored.
//
// The CIF del cliente lives in ledens.project_customer_tax_ids (migration 050),
// one per project, since the client is often only a typed name.
import {uuid} from '../finance/service.js';
import {FinError} from './service.js';
import {validSpanishTaxId} from '../ingestion/ocr.js';

const FIELDS=['name','customerId','customerName','salesman','address','municipio','provincia','statusId','startDate','endDate'];
const COLUMN={code:'project_id',name:'name',customerId:'customer_id',customerName:'customer_name_source',salesman:'salesman',address:'address',
 municipio:'municipio',provincia:'provincia',statusId:'status_id',startDate:'start_date',endDate:'end_date'};
const LABEL={code:'Código',cif:'CIF del cliente',name:'Nombre',customerId:'Cliente',customerName:'Cliente (texto)',salesman:'Comercial',address:'Dirección',
 municipio:'Municipio',provincia:'Provincia',statusId:'Estado',startDate:'Inicio',endDate:'Fin'};
const JOINS=`LEFT JOIN ledens.customers c ON c.id=p.customer_id LEFT JOIN ledens.project_customer_tax_ids t ON t.project_id=p.id`;
// The version covers the CIF too, so a CIF changed meanwhile is reported like any other field.
const SELECT=`SELECT p.id,p.project_id code,p.name,p.customer_id,coalesce(c.display_name,p.customer_name_source) cliente,p.customer_name_source,t.tax_id cif,
 p.salesman,p.address,p.municipio,p.provincia,p.status_id,ps.name estado,p.start_date::text start_date,p.end_date::text end_date,(p.source_id IS NOT NULL) importado,
 md5(to_jsonb(p)::text||coalesce(t.tax_id,'')) version
 FROM ledens.projects p ${JOINS} LEFT JOIN ledens.project_statuses ps ON ps.id=p.status_id`;
// CIF, NIF or NIE: upper case without spaces, dots, dashes or slashes, and without
// the «ES» of a NIF-IVA. A Spanish one must pass its control character; anything
// else must be a foreign NIF-IVA with its country prefix (two letters, not ES).
const SPANISH=/^(\d{8}[A-Z]|[XYZ]\d{7}[A-Z]|[A-HJNPQRSUVW]\d{7}[0-9A-J])$/;
export function cleanTaxId(x){
 if(x===null||x===undefined)return null;
 if(typeof x!=='string')throw new FinError(400,'CIF del cliente no válido');
 const id=x.toUpperCase().replace(/[\s.\-/]/g,'').replace(/^ES(?=[A-Z0-9]{9}$)/,'');
 if(!id)return null;
 if(SPANISH.test(id)){if(validSpanishTaxId(id))return id;throw new FinError(400,`El CIF/NIF ${id} no es válido: revisa la letra o el dígito de control`);}
 if(/^(?!ES)[A-Z]{2}[A-Z0-9]{2,18}$/.test(id))return id;
 throw new FinError(400,'CIF del cliente no válido: escribe un CIF, NIF o NIE español o un NIF-IVA extranjero con el prefijo de su país');
}

export class ProjectsService {
 constructor(pool,user={role:'client',id:null},{now=()=>new Date()}={}){this.pool=pool;this.user=user;this.now=now;}
 canEdit(){return this.user.role==='admin';}
 access(){if(this.user.role==='client')throw new FinError(403,'No tienes acceso a las finanzas');}
 async list({q='',estado='',page=1,pageSize=25}={}){
  this.access();
  const size=Math.min(100,Math.max(1,Number(pageSize)||25)),p=Math.max(1,Math.min(4000,Number(page)||1));
  const params=[this.user.role==='admin',this.user.id,'%'+String(q).slice(0,100)+'%'];const where=[
   `($1 OR EXISTS(SELECT 1 FROM ledens.finance_project_permissions fp WHERE fp.user_id=$2 AND fp.project_id=p.id))`,
   `concat_ws(' ',p.project_id,p.name,p.address,p.municipio,p.provincia,p.salesman,c.display_name,p.customer_name_source,t.tax_id) ILIKE $3`];
  if(estado){if(!uuid(estado))throw new FinError(400,'Estado no válido');params.push(estado);where.push('p.status_id=$'+params.length);}
  const w=' WHERE '+where.join(' AND ');
  const rows=(await this.pool.query(`${SELECT}${w} ORDER BY p.start_date DESC NULLS LAST,p.name,p.id LIMIT ${size} OFFSET ${(p-1)*size}`,params)).rows;
  const total=(await this.pool.query(`SELECT count(*)::int n FROM ledens.projects p ${JOINS}${w}`,params)).rows[0].n;
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
  return {statuses:statuses.rows,customers:customers.rows,canEdit:this.canEdit(),...(this.canEdit()?{nextCode:await this.peekCode(this.pool)}:{})};
 }
 // Validates and normalizes the form. Empty strings become NULL; name is required.
 // `before` is the stored row when editing.
 async clean(c,body,before=null){
  const v={};
  for(const f of FIELDS){const x=body?.[f];v[f]=typeof x==='string'?(x.trim()||null):(x??null);}
  if(!v.name)throw new FinError(400,'El nombre es obligatorio');
  for(const f of ['name','customerName','salesman','address','municipio','provincia'])
   if(v[f]!==null&&(typeof v[f]!=='string'||v[f].length>200))throw new FinError(400,`${LABEL[f]} no válido (máximo 200 caracteres)`);
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
  v.cif=cleanTaxId(body?.cif);
  return v;
 }
 async saveTaxId(c,id,cif){
  if(cif===null)return c.query('DELETE FROM ledens.project_customer_tax_ids WHERE project_id=$1',[id]);
  await c.query(`INSERT INTO ledens.project_customer_tax_ids(project_id,tax_id,updated_by) VALUES($1,$2,$3)
   ON CONFLICT (project_id) DO UPDATE SET tax_id=excluded.tax_id,updated_by=excluded.updated_by,updated_at=now()`,[id,cif,this.user.id]);
 }
 year(){return new Intl.DateTimeFormat('en',{timeZone:'Europe/Madrid',year:'numeric'}).format(this.now());}
 // Next code of the year, without reserving it (the form shows it as a preview).
 async peekCode(c,year=this.year()){
  const n=(await c.query(`SELECT coalesce(max(substring(upper(btrim(project_id)) from $1)::numeric),0)+1 n FROM ledens.projects WHERE upper(btrim(project_id)) ~ $1`,
   [`^P${year}-([0-9]+)$`])).rows[0].n;
  return `P${year}-${String(n).padStart(3,'0')}`;
 }
 // Project codes identify works in invoices and suggestions: never two alike.
 // One lock per year, so two projects created at once never take the same number.
 // The code is read for the year that was locked: the clock is not read again,
 // so a creation that waits on the lock across New Year never reads another year.
 async nextCode(c){
  const year=this.year();
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,7))',['project-code-seq|'+year]);
  return this.peekCode(c,year);
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
   v.code=await this.nextCode(c);
   const fields=['code',...FIELDS],cols=fields.map(f=>COLUMN[f]);
   const id=(await c.query(`INSERT INTO ledens.projects(${cols.join(',')}) VALUES(${cols.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING id`,fields.map(f=>v[f]))).rows[0].id;
   if(v.cif)await this.saveTaxId(c,id,v.cif);
   const p=await this.get(c,id);
   await this.audit(c,'Proyecto creado',p,`${p.name}${p.code?` (${p.code})`:''}${p.cif?` · CIF del cliente ${p.cif}`:''}`);
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
   const v=await this.clean(c,body,before);
   const old={cif:before.cif,name:before.name,customerId:before.customer_id,customerName:before.customer_name_source,salesman:before.salesman,address:before.address,
    municipio:before.municipio,provincia:before.provincia,statusId:before.status_id,startDate:before.start_date,endDate:before.end_date};
   const changed=['cif',...FIELDS].filter(f=>(old[f]??null)!==(v[f]??null));
   if(!changed.length)return {...before,changed:false};
   const columns=changed.filter(f=>f!=='cif');
   if(columns.length)await c.query(`UPDATE ledens.projects SET ${columns.map((f,i)=>COLUMN[f]+'=$'+(i+2)).join(',')} WHERE id=$1`,[id,...columns.map(f=>v[f])]);
   if(changed.includes('cif'))await this.saveTaxId(c,id,v.cif);
   const after=await this.get(c,id);
   await this.audit(c,'Proyecto editado',after,changed.map(f=>`${LABEL[f]}: ${f==='customerId'?before.cliente??'—':f==='statusId'?before.estado??'—':old[f]??'—'} → ${f==='customerId'?after.cliente??'—':f==='statusId'?after.estado??'—':v[f]??'—'}`).join(' · '));
   return {...after,changed:true};
  });
 }
}
