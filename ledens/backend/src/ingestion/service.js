import { IngestError } from './validation.js';
import { extractInvoice } from './ocr.js';

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
  async receive(file) {
    return this.transaction(async c=>{
      // Serialize both same-content submissions and replays of the same source.
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[file.hash]);
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))',[file.sourceKey]);
      const previous=(await c.query(`SELECT i.*,s.is_duplicate FROM ledens.invoice_sources s
        JOIN ledens.invoice_ingestions i ON i.id=s.ingestion_id WHERE s.source_key=$1`,[file.sourceKey])).rows[0];
      if(previous) {
        if(previous.content_hash!==file.hash) throw new IngestError(409,'source_content_changed');
        return this.response(previous,{duplicate:previous.is_duplicate,replay:true});
      }
      let row=(await c.query('SELECT * FROM ledens.invoice_ingestions WHERE content_hash=$1',[file.hash])).rows[0];
      const duplicate=Boolean(row);
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
      await c.query(`INSERT INTO ledens.invoice_sources
        (source_key,ingestion_id,source_item_id,filename,is_duplicate) VALUES ($1,$2,$3,$4,$5)`,
        [file.sourceKey,row.id,file.item_id,file.filename,duplicate]);
      return this.response(row,{duplicate,replay:false});
    });
  }
  async process(id) {
    return this.transaction(async c=>{
      const row=(await c.query('SELECT * FROM ledens.invoice_ingestions WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!row) throw new IngestError(404,'not_found');
      if(['ready','review','archived'].includes(row.status)) return this.response(row);
      if(!this.ocr) throw new IngestError(503,'ocr_not_configured');
      try {
        if(row.status==='received') {
          row.operation_url=await this.ocr.start(row.content,row.content_type);
          row.status='analyzing';
          await c.query(`UPDATE ledens.invoice_ingestions SET operation_url=$2,status='analyzing',
            updated_at=now() WHERE id=$1`,[id,row.operation_url]);
          return this.response(row);
        }
        const result=await this.ocr.poll(row.operation_url);
        if(['running','notStarted'].includes(result.status)) return this.response(row);
        const extracted=result.status==='succeeded'?extractInvoice(result):{reason:'ocr_failed'};
        if(extracted.reason) {
          row.status='review';row.reason=extracted.reason;
          await c.query(`UPDATE ledens.invoice_ingestions SET status='review',reason=$2,content=NULL,
            updated_at=now() WHERE id=$1`,[id,row.reason]);
        } else {
          row.status='ready';row.invoice_date=extracted.date;
          row.destination_folder=`/Shared Documents/${this.config.archiveRoot}/${extracted.quarter}`;
          await c.query(`UPDATE ledens.documents SET document_on=$2,trimestre=$3,numerodocumento=$4,
            tercero=$5,niftercero=$6,base_amount=$7,vat_amount=$8,total=$9 WHERE id=$1`,
            [row.document_id,extracted.date,extracted.quarter,extracted.number,extracted.vendor,extracted.taxId,
              extracted.subtotal,extracted.tax,extracted.total]);
          await c.query(`UPDATE ledens.invoice_ingestions SET status='ready',invoice_date=$2,date_confidence=$3,
            destination_folder=$4,content=NULL,updated_at=now() WHERE id=$1`,
            [id,extracted.date,extracted.confidence,row.destination_folder]);
        }
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
