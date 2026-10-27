import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function buildTransactionAlertsLogicApp({state='Disabled'}={}){
 if(!['Disabled','Enabled'].includes(state))throw new Error('invalid_state');
 const root='/subscriptions/ee069061-db06-4a57-8ce7-c752a2985d27';
 const secure={secureData:{properties:['inputs','outputs']}};
 const auth={Authorization:"@concat('Bearer ',body('Get_ingest_token')?['value'])",'Content-Type':'application/json'};
 const api='https://ambitious-island-05d1d8a03.2.azurestaticapps.net/api/v1/facturas/ingesta/notifications';
 const ack=(delivered,after)=>({type:'Http',runAfter:after,runtimeConfiguration:secure,inputs:{method:'POST',uri:"@concat('"+api+"/',items('Deliver_messages')?['id'],'/ack')",headers:auth,body:{lease_token:"@items('Deliver_messages')?['lease_token']",delivered},retryPolicy:{type:'exponential',count:3,interval:'PT10S'}}});
 return {location:'westeurope',identity:{type:'SystemAssigned'},tags:{proyecto:'ledens',componente:'transaction-alerts'},properties:{state,runtimeConfiguration:{lifetime:{unit:'Day',count:7}},parameters:{'$connections':{value:{office365:{connectionId:root+'/resourceGroups/rg-ledens/providers/Microsoft.Web/connections/office365-ledens-alerts',connectionName:'office365-ledens-alerts',id:root+'/providers/Microsoft.Web/locations/westeurope/managedApis/office365'}}}},definition:{'$schema':'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',contentVersion:'1.0.0.0',parameters:{'$connections':{type:'Object',defaultValue:{}}},outputs:{},triggers:{Every_5_minutes:{type:'Recurrence',recurrence:{frequency:'Minute',interval:5},runtimeConfiguration:{concurrency:{runs:1}}}},actions:{
 Get_ingest_token:{type:'Http',runAfter:{},runtimeConfiguration:secure,inputs:{method:'GET',uri:'https://kv-ledens-ee069061.vault.azure.net/secrets/invoice-ingest-token?api-version=7.4',authentication:{type:'ManagedServiceIdentity',audience:'https://vault.azure.net'}}},
 Claim_messages:{type:'Http',runAfter:{Get_ingest_token:['Succeeded']},runtimeConfiguration:secure,inputs:{method:'POST',uri:api+'/claim',headers:auth,body:{},retryPolicy:{type:'none'}}},
 Deliver_messages:{type:'Foreach',foreach:"@body('Claim_messages')?['messages']",runAfter:{Claim_messages:['Succeeded']},runtimeConfiguration:{concurrency:{repetitions:1}},actions:{
 Send_email:{type:'ApiConnection',runAfter:{},runtimeConfiguration:secure,inputs:{host:{connection:{name:"@parameters('$connections')['office365']['connectionId']"}},method:'post',path:'/v2/Mail',body:{To:"@coalesce(items('Deliver_messages')?['to'], 'alvaro.navarro@ledens.es;ajnavarrosilva@gmail.com')",Subject:"@items('Deliver_messages')?['subject']",Body:"@items('Deliver_messages')?['html']",Importance:'Normal'},retryPolicy:{type:'none'}}},
 Mark_delivered:ack(true,{Send_email:['Succeeded']}),Retry_later:ack(false,{Send_email:['Failed','TimedOut']})}}
 }}}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(!process.argv[2])throw new Error('Output path required');
 await fs.writeFile(process.argv[2],JSON.stringify(buildTransactionAlertsLogicApp(),null,2)+'\n');
}
