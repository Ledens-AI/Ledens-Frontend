// Logs de transacciones (ledens.process_runs, migration 014). `traced()` wraps an
// Express handler: it records the start of the process, then how it ended
// (ok / rechazado / error) with its duration, from the HTTP status and the JSON
// the handler sent. Writing a log never breaks or slows the process itself: any
// failure to log is reported to the console and ignored.
import {getPool,isDbConfigured} from '../db/pool.js';

export const PROCESSES={
 ingesta:'Ingesta de facturas',ocr:'Extracción (OCR)',archivo:'Archivo del original',bridge:'Conciliación Bridge',
 alertas:'Alertas por correo',imputacion:'Imputación a proyectos',validacion:'Validación contable',
 pago_trabajadores:'Pago a trabajadores',proyectos:'Proyectos',trabajadores:'Trabajadores',permisos:'Permisos de finanzas',
};
export const STATUSES=['en_curso','ok','rechazado','error'];
// A run still «en_curso» after this long did not finish (crash, timeout, restart).
export const STALE_MINUTES=15;

let poolOverride=null;
export function setRunLogPool(pool){poolOverride=pool;}
const pool=()=>poolOverride||(isDbConfigured()?getPool():null);
const clip=(v,n=300)=>(v===undefined||v===null?null:String(v).replace(/[\r\n]+/g,' ').slice(0,n));
const AUTOMATION='Automatización (Logic App)';

export async function startRun({process,step,entityType=null,entityId=null,actor=null,detail={}}){
 const p=pool();if(!p)return null;
 try{
  const r=(await p.query(`INSERT INTO ledens.process_runs(process,step,entity_type,entity_id,actor_id,actor_label,detail)
   VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,started_at`,
   [process,clip(step,120),clip(entityType,60),clip(entityId,120),actor?.id||null,clip(actor?.name||actor?.email||actor?.label||AUTOMATION,120),JSON.stringify(detail||{})])).rows[0];
  // Keep about six months: an occasional cleanup instead of a scheduler.
  if(Math.random()<0.002)p.query("DELETE FROM ledens.process_runs WHERE started_at<now()-interval '180 days'").catch(()=>{});
  return {id:r.id,t0:Date.now()};
 }catch(e){console.error('[logs] start not recorded',e.code||e.name);return null;}
}
export async function finishRun(run,{status,message=null,errorCode=null,httpStatus=null,detail=null}){
 const p=pool();if(!p||!run)return;
 try{
  await p.query(`UPDATE ledens.process_runs SET status=$2,finished_at=now(),duration_ms=$3,message=$4,error_code=$5,http_status=$6,
   detail=CASE WHEN $7::jsonb IS NULL THEN detail ELSE detail||$7::jsonb END WHERE id=$1`,
   [run.id,status,Date.now()-run.t0,clip(message),clip(errorCode,100),httpStatus,detail?JSON.stringify(detail):null]);
 }catch(e){console.error('[logs] finish not recorded',e.code||e.name);}
}

async function discardRun(run){
 const p=pool();if(!p||!run)return;
 try{await p.query('DELETE FROM ledens.process_runs WHERE id=$1',[run.id]);}catch(e){console.error('[logs] discard failed',e.code||e.name);}
}

// Only messages our own code writes for people (FinError/FinanceError/IngestError
// codes and Spanish texts) are kept; database or library errors keep their code.
const safeMessage=(e)=>(e&&(e.status||e.code&&/^[a-z_]+$/.test(e.code))?clip(e.message||e.code):null);
const codeOf=(e)=>(e?clip(e.code||(e.status?e.message:null)||e.name||'error',100):null);

/**
 * traced(process, step, { entity(req) → {type,id}, summary(body, req, res) → {message, detail, status} })
 * returns (fn) => Express handler. fn(req, res) is the normal handler body.
 */
export function traced(process,step,{entity,summary}={}){
 return (fn)=>async(req,res,next)=>{
  let ent={};try{ent=entity?.(req)||{};}catch{ent={};}
  const run=await startRun({process,step,entityType:ent.type,entityId:ent.id,actor:req.user||null});
  let body,thrown;
  const json=res.json.bind(res);res.json=(b)=>{body=b;return json(b);};
  res.on('finish',()=>{
   if(!run)return;
   const code=res.statusCode;
   let s={};try{s=(code<400?summary?.(body,req,res):null)||{};}catch{s={};}
   // Intermediate polls (e.g. OCR still analysing) are not worth a row.
   if(s.discard){discardRun(run);return;}
   const status=s.status||(code<400?'ok':code<500?'rechazado':'error');
   const error=status==='ok'?null:(thrown?codeOf(thrown):clip(body?.error,100))||('http_'+code);
   finishRun(run,{status,httpStatus:code,errorCode:error,
    message:s.message||(status==='ok'?null:(thrown?safeMessage(thrown):clip(body?.error))||'Error interno'),detail:s.detail||null});
  });
  try{await fn(req,res);}catch(e){thrown=e;next(e);}
 };
}

