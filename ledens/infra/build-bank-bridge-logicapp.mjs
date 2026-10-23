import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Independent recurrence also retries documents when the bank movement arrives later.
// Deploy Disabled until migrations/backend and BRIDGE_ENABLED are ready.
export function buildBankBridgeLogicApp({state='Disabled'}={}){
 if(!['Disabled','Enabled'].includes(state))throw new Error('invalid_state');
 const secure={secureData:{properties:['inputs','outputs']}};
 return {location:'westeurope',identity:{type:'SystemAssigned'},tags:{proyecto:'ledens',componente:'bank-bridge'},properties:{
   state,runtimeConfiguration:{lifetime:{unit:'Day',count:7}},definition:{
     '$schema':'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
     contentVersion:'1.0.0.0',parameters:{},outputs:{},
     triggers:{Every_15_minutes:{type:'Recurrence',recurrence:{frequency:'Minute',interval:15},
       runtimeConfiguration:{concurrency:{runs:1}}}},
     actions:{Get_ingest_token:{type:'Http',runAfter:{},runtimeConfiguration:secure,inputs:{
       method:'GET',uri:'https://kv-ledens-ee069061.vault.azure.net/secrets/invoice-ingest-token?api-version=7.4',
       authentication:{type:'ManagedServiceIdentity',audience:'https://vault.azure.net'}}},
       Run_bridge:{type:'Http',runAfter:{Get_ingest_token:['Succeeded']},runtimeConfiguration:secure,inputs:{
         method:'POST',uri:'https://ambitious-island-05d1d8a03.2.azurestaticapps.net/api/v1/facturas/ingesta/bridge/run',
         headers:{Authorization:"@concat('Bearer ',body('Get_ingest_token')?['value'])",'Content-Type':'application/json'},
         body:{},retryPolicy:{type:'exponential',count:4,interval:'PT10S',minimumInterval:'PT5S',maximumInterval:'PT1M'}}}}
   }}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(!process.argv[2])throw new Error('Output path required');
 await fs.writeFile(process.argv[2],JSON.stringify(buildBankBridgeLogicApp(),null,2)+'\n');
}
