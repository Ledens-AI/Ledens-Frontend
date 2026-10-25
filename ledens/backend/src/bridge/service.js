import {hasPurchases,purchaseFundingState} from '../finance/purchases.js';
import {AlertService} from '../notifications/service.js';
import {createHash} from 'node:crypto';
import {LOCK_ID,RULE_VERSION,OWNED_RULE_VERSIONS,NEAR_DATE_DAYS,bankMatchRule,cents,abs,decimal,day,automaticBlock,eligibleBank,hasParty,hasReference,documentFingerprint,bankFingerprint} from './rules.js';

export class BridgeError extends Error{constructor(status,code){super(code);this.status=status;this.code=code;}}
const DOC=`SELECT d.*,to_jsonb(i)->>'invoice_currency' invoice_currency,i.date_confidence,
  to_jsonb(i)->'party_evidence' party_evidence,to_jsonb(i)->'purchase_proof' purchase_proof,
  (to_jsonb(i)->>'total_confidence')::numeric total_confidence,(to_jsonb(i)->>'number_confidence')::numeric number_confidence,
  (to_jsonb(i)->>'party_confidence')::numeric party_confidence,(to_jsonb(i)->>'tax_id_confidence')::numeric tax_id_confidence,
  (to_jsonb(i)->>'direction_confidence')::numeric direction_confidence FROM ledens.documents d
  LEFT JOIN ledens.invoice_ingestions i ON i.document_id=d.id`;
const BANK=`SELECT b.*,
  (SELECT COALESCE(sum(abs(a.allocated_amount)),0)::text FROM ledens.bank_document_allocations a WHERE a.bank_movement_id=b.id AND a.state='Confirmado') confirmed,
  (SELECT count(*)::int FROM ledens.bank_document_allocations a WHERE a.bank_movement_id=b.id) links
  FROM ledens.bank_movements b`;
