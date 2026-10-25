import {Router} from 'express';
import {getPool,isDbConfigured} from '../db/pool.js';
import {requireAuth} from '../auth/sessions.js';
import {FinanceService,FinanceError,uuid} from '../finance/service.js';
import {traced} from '../logs/runs.js';

export function createFinanceRouter({service,authorize=requireAuth,origin=process.env.CORS_ORIGIN}={}){
 const router=Router();const get=()=>service||new FinanceService(getPool());
 const dates=(value,key='')=>value instanceof Date?(/_on$|^month$/.test(key)?value.toISOString().slice(0,10):value.toISOString()):
   Array.isArray(value)?value.map(v=>dates(v)):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,dates(v,k)])):value;
 router.use((req,res,next)=>{const send=res.json.bind(res);res.json=value=>send(dates(value));next();});
 const handle=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){next(e);}};
 router.use(authorize);
 router.use((req,res,next)=>{
   if(req.user.role==='client')return res.status(403).json({error:'finance_forbidden'});
   if(!service&&!isDbConfigured())return res.status(503).json({error:'database_unavailable'});
   if(req.method!=='GET'&&(!origin||req.get('origin')!==origin))return res.status(403).json({error:'invalid_origin'});
   next();
 });
 for(const name of ['id','projectId'])router.param(name,(req,res,next,value)=>uuid(value)?next():res.status(400).json({error:'invalid_id'}));
 const pagination=req=>{
   const limit=req.query.limit===undefined?50:Number(req.query.limit),offset=req.query.offset===undefined?0:Number(req.query.offset);
   if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>100000)throw new FinanceError(400,'invalid_pagination');
   return {limit,offset};
 };
 const page=(items,p)=>({items,...p,next_offset:items.length===p.limit?p.offset+p.limit:null});
 router.get('/projects',handle(async(req,res)=>{const p=pagination(req);res.json(page(await get().projects(req.user,p),p));}));
 const list=type=>handle(async(req,res)=>{
   const p=pagination(req),q=req.query;
   if(q.project_id&&!uuid(q.project_id))throw new FinanceError(400,'invalid_project');
   for(const k of ['from','to'])if(q[k]&&!/^\d{4}-\d{2}-\d{2}$/.test(q[k]))throw new FinanceError(400,'invalid_date');
   for(const k of ['min','max'])if(q[k]&&!/^\d{1,12}(\.\d{1,2})?$/.test(q[k]))throw new FinanceError(400,'invalid_amount');
   if(q.status&&!['pending','approved','excluded'].includes(q.status))throw new FinanceError(400,'invalid_status');
   if(q.search&&q.search.length>200)throw new FinanceError(400,'invalid_search');
   const typeValue=type||q.type;
   if(typeValue&&!['materials','worker-payments','customer-payments','invoice-lines'].includes(typeValue))throw new FinanceError(400,'invalid_type');
   res.json(page(await get().list(req.user,{...p,type:typeValue,status:q.status,project_id:q.project_id,
     unassigned:req.path.endsWith('/unassigned')||q.unassigned==='true',search:q.search,from:q.from,to:q.to,min:q.min,max:q.max,sort:q.sort}),p));
 });
 router.get('/finance/records',list());router.get('/finance/unassigned',list());
 for(const type of ['materials','worker-payments','customer-payments'])router.get('/finance/'+type,list(type));
 router.get('/finance/records/:id',handle(async(req,res)=>res.json(await get().record(get().pool,req.params.id,req.user))));
 router.get('/finance/records/:id/allocations',handle(async(req,res)=>res.json({items:(await get().record(get().pool,req.params.id,req.user)).allocations})));
 router.get('/finance/records/:id/history',handle(async(req,res)=>{const p=pagination(req);res.json(page(await get().history(req.user,req.params.id,p),p));}));
 router.post('/finance/allocations/bulk',traced('imputacion','Asignación de proyectos (API)',{summary:b=>({message:`${b.records?.length||0} registros actualizados`,detail:{registros:b.records?.length||0}})})(async(req,res)=>res.json(await get().bulk(req.user,req.body||{}))));
 router.patch('/finance/records/:id/project',traced('imputacion','Asignación de proyecto (API)',{entity:req=>({type:'registro',id:req.params.id})})(async(req,res)=>{
   const b=req.body||{};if(b.project_id!==null&&!uuid(b.project_id))throw new FinanceError(400,'invalid_project');
   const r=await get().record(get().pool,req.params.id,req.user);
   res.json(await get().bulk(req.user,{request_id:b.request_id,reason:b.reason,
    records:[{record_id:r.id,version:b.version,allocations:b.project_id===null?[]:[{project_id:b.project_id,amount:r.gross_amount}]}]}));
 }));
 router.patch('/finance/records/:id/recognition',traced('validacion','Validación contable',{entity:req=>({type:'registro',id:req.params.id}),summary:b=>({message:'Estado contable: '+b.status,detail:{estado:b.status,categoria:b.category}})})(async(req,res)=>res.json(await get().approve(req.user,req.params.id,req.body||{}))));
 router.get('/finance/documents/:id/lines',handle(async(req,res)=>{const p=pagination(req);res.json(page(await get().lines(req.user,req.params.id,p),p));}));
 router.post('/finance/documents/:id/lines',traced('ingesta','Alta de línea de factura',{entity:req=>({type:'documento',id:req.params.id})})(async(req,res)=>res.status(201).json(await get().createLine(req.user,req.params.id,req.body||{}))));
 router.put('/finance/budget-versions/:id/basis',traced('validacion','Verificación de presupuesto',{entity:req=>({type:'version_presupuesto',id:req.params.id})})(async(req,res)=>res.json(await get().verifyBudget(req.user,req.params.id,req.body||{}))));
 for(const route of ['financial-summary','profitability'])router.get('/projects/:projectId/'+route,handle(async(req,res)=>res.json(await get().summary(req.user,req.params.projectId))));
 router.get('/projects/:projectId/financial-transactions',handle(async(req,res)=>{const p=pagination(req);res.json(page(await get().list(req.user,{...p,project_id:req.params.projectId}),p));}));
 router.get('/projects/:projectId/financial-evolution',handle(async(req,res)=>{const p=pagination(req);res.json(page(await get().evolution(req.user,req.params.projectId,p),p));}));
 router.put('/finance/permissions',traced('permisos','Conceder permiso',{entity:req=>({type:'usuario',id:req.body?.user_id})})(async(req,res)=>{
   if(req.user.role!=='admin')throw new FinanceError(403,'finance_forbidden');
   const b=req.body||{};
   if(!uuid(b.user_id)||(b.project_id!==null&&!uuid(b.project_id))||typeof b.can_write!=='boolean'||typeof b.can_review_unassigned!=='boolean'||typeof b.reason!=='string'||b.reason.length<5)throw new FinanceError(400,'invalid_permission');
   const result=await get().transaction(async c=>{
     const before=(await c.query('SELECT * FROM ledens.finance_project_permissions WHERE user_id=$1 AND project_id IS NOT DISTINCT FROM $2::uuid',[b.user_id,b.project_id])).rows;
     await c.query(`INSERT INTO ledens.finance_project_permissions(user_id,project_id,can_write,can_review_unassigned) VALUES($1,$2,$3,$4)
      ON CONFLICT(user_id,project_id) DO UPDATE SET can_write=excluded.can_write,can_review_unassigned=excluded.can_review_unassigned`,[b.user_id,b.project_id,b.can_write,b.can_review_unassigned]);
     await c.query(`INSERT INTO public.audit_log(actor_id,actor_label,action,target_id,detail) VALUES($1,$2,'finance_permission',$3,$4)`,[req.user.id,req.user.email||req.user.id,b.user_id,JSON.stringify({before,after:b})]);
     return {updated:true};
   });res.json(result);
 }));
 router.delete('/finance/permissions',traced('permisos','Revocar permiso',{entity:req=>({type:'usuario',id:req.body?.user_id})})(async(req,res)=>{
   if(req.user.role!=='admin')throw new FinanceError(403,'finance_forbidden');
   const b=req.body||{};
   if(!uuid(b.user_id)||(b.project_id!==null&&!uuid(b.project_id))||typeof b.reason!=='string'||b.reason.trim().length<5)throw new FinanceError(400,'invalid_permission');
   res.json(await get().transaction(async c=>{
     const before=(await c.query('DELETE FROM ledens.finance_project_permissions WHERE user_id=$1 AND project_id IS NOT DISTINCT FROM $2::uuid RETURNING *',[b.user_id,b.project_id])).rows;
     await c.query(`INSERT INTO public.audit_log(actor_id,actor_label,action,target_id,detail) VALUES($1,$2,'finance_permission_revoked',$3,$4)`,[req.user.id,req.user.email||req.user.id,b.user_id,JSON.stringify({before,reason:b.reason})]);
     return {updated:true};
   }));
 }));
 router.use((e,req,res,next)=>{
   if(e instanceof FinanceError)return res.status(e.status).json({error:e.message});
   if(['23503','23505','23514','40001','40P01'].includes(e.code))return res.status(409).json({error:'financial_conflict'});
   if(['22007','22008','22P02'].includes(e.code))return res.status(400).json({error:'invalid_parameter'});
   console.error('[finance]',e.code||e.name);res.status(503).json({error:'finance_unavailable'});
 });return router;
}
export default createFinanceRouter();
