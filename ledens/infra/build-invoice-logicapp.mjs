import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInvoiceFlow } from './build-invoice-flow.mjs';

const subscription='ee069061-db06-4a57-8ce7-c752a2985d27';
const resourceGroup='rg-ledens';
const connection='sharepoint-ledens-facturas';
export function buildLogicApp(current, swagger, {state='Disabled'}={}) {
  const flow=buildInvoiceFlow(current,'https://ambitious-island-05d1d8a03.2.azurestaticapps.net/api/v1/facturas/ingesta');
  const definition=flow.properties.definition;
  const operations={};
  for(const [url,methods] of Object.entries(swagger.paths)) {
    for(const [method,spec] of Object.entries(methods)) if(spec.operationId) operations[spec.operationId]={url,method,spec};
  }
  const expr=value=>typeof value==='string'&&value.startsWith('@')?value.slice(1):`'${String(value).replaceAll("'","''")}'`;
  const convert=node=>{
    if(node.type==='OpenApiConnection') {
      const op=operations[node.inputs.host.operationId];
      if(!op) throw Error('Missing connector operation '+node.inputs.host.operationId);
      const values=node.inputs.parameters;
      let url=op.url.replace('/{connectionId}','');
      const inputs={host:{connection:{name:"@parameters('$connections')['sharepointonline']['connectionId']"}},method:op.method};
      for(const param of op.spec.parameters) {
        if(param.name==='connectionId')continue;
        if(param.in==='path') {
          let encoded=`encodeURIComponent(${expr(values[param.name])})`;
          if(param['x-ms-url-encoding']==='double')encoded=`encodeURIComponent(${encoded})`;
          url=url.replace(`{${param.name}}`,`@{${encoded}}`);
        }else if(param.in==='query' && values[param.name]!==undefined) {
          (inputs.queries??={})[param.name]=values[param.name];
        }else if(param.in==='body') {
          inputs.body=values[param.name] || Object.fromEntries(Object.entries(values)
            .filter(([k])=>k.startsWith(param.name+'/')).map(([k,v])=>[k.slice(param.name.length+1),v]));
        }
      }
      inputs.path=url;
      node.type='ApiConnection';node.inputs=inputs;
    }else if(node.type==='Http' && node.inputs.headers?.Authorization) {
      node.inputs.headers.Authorization="@concat('Bearer ',body('Get_ingest_token')?['value'])";
    }
    for(const child of Object.values(node.actions||{}))convert(child);
    for(const child of Object.values(node.else?.actions||{}))convert(child);
  };
  const trigger=Object.values(definition.triggers)[0];
  convert(trigger);trigger.recurrence={frequency:'Minute',interval:5};delete trigger.evaluatedRecurrence;
  trigger.runtimeConfiguration={secureData:{properties:['outputs']}};
  for(const action of Object.values(definition.actions))convert(action);
  definition.actions.Get_ingest_token={type:'Http',inputs:{
    uri:'https://kv-ledens-ee069061.vault.azure.net/secrets/invoice-ingest-token?api-version=7.4',method:'GET',
    authentication:{type:'ManagedServiceIdentity',audience:'https://vault.azure.net'}},
    runAfter:{Get_content:['Succeeded']},runtimeConfiguration:{secureData:{properties:['inputs','outputs']}}};
  definition.actions.Ingest.runAfter={Get_ingest_token:['Succeeded']};
  definition.parameters={'$connections':{type:'Object',defaultValue:{}}};
  const connectionId=`/subscriptions/${subscription}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/connections/${connection}`;
  const apiId=`/subscriptions/${subscription}/providers/Microsoft.Web/locations/westeurope/managedApis/sharepointonline`;
  return {location:'westeurope',identity:{type:'SystemAssigned'},tags:{proyecto:'ledens',componente:'invoice-ingestion'},properties:{
    state,definition,runtimeConfiguration:{lifetime:{unit:'Day',count:7}},
    parameters:{'$connections':{value:{sharepointonline:{connectionId,connectionName:connection,id:apiId}}}}
  }};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const current=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
  const swagger=JSON.parse(await fs.readFile(process.argv[3],'utf8'));
  await fs.writeFile(process.argv[4],JSON.stringify(buildLogicApp(current,swagger),null,2));
}
