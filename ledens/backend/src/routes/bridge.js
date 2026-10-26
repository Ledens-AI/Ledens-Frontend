import {Router} from 'express';
import {getPool,isDbConfigured} from '../db/pool.js';
import {requireAuth,checkRole} from '../auth/sessions.js';
import {viewAs} from '../auth/viewAs.js';
import {BridgeService,BridgeError} from '../bridge/service.js';
import {BridgeWorkspace} from '../bridge/workspace.js';
import {traced} from '../logs/runs.js';

const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
// «Ver como»: an admin viewing as a jefe is refused here, as that jefe would be.
export function createBridgeRouter({service,authorize=[requireAuth,viewAs(),checkRole('admin')]}={}){
  const router=Router();
  router.use((req,res,next)=>{if(!service&&!isDbConfigured())return res.status(503).json({error:'database_unavailable'});next();});
  router.use(authorize);
  const get=()=>service||new BridgeService(getPool());
  const handle=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){next(e);}};
  router.use((req,res,next)=>{
    if(req.method!=='GET'&&req.get('origin')!==process.env.CORS_ORIGIN)return res.status(403).json({error:'invalid_origin'});
    next();
  });
  router.param('id',(req,res,next,id)=>{if(!uuid(id))return res.status(400).json({error:'invalid_id'});next();});
  router.get('/workspace/counts',handle(async(req,res)=>res.json(await new BridgeWorkspace(get().pool).counts())));
  router.get('/workspace/movements',handle(async(req,res)=>res.json(await new BridgeWorkspace(get().pool).movements({...req.query,pending:true}))));
  router.get('/workspace/allocations',handle(async(req,res)=>res.json(await new BridgeWorkspace(get().pool).allocations(req.query))));
  router.get('/workspace/movements/:id/documents',handle(async(req,res)=>res.json(await new BridgeWorkspace(get().pool).documents(req.params.id,req.query))));
  router.get('/',handle(async(req,res)=>{
    const status=['pending','matched','dismissed'].includes(req.query.status)?req.query.status:'pending';
    const offset=Math.min(100000,Math.max(0,parseInt(req.query.offset,10)||0));
    const pool=get().pool;
    const rows=(await pool.query(`SELECT c.document_id,c.status,c.reason,c.version,c.updated_at,
      d.document_on,d.numerodocumento,d.tercero,d.total,d.tipo,d.enlacearchivo,
      (SELECT count(*)::int FROM ledens.bridge_cases WHERE status=$1) total_cases
      FROM ledens.bridge_cases c JOIN ledens.documents d ON d.id=c.document_id
      WHERE c.status=$1 ORDER BY c.created_at DESC,c.document_id LIMIT 50 OFFSET $2`,[status,offset])).rows;
    res.json({cases:rows,offset,next_offset:rows.length===50?offset+50:null});
  }));
  router.get('/:id',handle(async(req,res)=>res.json(await get().details(req.params.id))));
  router.post('/:id/confirm',traced('bridge','Confirmación manual',{entity:req=>({type:'documento',id:req.params.id}),summary:()=>({message:'Conciliación confirmada a mano'})})(async(req,res)=>{
    if(!uuid(req.body?.bank_movement_id)||!uuid(req.body?.request_id)||!Number.isInteger(req.body?.version))return res.status(400).json({error:'invalid_confirmation'});
    res.json(await get().confirm(req.params.id,req.body,req.user.id));
  }));
  router.post('/:id/dismiss',traced('bridge','Descarte manual',{entity:req=>({type:'documento',id:req.params.id}),summary:()=>({message:'Caso descartado a mano'})})(async(req,res)=>res.json(await get().dismiss(req.params.id,req.body?.version,req.body?.reason,req.user.id))));
  router.use((e,req,res,next)=>{
    if(e instanceof BridgeError)return res.status(e.status).json({error:e.code});
    if(['23505','23514','40001','40P01'].includes(e.code))return res.status(409).json({error:'allocation_conflict_refresh_required'});
    console.error('[bridge]',e.code||e.name);res.status(503).json({error:'bridge_unavailable'});
  });
  return router;
}
export default createBridgeRouter();
