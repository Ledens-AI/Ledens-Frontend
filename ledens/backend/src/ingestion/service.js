import {registerPurchaseDocument,hasPurchases,PurchaseReviewError} from '../finance/purchases.js';
import {extractLines,storeInvoiceLines} from '../finance/ingestion.js';
import { IngestError } from './validation.js';
import {archiveIssue} from './completeness.js';
import {cents,decimal} from '../bridge/rules.js';
import { extractInvoice,prepareOcrInput } from './ocr.js';

export class IngestionService {
  constructor(pool, ocr, config) { this.pool=pool; this.ocr=ocr; this.config=config; }
  async transaction(fn) {
    const c=await this.pool.connect();
    try { await c.query('BEGIN'); const value=await fn(c); await c.query('COMMIT'); return value; }
    catch(e) { await c.query('ROLLBACK').catch(()=>{}); throw e; }
    finally {c.release();}
  }
  response(row, extra={}) {
    return { ingestion_id:row.id, document_id:row.document_id, status:row.status,
      reason:row.reason, invoice_date:row.invoice_date instanceof Date ? row.invoice_date.toISOString().slice(0,10) : row.invoice_date || null,
      destination_folder:row.destination_folder, filename:row.filename, ...extra };
  }
  async readyNative(c,row,p,{actorId=null}={}){
    try{await registerPurchaseDocument(c,row.document_id,p,{actorId});}catch(e){if(e instanceof PurchaseReviewError)throw new IngestError(409,e.message);throw e;}
    row.invoice_date=p.issued_on;row.destination_folder='/Shared Documents/'+this.config.archiveRoot+'/'+(Math.floor((Number(p.issued_on.slice(5,7))-1)/3)+1)+'T-'+p.issued_on.slice(0,4);
    if(row.status!=='archived')row.status='ready';row.reason=null;
    await c.query('UPDATE ledens.invoice_ingestions SET status=$2,reason=NULL,invoice_date=$3,destination_folder=$4,content=NULL,updated_at=now() WHERE id=$1',[row.id,row.status,row.invoice_date,row.destination_folder]);
    return row;
  }
  async archiveProblem(c,id){
    const x=(await c.query('SELECT d.*,to_jsonb(i) ingestion FROM ledens.invoice_ingestions i JOIN ledens.documents d ON d.id=i.document_id WHERE i.id=$1',[id])).rows[0];
    if(!x)return 'incomplete_document';
    return archiveIssue({...x,...x.ingestion,document_on:x.document_on,tipo:x.tipo,total:x.total,tercero:x.tercero,numerodocumento:x.numerodocumento,ingestion_hash:x.ingestion.content_hash});
  }
  async checkComplete(c,row){
    if(!['ready','archived'].includes(row.status))return;
    const reason=await this.archiveProblem(c,row.id);if(!reason)return;
    row.status='review';row.reason=reason;
    await c.query("UPDATE ledens.invoice_ingestions SET status='review',reason=$2,updated_at=now() WHERE id=$1",[row.id,reason]);
  }
  async resumePageLimited(c,row,file){
    if(row.status!=='review'||row.reason!=='f0_page_limit'||file.reason||file.hash!==row.content_hash)return;
    row.status='received';row.reason=null;
    await c.query("UPDATE ledens.invoice_ingestions SET status='received',reason=NULL,content=$2,operation_url=NULL,updated_at=now() WHERE id=$1",[row.id,file.content]);
  }
  async readyStatement(c,row,p,{actorId=null}={}){
    await c.query('SELECT pg_advisory_xact_lock(727032)');
    const old=(await c.query('SELECT document_evidence FROM ledens.invoice_ingestions WHERE id=$1',[row.id])).rows[0]?.document_evidence;
    if(old?.fingerprint){if(old.fingerprint!==p.fingerprint)throw new IngestError(409,'statement_evidence_conflict');if(old.content_hash===row.content_hash)return row;}
    const protectedRows=(await c.query("SELECT 1 FROM ledens.financial_records r WHERE document_id=$1 AND source_valid AND status<>'excluded' AND (status<>'pending' OR EXISTS(SELECT 1 FROM ledens.project_financial_allocations a WHERE a.record_id=r.id)) LIMIT 1",[row.document_id])).rows;
    if(protectedRows.length)throw new IngestError(409,'assigned_document_requires_review');
    const prior=(await c.query('SELECT total,tipo,document_on FROM ledens.documents WHERE id=$1 FOR UPDATE',[row.document_id])).rows[0];
    const proof={...p,content_hash:row.content_hash};
    const linked=(await c.query('SELECT 1 FROM ledens.bank_document_allocations WHERE document_id=$1 LIMIT 1',[row.document_id])).rows.length;
    if(linked&&(cents(prior.total)!==cents(p.total)||prior.tipo!==p.direction))throw new IngestError(409,'linked_document_requires_review');
    row.invoice_date=p.date;row.destination_folder='/Shared Documents/'+this.config.archiveRoot+'/'+(Math.floor((Number(p.date.slice(5,7))-1)/3)+1)+'T-'+p.date.slice(0,4);
    if(row.status!=='archived')row.status='ready';row.reason=null;
    await c.query('UPDATE ledens.documents SET total=$2,tipo=$3,document_on=$4,trimestre=$5,tercero=$6 WHERE id=$1',[row.document_id,p.total,p.direction,p.date,row.destination_folder.split('/').at(-1),p.vendor]);
    await c.query('UPDATE ledens.invoice_ingestions SET document_evidence=$2,invoice_currency=$3,invoice_date=$4,status=$5,reason=NULL,destination_folder=$6,content=NULL,updated_at=now() WHERE id=$1',[row.id,JSON.stringify(proof),p.currency,p.date,row.status,row.destination_folder]);
    await storeInvoiceLines(c,row.document_id,[{line_number:1,description:p.description,quantity:1,gross_amount:decimal(cents(p.total)<0n?-cents(p.total):cents(p.total)),currency:p.currency,evidence:{origin:p.source,amount_basis:'statement_gross_only',fingerprint:p.fingerprint}}],{currency:p.currency,direction:p.direction,actorId});
    if(!old)await c.query('INSERT INTO ledens.bridge_events(document_id,actor_id,action,detail) VALUES($1,$2,$3,$4)',[row.document_id,actorId,'statement_extracted',JSON.stringify({source:p.source,content_hash:row.content_hash,before:prior,after:{total:p.total,tipo:p.direction,date:p.date},fingerprint:p.fingerprint})]);
    return row;
  }
  async receive(file) {
    return this.transaction(async c=>{
      if(file.nativePurchase||file.nativeStatement)await c.query('SELECT pg_advisory_xact_lock(727032)');
      // Serialize both same-content submissions and replays of the same source.
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[file.hash]);
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))',[file.sourceKey]);
      const previous=(await c.query(`SELECT i.*,s.is_duplicate,to_jsonb(s)->>'content_hash' source_content_hash FROM ledens.invoice_sources s
        JOIN ledens.invoice_ingestions i ON i.id=s.ingestion_id WHERE s.source_key=$1`,[file.sourceKey])).rows[0];
      if(previous) {
        if((previous.source_content_hash||previous.content_hash)!==file.hash) throw new IngestError(409,'source_content_changed');
        await this.resumePageLimited(c,previous,file);
        if(file.nativePurchase)await this.readyNative(c,previous,file.nativePurchase);
        if(file.nativeStatement)await this.readyStatement(c,previous,file.nativeStatement);
        await this.checkComplete(c,previous);
        return this.response(previous,{duplicate:previous.is_duplicate,replay:true});
      }
      let row=(await c.query('SELECT * FROM ledens.invoice_ingestions WHERE content_hash=$1',[file.hash])).rows[0];
      let duplicate=Boolean(row);
      const purchasesReady=file.nativePurchase&&await hasPurchases(c);
      if(file.nativePurchase&&!purchasesReady)throw new IngestError(503,'purchase_schema_not_ready');
      if(file.nativePurchase&&!row){
        const p=file.nativePurchase;
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,3))',[p.issuer_tax_id+'|'+p.buyer_tax_id+'|'+p.document_number]);
        const canonical=(await c.query('SELECT p.document_id,p.fingerprint FROM ledens.purchase_documents p WHERE issuer_tax_id=$1 AND buyer_tax_id=$2 AND document_number=$3',[p.issuer_tax_id,p.buyer_tax_id,p.document_number])).rows[0];
        if(canonical){if(canonical.fingerprint!==p.fingerprint)throw new IngestError(409,'purchase_identity_conflict');row=(await c.query('SELECT * FROM ledens.invoice_ingestions WHERE document_id=$1 ORDER BY created_at LIMIT 1',[canonical.document_id])).rows[0];if(!row)throw new IngestError(409,'purchase_canonical_source_missing');duplicate=true;}
      }
      if(!row) {
        // source_id/raw_id remain NULL: those columns belong to the legacy import.
        const document=(await c.query(`INSERT INTO ledens.documents
          (registered_on,review_state,enlacearchivo,observaciones)
          VALUES (CURRENT_DATE,'pendiente_revision',$1,'Ingesta automatica; conciliacion pendiente') RETURNING id`,
          [this.config.site+'/Shared%20Documents/'+this.config.folder.split('/').map(encodeURIComponent).join('/')+'/'+encodeURIComponent(file.filename)])).rows[0];
        row=(await c.query(`INSERT INTO ledens.invoice_ingestions
          (document_id,content_hash,filename,content_type,content,status,reason)
          VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [document.id,file.hash,file.filename,file.type,file.reason?null:file.content,file.reason?'review':'received',file.reason])).rows[0];
      }
      await this.resumePageLimited(c,row,file);
      if(file.nativePurchase)await this.readyNative(c,row,file.nativePurchase);
      if(file.nativeStatement)await this.readyStatement(c,row,file.nativeStatement);
      await this.checkComplete(c,row);
      await c.query(`INSERT INTO ledens.invoice_sources
        (source_key,ingestion_id,source_item_id,filename,is_duplicate) VALUES ($1,$2,$3,$4,$5)`,
        [file.sourceKey,row.id,file.item_id,file.filename,duplicate]);
      if(file.nativePurchase)await c.query('UPDATE ledens.invoice_sources SET content_hash=$2 WHERE source_key=$1',[file.sourceKey,file.hash]);
      return this.response(row,{duplicate,replay:false});
    });
  }
  async process(id) {
    return this.transaction(async c=>{
      const row=(await c.query('SELECT * FROM ledens.invoice_ingestions WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!row) throw new IngestError(404,'not_found');
      if(['ready','review','archived'].includes(row.status)){await this.checkComplete(c,row);return this.response(row);}
      if(!this.ocr) throw new IngestError(503,'ocr_not_configured');
      try {
        if(row.status==='received') {
          const input=await prepareOcrInput(row.content,row.content_type);
          row.operation_url=await this.ocr.start(input.content,row.content_type,{prepared:true});
          if(input.scope)await c.query('UPDATE ledens.invoice_ingestions SET document_evidence=$2 WHERE id=$1',[id,JSON.stringify({...input.scope,content_hash:row.content_hash})]);
          row.status='analyzing';
          await c.query(`UPDATE ledens.invoice_ingestions SET operation_url=$2,status='analyzing',
            updated_at=now() WHERE id=$1`,[id,row.operation_url]);
          return this.response(row);
        }
        const result=await this.ocr.poll(row.operation_url);
        if(['running','notStarted'].includes(result.status)) return this.response(row);
        const extracted=result.status==='succeeded'?extractInvoice(result):{reason:'ocr_failed'};
        if(!extracted.reason)extracted.reason=archiveIssue({document_on:extracted.date,total:extracted.total,tipo:extracted.direction,invoice_currency:extracted.currency,date_confidence:extracted.confidence,total_confidence:extracted.totalConfidence,direction_confidence:extracted.directionConfidence});
        if(extracted.reason) {
          row.status='review';row.reason=extracted.reason;
          await c.query(`UPDATE ledens.invoice_ingestions SET status='review',reason=$2,content=NULL,
            updated_at=now() WHERE id=$1`,[id,row.reason]);
        } else {
          row.status='ready';row.invoice_date=extracted.date;
          row.destination_folder=`/Shared Documents/${this.config.archiveRoot}/${extracted.quarter}`;
          await c.query(`UPDATE ledens.documents SET document_on=$2,trimestre=$3,numerodocumento=$4,
            tercero=$5,niftercero=$6,base_amount=$7,vat_amount=$8,total=$9,tipo=$10 WHERE id=$1`,
            [row.document_id,extracted.date,extracted.quarter,extracted.number,extracted.vendor,extracted.taxId,
              extracted.subtotal,extracted.tax,extracted.total,extracted.direction]);
          await c.query(`UPDATE ledens.invoice_ingestions SET status='ready',invoice_date=$2,date_confidence=$3,
            destination_folder=$4,invoice_currency=$5,total_confidence=$6,number_confidence=$7,
            party_confidence=$8,tax_id_confidence=$9,direction_confidence=$10,
            content=NULL,updated_at=now() WHERE id=$1`,
            [id,extracted.date,extracted.confidence,row.destination_folder,extracted.currency,
              extracted.totalConfidence,extracted.numberConfidence,extracted.partyConfidence,
              extracted.taxIdConfidence,extracted.directionConfidence]);
        }
        if(extracted.partyEvidence && (await c.query("SELECT 1 FROM information_schema.columns WHERE table_schema='ledens' AND table_name='invoice_ingestions' AND column_name='party_evidence'")).rows.length)await c.query('UPDATE ledens.invoice_ingestions SET party_evidence=$2 WHERE id=$1',[id,JSON.stringify(extracted.partyEvidence)]);
        const lines=extractLines(result).map(l=>row.document_evidence?.first_page_only?{...l,evidence:{...l.evidence,ocr_pages:[1],original_pages:row.document_evidence.original_pages,first_page_only:true}}:l);
        await storeInvoiceLines(c,row.document_id,lines,extracted);
        return this.response(row);
      } catch(e) {
        if(e instanceof IngestError) throw e;
        if(e.transient===false) {
          row.status='review';row.reason='ocr_rejected_document';
          await c.query(`UPDATE ledens.invoice_ingestions SET status='review',reason=$2,content=NULL,
            updated_at=now() WHERE id=$1`,[id,row.reason]);
          return this.response(row);
        }
        // Keep durable state for retry; never log content, credentials or OCR output.
        throw new IngestError(503,'ocr_temporarily_unavailable');
      }
    });
  }
  async archived(id, archiveUrl) {
    return this.transaction(async c=>{
      const row=(await c.query('SELECT * FROM ledens.invoice_ingestions WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!row) throw new IngestError(404,'not_found');
      if(!['ready','archived'].includes(row.status)) throw new IngestError(409,'not_ready_for_archive');
      if(await this.archiveProblem(c,id))throw new IngestError(409,'incomplete_document_cannot_archive');
      const expected=new URL(this.config.site+row.destination_folder+'/'+encodeURIComponent(row.filename));
      let actual;try{actual=new URL(archiveUrl);}catch{throw new IngestError(400,'invalid_archive_url');}
      const expectedPath=decodeURIComponent(expected.pathname).split('/');
      const actualPath=decodeURIComponent(actual.pathname).split('/');
      // Existing folders include legacy spaces (e.g. "2T- 2025"). Allow that
      // spelling only in the quarter component, never in the root or filename.
      if(actualPath.length===expectedPath.length && actualPath.length>2) {
        actualPath[actualPath.length-2]=actualPath[actualPath.length-2].replace(/\s/g,'');
      }
      if(actual.origin!==expected.origin || actualPath.join('/')!==expectedPath.join('/') || actual.search || actual.hash) {
        throw new IngestError(400,'invalid_archive_url');
      }
      await c.query('UPDATE ledens.documents SET enlacearchivo=$2 WHERE id=$1',[row.document_id,actual.href]);
      await c.query(`UPDATE ledens.invoice_sources SET archive_url=$2 WHERE ingestion_id=$1 AND NOT is_duplicate`,[id,actual.href]);
      await c.query(`UPDATE ledens.invoice_ingestions SET status='archived',updated_at=now() WHERE id=$1`,[id]);
      return this.response({...row,status:'archived'});
    });
  }
}
