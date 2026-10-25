import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { getPool, isDbConfigured } from '../db/pool.js';
import { validateInvoice, IngestError } from '../ingestion/validation.js';
import { InvoiceOcr } from '../ingestion/ocr.js';
import { IngestionService } from '../ingestion/service.js';
import {AlertService} from '../notifications/service.js';
import {BridgeService} from '../bridge/service.js';
import {traced,startRun,finishRun} from '../logs/runs.js';

// Logs de transacciones: what each automation call did, without file names or contents.
const OCR_RESULT={ready:'Datos extraídos',review:'Requiere revisión manual',archived:'Ya archivada'};

export function createIngestionRouter({service,config,tokenHash}={}) {
  const router=express.Router();
  router.use((req,res,next)=>{
    const expected=tokenHash ?? process.env.INGEST_TOKEN_SHA256;
    if(!expected || !/^[a-f0-9]{64}$/.test(expected)) return res.status(503).json({error:'ingestion_not_configured'});
    const token=req.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/)?.[1] || '';
    const actual=createHash('sha256').update(token).digest();
    if(!token || !timingSafeEqual(actual,Buffer.from(expected,'hex'))) return res.status(401).json({error:'unauthorized'});
    if(!service && !isDbConfigured()) return res.status(503).json({error:'database_not_configured'});
    next();
  });
  // Parse only after authentication. Do not increase the public API's body limit.
  router.use(express.json({limit:'6mb'}));
  const settings=()=>config || {
    site:process.env.INGEST_SITE_URL,
    folder:process.env.INGEST_FOLDER || 'datasource/Landing facturas',
    archiveRoot:process.env.INGEST_ARCHIVE_ROOT || 'datasource',
  };
  const getService=()=>service || new IngestionService(getPool(),
    process.env.DI_ENDPOINT && process.env.DI_KEY ? new InvoiceOcr(process.env.DI_ENDPOINT,process.env.DI_KEY):null,settings());
  const handle=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){next(e);}};
  router.post('/',traced('ingesta','Recepción de factura',{entity:req=>({type:'elemento_sharepoint',id:req.body?.item_id}),
    summary:b=>({message:b.duplicate?'Contenido duplicado: se conserva el documento existente':b.replay?'Reintento: ya estaba recibida':b.status==='review'?'Recibida; requiere revisión ('+(b.reason||'')+')':'Factura recibida',
      detail:{ingesta_id:b.ingestion_id,documento_id:b.document_id,estado:b.status,motivo:b.reason||undefined,duplicado:b.duplicate}})})(async(req,res)=>{
    const file=await validateInvoice(req.body,settings());
    const result=await getService().receive(file);
    res.status(result.replay||result.duplicate?200:202).json(result);
  }));
  router.post('/bridge/run',traced('bridge','Conciliación periódica',{
    summary:b=>({message:`${b.evaluated} evaluados · ${b.matched} conciliados · ${b.pending} pendientes · ${b.errors} con error`,
      detail:{evaluados:b.evaluated,conciliados:b.matched,pendientes:b.pending,errores:b.errors,vacio:!b.evaluated}})})(async(req,res)=>{
    if(process.env.BRIDGE_ENABLED!=='true')return res.status(503).json({error:'bridge_disabled'});
    const result=await new BridgeService(getPool()).run(50);
    res.status(result.errors?503:200).json(result);
  }));
  router.post('/notifications/claim',traced('alertas','Recogida de alertas',{
    summary:b=>{const n=b.messages?.length||0;return {message:n?`${n} ${n===1?'alerta':'alertas'} para enviar`:'Sin alertas pendientes',detail:{mensajes:n,vacio:!n}};}})(
    async(req,res)=>res.json(await new AlertService(getPool()).claim())));
  router.post('/notifications/:id/ack',traced('alertas','Envío de correo',{entity:req=>({type:'alerta',id:req.params.id}),
    summary:(b,req)=>(req.body?.delivered?{message:'Correo entregado a Outlook'}:{status:'error',message:'Outlook no aceptó el correo; se reintentará en 15 minutos'})})(async(req,res)=>{
    if(!/^[0-9a-f-]{36}$/i.test(req.body?.lease_token||'')||typeof req.body?.delivered!=='boolean')return res.status(400).json({error:'invalid_ack'});
    const ok=await new AlertService(getPool()).acknowledge(req.params.id,req.body.lease_token,req.body.delivered);
    res.status(ok?200:409).json({acknowledged:ok});
  }));
  router.param('id',(req,res,next,id)=>{
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return res.status(400).json({error:'invalid_id'});
    next();
  });
  // The flow polls this every few seconds while the OCR runs: only the outcome is logged.
  router.post('/:id/process',traced('ocr','Extracción de datos',{entity:req=>({type:'ingesta',id:req.params.id}),
    summary:b=>(b.status==='analyzing'||b.status==='received'?{discard:true}:{status:b.status==='review'?'rechazado':'ok',
      message:OCR_RESULT[b.status]||b.status,detail:{estado:b.status,motivo:b.reason||undefined,documento_id:b.document_id,fecha_factura:b.invoice_date||undefined}})})(
    async(req,res)=>res.json(await getService().process(req.params.id))));
  router.post('/:id/archive',traced('archivo','Archivo del original en SharePoint',{entity:req=>({type:'ingesta',id:req.params.id}),
    summary:b=>({message:'Original archivado en '+(b.destination_folder||'su carpeta'),detail:{documento_id:b.document_id}})})(async(req,res)=>{
    const result=await getService().archived(req.params.id,req.body?.archive_url);
    if(process.env.BRIDGE_ENABLED==='true'){
      const run=await startRun({process:'bridge',step:'Conciliación tras archivar',entityType:'documento',entityId:result.document_id});
      try{const r=await new BridgeService(getPool()).evaluate(result.document_id,{force:true});
        await finishRun(run,{status:r?.status==='error'?'error':'ok',message:r?.status==='matched'?'Conciliada con un movimiento':r?.status==='pending'?'Pendiente: '+(r.reason||'sin coincidencia'):(r?.status||'Evaluada'),detail:{estado:r?.status,motivo:r?.reason}});}
      catch(e){await finishRun(run,{status:'error',errorCode:e.code||e.name,message:'La conciliación se reintentará en la ejecución periódica'});console.error('[bridge] deferred',e.code||e.name);try{await new AlertService(getPool()).error({type:'bridge',documentId:result.document_id,reason:e.code||'bridge_deferred'});}catch{console.error('[alerts] unable to persist Bridge failure');}}
    }
    res.json(result);
  }));
  router.use(async(err,req,res,next)=>{
    if(!req.path.startsWith('/notifications')&&isDbConfigured()){try{await new AlertService(getPool()).error({documentId:null,type:req.path.includes('/bridge')?'bridge':'ingestion',reason:err instanceof IngestError?err.code:'ingestion_temporarily_unavailable',filename:req.body?.filename});}catch{console.error('[alerts] unable to persist request failure');}} 
    if(err instanceof IngestError) return res.status(err.status).json({error:err.code});
    if(err.type==='entity.too.large') return res.status(413).json({error:'payload_too_large'});
    if(err.type==='entity.parse.failed') return res.status(400).json({error:'invalid_json'});
    console.error('[ingestion] request failed',err.code || err.name);
    res.status(503).json({error:'ingestion_temporarily_unavailable'});
  });
  return router;
}
