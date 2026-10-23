import fs from 'node:fs/promises';
const ref=name=>({$ref:'#/components/schemas/'+name});
const text={type:'string'},id={type:'string',format:'uuid'},money={type:'string',pattern:'^-?\\d+(\\.\\d+)?$',description:'Exact decimal; never coerce to a binary float for persistence.'};
const nullable=s=>({...s,nullable:true});
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const arr=items=>({type:'array',items});
const date={type:'string',format:'date'},integer={type:'integer'};
const schemas={
 Error:object({error:text},['error']),
 Decimal:money,
 Project:object({id,code:nullable(text),name:nullable(text),address:nullable(text)},['id','code','name','address']),
 Allocation:object({id,record_id:id,project_id:id,allocated_amount:money,created_by:nullable(id),updated_by:nullable(id),created_at:{...text,format:'date-time'},updated_at:{...text,format:'date-time'},project_name:nullable(text)},['id','record_id','project_id','allocated_amount']),
 AllocationInput:object({project_id:id,amount:money},['project_id','amount']),
 Suggestion:object({project_id:id,project_name:nullable(text),rule:{type:'string',enum:['exact_project_code']},evidence:text,status:{type:'string',enum:['suggested']},confidence:nullable({type:'number'})},['project_id','rule','evidence','status','confidence']),
 Record:object({id,material_id:nullable(id),worker_payment_id:nullable(id),customer_payment_id:nullable(id),invoice_line_id:nullable(id),document_id:nullable(id),bank_movement_id:nullable(id),occurred_on:nullable(date),description:nullable(text),counterparty:nullable(text),
 category:{type:'string',enum:['materials','labor','subcontract','other_direct','revenue','advance','overhead','unclassified']},gross_amount:money,net_amount:nullable(money),vat_amount:nullable(money),nondeductible_vat:nullable(money),withholding_amount:nullable(money),currency:nullable(text),status:{type:'string',enum:['pending','approved','excluded']},recognized_on:nullable(date),version:integer,created_at:{...text,format:'date-time'},updated_at:{...text,format:'date-time'},allocations:arr(ref('Allocation')),suggestions:arr(ref('Suggestion')),
 allocated_amount:money,unassigned_amount:money,document_number:nullable(text),reconciled:{type:'boolean'}},['id','gross_amount','version','status','category']),
 Assignment:object({record_id:id,version:{type:'integer',minimum:1},allocations:{...arr(ref('AllocationInput')),maxItems:50}},['record_id','version','allocations']),
 BulkRequest:object({request_id:id,reason:{type:'string',minLength:5,maxLength:1000},records:{...arr(ref('Assignment')),minItems:1,maxItems:100}},['request_id','reason','records']),
 BulkResponse:object({records:arr(ref('Record'))},['records']),
 ProjectAssignment:object({request_id:id,version:integer,project_id:nullable(id),reason:{type:'string',minLength:5}},['request_id','version','project_id','reason']),
 Recognition:object({version:integer,category:{type:'string',enum:['materials','labor','subcontract','other_direct','revenue','advance','overhead']},status:{type:'string',enum:['approved','excluded']},currency:{type:'string',enum:['EUR']},net_amount:money,vat_amount:money,nondeductible_vat:money,withholding_amount:money,recognized_on:nullable(date),reason:{type:'string',minLength:5}},['version','category','status','currency','net_amount','vat_amount','nondeductible_vat','withholding_amount','reason']),
 Event:object({id:{type:'string',description:'PostgreSQL bigint as decimal string'},record_id:id,actor_id:nullable(id),action:text,reason:text,before_value:{type:'object',additionalProperties:true},after_value:{type:'object',additionalProperties:true},created_at:{...text,format:'date-time'}},['id','record_id','action','reason','before_value','after_value','created_at']),
 Line:object({id,document_id:id,line_number:integer,description:nullable(text),quantity:nullable(money),net_amount:nullable(money),vat_amount:nullable(money),gross_amount:nullable(money),currency:nullable(text),extraction_confidence:nullable(money),evidence:{type:'object',additionalProperties:true},record_id:nullable(id),status:nullable(text)},['id','document_id','line_number']),
 LineInput:object({line_number:{type:'integer',minimum:1,maximum:10000},description:{type:'string',minLength:1,maxLength:1000},gross_amount:money,reason:{type:'string',minLength:5}},['line_number','description','gross_amount','reason']),
 Summary:object({project_id:id,currency:{type:'string',enum:['EUR']},budget:nullable(money),budget_status:text,recognized_revenue:money,material_cost:money,labor_cost:money,subcontract_cost:money,other_direct_cost:money,direct_cost:money,invoiced_gross:money,collections:money,payments:money,net_cash_flow:money,pending_review:integer,pending_review_gross:money,direct_result:money,direct_margin_percent:nullable(money),limitations:arr(text)},['project_id','currency','recognized_revenue','direct_cost','direct_result','direct_margin_percent','collections','payments','net_cash_flow']),
 Evolution:object({month:date,revenue:money,direct_cost:money},['month','revenue','direct_cost']),
 Permission:object({user_id:id,project_id:nullable(id),can_write:{type:'boolean'},can_review_unassigned:{type:'boolean'},reason:{type:'string',minLength:5}},['user_id','project_id','can_write','can_review_unassigned','reason']),
 Updated:object({updated:{type:'boolean'}},['updated']),
};
// List responses use compact allocation rows rather than the detailed audit allocation.
schemas.Record.properties.allocations={type:'array',items:{oneOf:[ref('Allocation'),object({project_id:id,project_name:nullable(text),amount:money},['project_id','project_name','amount'])]}};
const page=name=>{const schemaName=name+'Page';schemas[schemaName]=object({items:arr(ref(name)),limit:integer,offset:integer,next_offset:nullable(integer)},['items','limit','offset','next_offset']);return schemaName;};
schemas.Record.properties.source_valid={type:"boolean"};
Object.assign(schemas.Summary.properties,{pending_collections:money,pending_payments:money,budget_base:nullable(money),budget_approved_revisions:nullable(money)});
schemas.BudgetBasis=object({amount_basis:{type:'string',enum:['net']},reason:{type:'string',minLength:5,maxLength:1000}},['amount_basis','reason']);
for(const name of ['Project','Record','Event','Line','Evolution'])page(name);
schemas.AllocationList=object({items:arr(ref('Allocation'))},['items']);
const parameters={
 limit:{name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:100,default:50}},
 offset:{name:'offset',in:'query',schema:{type:'integer',minimum:0,maximum:100000,default:0}},
};
const filters=[...Object.values(parameters),...['type','status','project_id','search','from','to','min','max','sort','unassigned'].map(name=>({name,in:'query',schema:name==='project_id'?id:['from','to'].includes(name)?date:['min','max'].includes(name)?money:name==='unassigned'?{type:'string',enum:['true','false']}:name==='sort'?{type:'string',enum:['date_desc','date_asc','amount_desc']}:text}))];
const paths={};let count=0;
function endpoint(path,method,summary,response,body=null,{paged=false,filtered=false,created=false}={}){
 const params=[...path.matchAll(/\{(\w+)\}/g)].map(m=>({name:m[1],in:'path',required:true,schema:id}));
 if(filtered)params.push(...filters);else if(paged)params.push(...Object.values(parameters));
 const responses={};responses[created?'201':'200']={description:'Success',content:{'application/json':{schema:ref(response)}}};
 for(const status of [400,401,403,404,409,429,503])responses[status]={description:({400:'Invalid parameter or body',401:'Authentication required',403:'Permission or Origin denied',404:'Record/project not found',409:'Stale version, allocation capacity, duplicate representation or idempotency conflict',429:'Rate limit',503:'Database/service unavailable'})[status],content:{'application/json':{schema:ref('Error')}}};
 const operation={operationId:'finance'+(++count),summary,tags:[path.includes('/projects')?'Projects':'Finance'],parameters:params,responses};
 if(body)operation.requestBody={required:true,content:{'application/json':{schema:ref(body)}}};
 paths[path]??={};paths[path][method]=operation;
}
endpoint('/api/projects','get','Projects visible to the authenticated user','ProjectPage',null,{paged:true});
for(const route of ['records','unassigned','materials','worker-payments','customer-payments'])endpoint('/api/finance/'+route,'get','Paginated financial records: '+route,'RecordPage',null,{filtered:true});
endpoint('/api/finance/records/{id}','get','Financial record detail and authorized project suggestions','Record');
endpoint('/api/finance/records/{id}/allocations','get','Current project distribution','AllocationList');
endpoint('/api/finance/records/{id}/history','get','Immutable assignment/accounting history','EventPage',null,{paged:true});
endpoint('/api/finance/records/{id}/project','patch','Replace distribution with one complete project, or clear it','BulkResponse','ProjectAssignment');
endpoint('/api/finance/allocations/bulk','post','Atomically replace up to 100 distributions, with idempotent replay','BulkResponse','BulkRequest');
endpoint('/api/finance/records/{id}/recognition','patch','Approve tax treatment and economic category; never infers recognition from bank payment','Record','Recognition');
endpoint('/api/finance/documents/{id}/lines','get','Extracted invoice lines, including lines still lacking tax amounts','LinePage',null,{paged:true});
endpoint('/api/finance/documents/{id}/lines','post','Register a reviewed line in the pending financial queue','Record','LineInput',{created:true});
for(const route of ['financial-summary','profitability'])endpoint('/api/projects/{projectId}/'+route,'get','Project direct result and treasury, calculated separately','Summary');
endpoint('/api/projects/{projectId}/financial-transactions','get','Project financial records','RecordPage',null,{paged:true});
endpoint('/api/projects/{projectId}/financial-evolution','get','Monthly recognized revenue and direct costs','EvolutionPage',null,{paged:true});
endpoint('/api/finance/permissions','put','Admin grants financial access without changing authentication roles','Updated','Permission');
endpoint('/api/finance/budget-versions/{id}/basis','put','Confirm approved budget lines are net of VAT; source changes invalidate this confirmation','Updated','BudgetBasis');
const api={openapi:'3.0.3',info:{title:'Ledens Project Finance API',version:'1.0.0',description:'Uses existing ledens_session cookie. All writes require Origin equal to CORS_ORIGIN. Financial write grants are explicit; client role is always forbidden. Every bulk amount uses the source record gross basis, including sign. Only approved EUR records affect metrics. No automatic project assignment from ambiguous OCR.'},servers:[{url:'https://ambitious-island-05d1d8a03.2.azurestaticapps.net'}],security:[{session:[]}],paths,components:{securitySchemes:{session:{type:'apiKey',in:'cookie',name:'ledens_session'}},schemas}};
await fs.mkdir(new URL('../../docs/',import.meta.url),{recursive:true});
await fs.writeFile(new URL('../../docs/project-finance.openapi.json',import.meta.url),JSON.stringify(api,null,2)+'\n');
console.log(`OpenAPI: ${Object.keys(paths).length} paths, ${count} operations`);