// Log page queries (admins only).
export class RunLogService{
 constructor(pool,user={role:'client'}){this.pool=pool;this.user=user;}
 access(){if(this.user.role!=='admin'){const e=new Error('Los logs de transacciones son solo para administradores');e.status=403;throw e;}}
 where(f,params){
  const w=[];const bind=(v)=>{params.push(v);return '$'+params.length;};
  if(f.process){if(!PROCESSES[f.process])throw Object.assign(new Error('Proceso no válido'),{status:400});w.push('process='+bind(f.process));}
  if(f.status){
   if(f.status==='sin_terminar')w.push(`status='en_curso' AND started_at<now()-interval '${STALE_MINUTES} minutes'`);
   else if(f.status==='problemas')w.push(`(status IN ('error','rechazado') OR (status='en_curso' AND started_at<now()-interval '${STALE_MINUTES} minutes'))`);
   else{if(!STATUSES.includes(f.status))throw Object.assign(new Error('Estado no válido'),{status:400});w.push('status='+bind(f.status));}
  }
  for(const [k,op] of [['from','>='],['to','<']])if(f[k]){if(!/^\d{4}-\d{2}-\d{2}$/.test(f[k]))throw Object.assign(new Error('Fecha no válida'),{status:400});
   w.push(`started_at ${op} (${bind(f[k])}::date${k==='to'?" + interval '1 day'":''})`);}
  // Polls that found nothing to do are hidden unless asked for.
  if(!f.empty)w.push(`coalesce(detail->>'vacio','false')<>'true'`);
  if(f.q)w.push(`concat_ws(' ',step,message,error_code,entity_type,entity_id,actor_label) ILIKE ${bind('%'+String(f.q).slice(0,100)+'%')}`);
  return w.length?' WHERE '+w.join(' AND '):'';
 }
 async list(f={}){
  this.access();
  const size=Math.min(100,Math.max(1,Number(f.pageSize)||50)),page=Math.max(1,Math.min(4000,Number(f.page)||1));
  const params=[];const w=this.where(f,params);
  const rows=(await this.pool.query(`SELECT id,process,step,status,started_at,finished_at,duration_ms,entity_type,entity_id,actor_label,message,error_code,http_status,detail,
    (status='en_curso' AND started_at<now()-interval '${STALE_MINUTES} minutes') sin_terminar
   FROM ledens.process_runs${w} ORDER BY started_at DESC,id LIMIT ${size} OFFSET ${(page-1)*size}`,params)).rows;
  const total=(await this.pool.query(`SELECT count(*)::int n FROM ledens.process_runs${w}`,params)).rows[0].n;
  return {rows,total,page,pageSize:size};
 }
 // Last 24 h per process, plus the latest problem of each.
 async summary(){
  this.access();
  // `ultima` counts every run, empty polls included (is the automation alive?);
  // the counters only runs that did something.
  const rows=(await this.pool.query(`SELECT process,count(*) FILTER(WHERE coalesce(detail->>'vacio','false')<>'true')::int total,
    count(*) FILTER(WHERE status='ok' AND coalesce(detail->>'vacio','false')<>'true')::int ok,count(*) FILTER(WHERE status='rechazado')::int rechazados,
    count(*) FILTER(WHERE status='error')::int errores,
    count(*) FILTER(WHERE status='en_curso' AND started_at<now()-interval '${STALE_MINUTES} minutes')::int sin_terminar,
    max(started_at) ultima,max(started_at) FILTER(WHERE status='ok') ultima_ok,
    (array_agg(coalesce(message,error_code) ORDER BY started_at DESC) FILTER(WHERE status IN ('error','rechazado')))[1] ultimo_problema
   FROM ledens.process_runs WHERE started_at>now()-interval '24 hours' GROUP BY process`)).rows;
  return {processes:PROCESSES,last24h:rows,staleMinutes:STALE_MINUTES};
 }
}