const amount=n=>cents(String(n));
export class BridgeService{
  constructor(pool){this.pool=pool;}
  async tx(fn){const c=await this.pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock($1)',[LOCK_ID]);const value=await fn(c);await c.query('COMMIT');return value;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
  async event(c,doc,action,detail={},extra={}){
    await c.query(`INSERT INTO ledens.bridge_events(document_id,bank_movement_id,allocation_id,actor_id,action,detail,request_id,request_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[doc,extra.bankId||null,extra.allocationId||null,extra.actorId||null,action,JSON.stringify(detail),extra.requestId||null,extra.requestHash||null]);
  }
  async seed(){
    return this.pool.query(`INSERT INTO ledens.bridge_cases(document_id,reason,next_attempt_at)
      SELECT d.id,CASE WHEN i.id IS NULL THEN 'unverified_currency' ELSE 'awaiting_evaluation' END,
        CASE WHEN i.id IS NULL THEN 'infinity'::timestamptz ELSE now() END
      FROM ledens.documents d LEFT JOIN ledens.invoice_ingestions i ON i.document_id=d.id
      WHERE NOT EXISTS(SELECT 1 FROM ledens.bank_document_allocations a WHERE a.document_id=d.id)
         OR COALESCE((SELECT sum(abs(a.allocated_amount)) FROM ledens.bank_document_allocations a WHERE a.document_id=d.id AND a.state='Confirmado'),0)<>abs(d.total)
         OR EXISTS(SELECT 1 FROM ledens.bank_document_allocations a WHERE a.document_id=d.id AND a.state IS DISTINCT FROM 'Confirmado')
      ON CONFLICT(document_id) DO NOTHING`);
  }
  async load(c,id,lock=false){
    if(lock)await c.query('SELECT id FROM ledens.documents WHERE id=$1 FOR UPDATE',[id]);
    const d=(await c.query(DOC+' WHERE d.id=$1',[id])).rows[0];
    if(!d)throw new BridgeError(404,'document_not_found');return d;
  }
  async allocations(c,id){return (await c.query('SELECT * FROM ledens.bank_document_allocations WHERE document_id=$1',[id])).rows;}
  remaining(d,allocations){const total=amount(d.total);if(total===null)return null;const paid=allocations.filter(a=>a.state==='Confirmado').reduce((s,a)=>s+abs(amount(a.allocated_amount)??0n),0n);return abs(total)-paid;}
  async candidates(c,d){
    if(amount(d.total)===null||day(d.document_on)===null)return {rows:[],overflow:false};
    const workers=Boolean((await c.query("SELECT to_regclass('ledens.worker_payment_batches') name")).rows[0].name);
    const allocations=await this.allocations(c,d.id),remaining=this.remaining(d,allocations);
    if(remaining===null||remaining<=0n)return {rows:[],overflow:false};
    const {rows}=await c.query(BANK+` WHERE sign(b.total_amount)=sign($1::numeric)
      AND b.completed_on BETWEEN $2::date-7 AND $2::date+90
      AND abs(b.total_amount)>=$3::numeric
      ${workers?'AND NOT EXISTS(SELECT 1 FROM ledens.worker_payment_batches wp WHERE wp.bank_movement_id=b.id)':''}
      ORDER BY abs(abs(b.total_amount)-$3::numeric),b.completed_on,b.id LIMIT 101`,[d.total,d.document_on,decimal(remaining)]);
    return {rows:rows.slice(0,100),overflow:rows.length>100};
  }
  summarize(d,b){return {bank_movement_id:b.id,reference:b.reference,description:b.description,beneficiary:b.beneficiary_name,
    state:b.state,existing_links:b.links,
    completed_on:b.completed_on,amount:String(b.total_amount),currency:b.currency,available:decimal(abs(amount(b.total_amount)??0n)-abs(amount(b.confirmed)??0n)),
    reference_match:hasReference(d.numerodocumento,b),party_match:hasParty(d,b),bank_fingerprint:bankFingerprint(b)};}
  async updateCase(c,id,status,reason,candidates=[],options={}){
    const row=(await c.query(`UPDATE ledens.bridge_cases SET status=$2,reason=$3,candidates=$4,
      version=version+CASE WHEN status IS DISTINCT FROM $2 OR reason IS DISTINCT FROM $3 OR candidates IS DISTINCT FROM $4::jsonb THEN 1 ELSE 0 END,
      allocation_id=COALESCE($5,allocation_id),resolution_mode=COALESCE($6,resolution_mode),
      document_fingerprint=COALESCE($7,document_fingerprint),bank_fingerprint=COALESCE($8,bank_fingerprint),
      next_attempt_at=CASE WHEN $9 THEN 'infinity'::timestamptz ELSE now()+interval '15 minutes' END,
      checked_at=now(),updated_at=now() WHERE document_id=$1 RETURNING *`,
      [id,status,reason,JSON.stringify(candidates),options.allocationId||null,options.mode||null,options.documentFingerprint||null,options.bankFingerprint||null,Boolean(options.terminal)])).rows[0];
    return {document_id:id,status:row.status,reason:row.reason,version:row.version};
  }
  async evaluate(id,{force=false}={}){
    return this.tx(async c=>{
      const d=await this.load(c,id,true);
      await c.query('INSERT INTO ledens.bridge_cases(document_id) VALUES($1) ON CONFLICT DO NOTHING',[id]);
      const current=(await c.query('SELECT * FROM ledens.bridge_cases WHERE document_id=$1 FOR UPDATE',[id])).rows[0];
      if(current.status!=='pending')return {document_id:id,status:current.status,reason:current.reason};
      if(!force&&+new Date(current.next_attempt_at)>Date.now())return {document_id:id,status:'pending',reason:current.reason};
      if(await hasPurchases(c)){
        const p=await purchaseFundingState(c,id);
        if(p)return this.updateCase(c,id,cents(p.paid)===cents(p.goods_gross)?'matched':'pending',cents(p.paid)===cents(p.goods_gross)?'covered_by_advance':'awaiting_advance_payment',[],{mode:'document_settlement',terminal:false});
      }
      const allocations=await this.allocations(c,id),remaining=this.remaining(d,allocations);
      if(remaining!==null&&remaining===0n&&allocations.every(a=>a.state==='Confirmado')){
        return this.updateCase(c,id,'matched','existing_allocations',[],{mode:'existing',terminal:true});
      }
      if(allocations.length)return this.updateCase(c,id,'pending','partial_or_existing_allocation',[],{terminal:true});
      const block=automaticBlock(d);
      if(block)return this.updateCase(c,id,'pending',block,[],{terminal:true});
      const result=await this.candidates(c,d);
      const snapshot=result.rows.slice(0,20).map(b=>this.summarize(d,b));
      if(result.overflow)return this.updateCase(c,id,'pending','too_many_candidates',snapshot);
      const compatible=result.rows.filter(b=>b.links===0&&eligibleBank(d,b));
      const referenced=compatible.filter(b=>bankMatchRule(d,b)==='exact_reference');
      const eligible=referenced.length?referenced:compatible;
      if(eligible.length!==1)return this.updateCase(c,id,'pending',eligible.length>1?'ambiguous_match':result.rows.length?'insufficient_evidence':'no_match',snapshot);
      const bank=eligible[0];
      await c.query('SELECT id FROM ledens.bank_movements WHERE id=$1 FOR UPDATE',[bank.id]);
      // A second invoice that can claim this bank movement prevents greedy matching.
      const others=(await c.query(DOC+` WHERE d.id<>$1 AND d.total=$2 AND d.document_on BETWEEN $3::date-90 AND $3::date+7
        AND NOT EXISTS(SELECT 1 FROM ledens.bank_document_allocations a WHERE a.document_id=d.id)
        AND NOT EXISTS(SELECT 1 FROM ledens.bridge_cases x WHERE x.document_id=d.id AND x.status='dismissed')`,[id,d.total,bank.completed_on])).rows;
      if(others.some(x=>eligibleBank({...x,party_confidence:1,tax_id_confidence:1},bank))){
        return this.updateCase(c,id,'pending','competing_document',snapshot);
      }
      const fresh=(await c.query(BANK+' WHERE b.id=$1',[bank.id])).rows[0];
      if(fresh.links!==0||!eligibleBank(d,fresh))return this.updateCase(c,id,'pending','bank_balance_changed',snapshot);
      const allocation=(await c.query(`INSERT INTO ledens.bank_document_allocations
        (document_id,bank_movement_id,allocated_amount,reconciled_on,state,observaciones)
        VALUES($1,$2,$3,CURRENT_DATE,'Confirmado',$4) RETURNING id`,[id,bank.id,d.total,'AUTO_BRIDGE:'+RULE_VERSION])).rows[0];
      await c.query(`UPDATE ledens.documents SET estadopagocobro=$2 WHERE id=$1`,[id,d.tipo==='Pagar'?'Pagado':'Cobrado']);
      await this.event(c,id,'auto_confirmed',{rule:RULE_VERSION,evidence_mode:bankMatchRule(d,bank),amount:String(d.total),reference:hasReference(d.numerodocumento,bank),party:hasParty(d,bank,{verified:true}),near_date_days:bankMatchRule(d,bank)==='exact_reference'?null:NEAR_DATE_DAYS}, {bankId:bank.id,allocationId:allocation.id});
      return this.updateCase(c,id,'matched','auto_confirmed',[],{terminal:true,mode:'automatic',allocationId:allocation.id,documentFingerprint:documentFingerprint(d),bankFingerprint:bankFingerprint(bank)});
    });
  }
  async monitor(id){
    return this.tx(async c=>{
      const x=(await c.query('SELECT * FROM ledens.bridge_cases WHERE document_id=$1 FOR UPDATE',[id])).rows[0];
      if(!x||x.status!=='matched')return;
      if(x.resolution_mode==='document_settlement'){const p=await purchaseFundingState(c,id);if(!p||cents(p.paid)!==cents(p.goods_gross))return this.updateCase(c,id,'pending','advance_funding_changed',[],{mode:'document_settlement'});await c.query('UPDATE ledens.bridge_cases SET checked_at=now() WHERE document_id=$1',[id]);return;}
      if(x.resolution_mode!=='automatic')return;
      const d=await this.load(c,id,true);
      const a=(await c.query('SELECT * FROM ledens.bank_document_allocations WHERE id=$1 FOR UPDATE',[x.allocation_id])).rows[0];
      const b=a?(await c.query(BANK+' WHERE b.id=$1',[a.bank_movement_id])).rows[0]:null;
      if(!a||!b||a.state!=='Confirmado'||documentFingerprint(d)!==x.document_fingerprint||bankFingerprint(b)!==x.bank_fingerprint){
        // Only invalidate the allocation owned by this rule. Imported/manual rows
        // are never rewritten. Review states cease to contribute to ledger views.
        if(a&&OWNED_RULE_VERSIONS.some(v=>a.observaciones==='AUTO_BRIDGE:'+v))await c.query(`UPDATE ledens.bank_document_allocations SET state='Revisar' WHERE id=$1`,[a.id]);
        await this.event(c,id,'source_changed',{}, {allocationId:a?.id,bankId:b?.id});
        await c.query(`UPDATE ledens.documents SET estadopagocobro='Revisar' WHERE id=$1`,[id]);
        return this.updateCase(c,id,'pending','source_changed',[],{terminal:true});
      }
      await c.query('UPDATE ledens.bridge_cases SET checked_at=now() WHERE document_id=$1',[id]);
    });
  }
  async run(limit=50){
    await this.seed();
    const monitor=(await this.pool.query(`SELECT document_id FROM ledens.bridge_cases WHERE status='matched' AND resolution_mode IN ('automatic','document_settlement')
      ORDER BY checked_at NULLS FIRST LIMIT 20`)).rows;
    for(const x of monitor)await this.monitor(x.document_id);
    const pending=(await this.pool.query(`SELECT document_id FROM ledens.bridge_cases WHERE status='pending' AND next_attempt_at<=now()
      ORDER BY next_attempt_at,created_at LIMIT $1`,[limit])).rows;
    const results=[];
    for(const row of pending){try{results.push(await this.evaluate(row.document_id));}catch(e){results.push({document_id:row.document_id,status:'error',reason:e.code||'bridge_failed'});try{await new AlertService(this.pool).error({type:'bridge',documentId:row.document_id,reason:e.code||'bridge_failed'});}catch{console.error('[alerts] unable to persist Bridge failure');}}}
    return {evaluated:results.length,matched:results.filter(x=>x.status==='matched').length,pending:results.filter(x=>x.status==='pending').length,errors:results.filter(x=>x.status==='error').length};
  }
  async preview(limit=1000){
    const c=await this.pool.connect();
    try{
      await c.query('BEGIN READ ONLY');
      const docs=(await c.query(DOC+` WHERE NOT EXISTS(SELECT 1 FROM ledens.bank_document_allocations a
        WHERE a.document_id=d.id AND a.state='Confirmado' GROUP BY a.document_id
        HAVING sum(abs(a.allocated_amount))=abs(d.total)) ORDER BY d.id LIMIT $1`,[limit])).rows;
      const reasons={};let possible=0;
      for(const d of docs){
        let reason=automaticBlock(d);
        if(!reason){const options=await this.candidates(c,d);const n=options.rows.filter(b=>b.links===0&&eligibleBank(d,b)).length;reason=options.overflow?'too_many_candidates':n===1?'unique_candidate_requires_final_lock_check':n>1?'ambiguous_match':'no_match';if(n===1&&!options.overflow)possible++;}
        reasons[reason]=(reasons[reason]||0)+1;
      }
      await c.query('ROLLBACK');return {mode:'read_only',examined:docs.length,possible,reasons};
    }finally{await c.query('ROLLBACK').catch(()=>{});c.release();}
  }
  async details(id){
    const d=await this.load(this.pool,id);
    const x=(await this.pool.query('SELECT * FROM ledens.bridge_cases WHERE document_id=$1',[id])).rows[0];
    if(!x)throw new BridgeError(404,'case_not_found');
    const choices=await this.candidates(this.pool,d);
    const allocations=await this.allocations(this.pool,id);
    return {case:x,document:{...d,document_fingerprint:documentFingerprint(d),remaining:decimal(this.remaining(d,allocations)??0n)},
      candidates:choices.rows.map(b=>this.summarize(d,b)),candidate_limit:choices.overflow};
  }
  async confirm(id,body,actorId){
    const value=amount(body.amount);
    if(value===null||value<=0n||body.currency!=='EUR'||!['Pagar','Cobrar'].includes(body.tipo)||typeof body.reason!=='string'||body.reason.trim().length<5||body.reason.length>1000)throw new BridgeError(400,'invalid_confirmation');
    const requestHash=createHash('sha256').update(JSON.stringify([id,body.bank_movement_id,body.amount,body.currency,body.tipo,body.reason,actorId])).digest('hex');
    return this.tx(async c=>{
      const replay=(await c.query('SELECT request_hash,allocation_id FROM ledens.bridge_events WHERE request_id=$1',[body.request_id])).rows[0];
      if(replay){if(replay.request_hash!==requestHash)throw new BridgeError(409,'idempotency_conflict');return {status:'confirmed',allocation_id:replay.allocation_id,replay:true};}
      const d=await this.load(c,id,true);
      const documentBefore={total:String(d.total),tipo:d.tipo};
      const created=(await c.query('INSERT INTO ledens.bridge_cases(document_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING document_id',[id])).rows.length>0;
      const x=(await c.query('SELECT * FROM ledens.bridge_cases WHERE document_id=$1 FOR UPDATE',[id])).rows[0];
      if(!x||x.status!=='pending'||(created?0:x.version)!==body.version||documentFingerprint(d)!==body.document_fingerprint)throw new BridgeError(409,'case_changed');
      await c.query('SELECT id FROM ledens.bank_movements WHERE id=$1 FOR UPDATE',[body.bank_movement_id]);
      const b=(await c.query(BANK+' WHERE b.id=$1',[body.bank_movement_id])).rows[0];
      if(Boolean((await c.query("SELECT to_regclass('ledens.worker_payment_batches') name")).rows[0].name)&&(await c.query('SELECT 1 FROM ledens.worker_payment_batches WHERE bank_movement_id=$1',[body.bank_movement_id])).rows.length)throw new BridgeError(409,'bank_is_worker_payment');
      if(!b||bankFingerprint(b)!==body.bank_fingerprint)throw new BridgeError(409,'bank_changed');
      if(amount(b.total_amount)===null||amount(b.confirmed)===null)throw new BridgeError(409,'invalid_bank_amount');
      if(b.state!=='COMPLETED'||b.currency!=='EUR'||b.is_internal_transfer===true)throw new BridgeError(409,'ineligible_bank_movement');
      if(d.invoice_currency&&d.invoice_currency!=='EUR')throw new BridgeError(409,'currency_mismatch');
      const total=amount(d.total),rows=await this.allocations(c,id);
      if(total===null||total===0n)throw new BridgeError(409,'incomplete_document');
      const sign=body.tipo==='Pagar'?-1n:1n;
      if((total<0n)!==(sign<0n)){
        if(rows.length)throw new BridgeError(409,'document_sign_requires_review');
        await c.query(`UPDATE ledens.documents SET total=$2,tipo=$3,
          base_amount=CASE WHEN base_amount IS NULL THEN NULL ELSE abs(base_amount)*$4 END,
          vat_amount=CASE WHEN vat_amount IS NULL THEN NULL ELSE abs(vat_amount)*$4 END WHERE id=$1`,[id,decimal(abs(total)*sign),body.tipo,Number(sign)]);
        d.total=decimal(abs(total)*sign);d.tipo=body.tipo;
      }else if(d.tipo!==body.tipo){
        if(rows.length)throw new BridgeError(409,'document_direction_mismatch');
        await c.query('UPDATE ledens.documents SET tipo=$2 WHERE id=$1',[id,body.tipo]);
      }
      if((amount(b.total_amount)<0n)!==(sign<0n))throw new BridgeError(409,'direction_mismatch');
      const existing=rows.find(a=>a.bank_movement_id===b.id);
      if(rows.some(a=>a.state!=='Confirmado'&&a.id!==existing?.id))throw new BridgeError(409,'existing_allocation_requires_review');
      const reserved=(await c.query(`SELECT id FROM ledens.bank_document_allocations WHERE bank_movement_id=$1 AND state IS DISTINCT FROM 'Confirmado'
        AND document_id<>$2 LIMIT 1`,[b.id,id])).rows;
      if(reserved.length)throw new BridgeError(409,'bank_reserved_for_review');
      const docRemaining=this.remaining(d,rows),bankRemaining=abs(amount(b.total_amount))-abs(amount(b.confirmed));
      if(value>docRemaining||value>bankRemaining)throw new BridgeError(409,'insufficient_balance');
      const previous=existing?.state==='Confirmado'?amount(existing.allocated_amount):0n;
      let allocation;
      if(existing){allocation=(await c.query(`UPDATE ledens.bank_document_allocations SET allocated_amount=$2,state='Confirmado',reconciled_on=CURRENT_DATE,
        observaciones=$3 WHERE id=$1 RETURNING id`,[existing.id,decimal(previous+sign*value),'MANUAL_BRIDGE: '+body.reason.trim()])).rows[0];}
      else {allocation=(await c.query(`INSERT INTO ledens.bank_document_allocations(document_id,bank_movement_id,allocated_amount,state,reconciled_on,observaciones)
        VALUES($1,$2,$3,'Confirmado',CURRENT_DATE,$4) RETURNING id`,[id,b.id,decimal(sign*value),'MANUAL_BRIDGE: '+body.reason.trim()])).rows[0];}
      const complete=docRemaining===value;
      await c.query('UPDATE ledens.documents SET estadopagocobro=$2 WHERE id=$1',[id,complete?(body.tipo==='Pagar'?'Pagado':'Cobrado'):'Parcial']);
      await this.event(c,id,'manual_confirmed',{amount:decimal(sign*value),currency:'EUR',reason:body.reason.trim(),document_before:documentBefore,document_after:{total:decimal(abs(total)*sign),tipo:body.tipo}},
        {bankId:b.id,allocationId:allocation.id,actorId,requestId:body.request_id,requestHash});
      await this.updateCase(c,id,complete?'matched':'pending',complete?'manual_confirmed':'partial_payment',[],{terminal:true,mode:'manual',allocationId:allocation.id});
      return {status:complete?'confirmed':'partial',allocation_id:allocation.id,replay:false};
    });
  }
  async dismiss(id,version,reason,actorId){
    if(typeof reason!=='string'||reason.trim().length<5||reason.length>1000)throw new BridgeError(400,'reason_required');
    return this.tx(async c=>{
      const x=(await c.query('SELECT * FROM ledens.bridge_cases WHERE document_id=$1 FOR UPDATE',[id])).rows[0];
      if(!x||x.status!=='pending'||x.version!==version)throw new BridgeError(409,'case_changed');
      await this.event(c,id,'dismissed',{reason:reason.trim()},{actorId});
      return this.updateCase(c,id,'dismissed','business_user_dismissed',[],{terminal:true,mode:'manual'});
    });
  }
}
