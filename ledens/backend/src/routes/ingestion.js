import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { getPool, isDbConfigured } from '../db/pool.js';
import { validateInvoice, IngestError } from '../ingestion/validation.js';
import { InvoiceOcr } from '../ingestion/ocr.js';
import { IngestionService } from '../ingestion/service.js';
import {AlertService} from '../notifications/service.js';
import {BridgeService} from '../bridge/service.js';

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
  router.post('/',handle(async(req,res)=>{
    const file=await validateInvoice(req.body,settings());
    const result=await getService().receive(file);
    res.status(result.replay||result.duplicate?200:202).json(result);
  }));
  router.post('/bridge/run',handle(async(req,res)=>{
    if(process.env.BRIDGE_ENABLED!=='true')return res.status(503).json({error:'bridge_disabled'});
    const result=await new BridgeService(getPool()).run(50);
    res.status(result.errors?503:200).json(result);
  }));
  router.post('/notifications/claim',handle(async(req,res)=>res.json(await new AlertService(getPool()).claim())));
  router.post('/notifications/:id/ack',handle(async(req,res)=>{
    if(!/^[0-9a-f-]{36}$/i.test(req.body?.lease_token||'')||typeof req.body?.delivered!=='boolean')return res.status(400).json({error:'invalid_ack'});
    const ok=await new AlertService(getPool()).acknowledge(req.params.id,req.body.lease_token,req.body.delivered);
    res.status(ok?200:409).json({acknowledged:ok});
  }));
  router.param('id',(req,res,next,id)=>{
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return res.status(400).json({error:'invalid_id'});
    next();
  });
  router.post('/:id/process',handle(async(req,res)=>res.json(await getService().process(req.params.id))));
  router.post('/:id/archive',handle(async(req,res)=>{
    const result=await getService().archived(req.params.id,req.body?.archive_url);
    if(process.env.BRIDGE_ENABLED==='true'){
      try{await new BridgeService(getPool()).evaluate(result.document_id,{force:true});}
      catch(e){console.error('[bridge] deferred',e.code||e.name);try{await new AlertService(getPool()).error({type:'bridge',documentId:result.document_id,reason:e.code||'bridge_deferred'});}catch{console.error('[alerts] unable to persist Bridge failure');}}
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
