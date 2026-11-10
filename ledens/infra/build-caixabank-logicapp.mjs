// Logic App «ledens-caixabank-statements»: a CaixaBank statement (.txt, Norma 43)
// created in SharePoint «datasource/Caixabank/Landing» is sent to the backend,
// which adds its movements to ledens.bank_movements; only when the backend
// answers «processed» is the file moved to «datasource/Caixabank/Archive».
// A refused file (422) fails the run and stays in Landing.
// Secret-free: the ingestion token is read from Key Vault during the run.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const subscription='ee069061-db06-4a57-8ce7-c752a2985d27';
const resourceGroup='rg-ledens';
const connection='sharepoint-ledens-facturas';
const site='https://ledenses.sharepoint.com/sites/ledens.es';
const library='78eabd65-e3fe-4141-9845-8a07aa8136df'; // «Shared Documents», as in invoice-flow-source.json
const landing='datasource/Caixabank/Landing';
const archive='datasource/Caixabank/Archive';
const api='https://ambitious-island-05d1d8a03.2.azurestaticapps.net/api/v1/facturas/ingesta/extractos/caixabank';

// Same translation of connector operations (swagger → ApiConnection) as build-invoice-logicapp.mjs.
function connectorInputs(operations,operationId,values){
  const op=operations[operationId];
  if(!op)throw Error('Missing connector operation '+operationId);
  const expr=value=>typeof value==='string'&&value.startsWith('@')?value.slice(1):`'${String(value).replaceAll("'","''")}'`;
  let url=op.url.replace('/{connectionId}','');
  const inputs={host:{connection:{name:"@parameters('$connections')['sharepointonline']['connectionId']"}},method:op.method};
  for(const param of op.spec.parameters){
    if(param.name==='connectionId')continue;
    if(param.in==='path'){
      let encoded=`encodeURIComponent(${expr(values[param.name])})`;
      if(param['x-ms-url-encoding']==='double')encoded=`encodeURIComponent(${encoded})`;
      url=url.replace(`{${param.name}}`,`@{${encoded}}`);
    }else if(param.in==='query'&&values[param.name]!==undefined){
      (inputs.queries??={})[param.name]=values[param.name];
    }else if(param.in==='body'){
      inputs.body=values[param.name]||Object.fromEntries(Object.entries(values)
        .filter(([k])=>k.startsWith(param.name+'/')).map(([k,v])=>[k.slice(param.name.length+1),v]));
    }
  }
  inputs.path=url;
  return inputs;
}
export function buildCaixabankLogicApp(swagger,{state='Disabled'}={}){
  if(!['Disabled','Enabled'].includes(state))throw new Error('invalid_state');
  const operations={};
  for(const [url,methods] of Object.entries(swagger.paths))
    for(const [method,spec] of Object.entries(methods))if(spec.operationId)operations[spec.operationId]={url,method,spec};
  const secure={secureData:{properties:['inputs','outputs']}};
  const sp=(op,parameters,runAfter={})=>({type:'ApiConnection',inputs:connectorInputs(operations,op,{dataset:site,...parameters}),runAfter,runtimeConfiguration:secure});
  const after=name=>({[name]:['Succeeded']});
  const definition={
    '$schema':'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
    contentVersion:'1.0.0.0',parameters:{'$connections':{type:'Object',defaultValue:{}}},outputs:{},
    triggers:{When_a_statement_is_created:{...sp('GetOnNewFileItems',{table:library,folderPath:'/Shared Documents/'+landing}),
      recurrence:{frequency:'Minute',interval:5},splitOn:"@triggerOutputs()?['body/value']",
      conditions:[{expression:`@and(equals(triggerBody()?['{IsFolder}'],false),equals(toLower(triggerBody()?['{Path}']),'${('Shared Documents/'+landing+'/').toLowerCase()}'))`}],
      runtimeConfiguration:{secureData:{properties:['outputs']}}}},
    actions:{
      Get_content:sp('GetFileContent',{id:"@triggerBody()?['{Identifier}']",inferContentType:true}),
      Get_ingest_token:{type:'Http',runAfter:after('Get_content'),runtimeConfiguration:secure,inputs:{method:'GET',
        uri:'https://kv-ledens-ee069061.vault.azure.net/secrets/invoice-ingest-token?api-version=7.4',
        authentication:{type:'ManagedServiceIdentity',audience:'https://vault.azure.net'}}},
      // Inputs carry the token and the statement; the output is only the verdict (counts, period).
      Process_statement:{type:'Http',runAfter:after('Get_ingest_token'),runtimeConfiguration:{secureData:{properties:['inputs']}},inputs:{method:'POST',uri:api,
        headers:{Authorization:"@concat('Bearer ',body('Get_ingest_token')?['value'])",'Content-Type':'application/json'},
        body:{site_url:site,library:'Shared Documents',folder:landing,item_id:"@string(triggerBody()?['ID'])",
          filename:"@triggerBody()?['{FilenameWithExtension}']",content_base64:"@base64(body('Get_content'))"},
        retryPolicy:{type:'exponential',count:4,interval:'PT10S'}}},
      Processed:{type:'If',expression:{equals:["@body('Process_statement')?['status']",'processed']},runAfter:after('Process_statement'),
        // A name already in Archive (the bank repeats names) keeps both files: 2 = move with a new name.
        actions:{Move_to_archive:sp('MoveFileAsync',{'parameters/sourceFileId':"@triggerBody()?['{Identifier}']",
          'parameters/destinationDataset':site,'parameters/destinationFolderPath':'/Shared Documents/'+archive,'parameters/nameConflictBehavior':2})},
        else:{actions:{Not_processed:{type:'Terminate',runAfter:{},inputs:{runStatus:'Failed',
          runError:{code:'StatementNotProcessed',message:'The backend did not confirm the statement. The file remains in Landing.'}}}}}}
    }};
  const connectionId=`/subscriptions/${subscription}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/connections/${connection}`;
  const apiId=`/subscriptions/${subscription}/providers/Microsoft.Web/locations/westeurope/managedApis/sharepointonline`;
  return {location:'westeurope',identity:{type:'SystemAssigned'},tags:{proyecto:'ledens',componente:'caixabank-statements'},properties:{
    state,definition,runtimeConfiguration:{lifetime:{unit:'Day',count:7}},
    parameters:{'$connections':{value:{sharepointonline:{connectionId,connectionName:connection,id:apiId}}}}}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const swagger=JSON.parse((await fs.readFile(process.argv[2],'utf8')).replace(/^﻿/,''));
  await fs.writeFile(process.argv[3],JSON.stringify(buildCaixabankLogicApp(swagger),null,2));
}
