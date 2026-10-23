// Produces a secret-free template; deployment substitutes the token in memory.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function buildInvoiceFlow(current, apiBase) {
  const definition=structuredClone(current.properties.definition);
  const trigger=Object.values(definition.triggers)[0];
  trigger.conditions=[{expression:"@and(equals(triggerBody()?['{IsFolder}'],false),equals(triggerBody()?['{Path}'],'Shared Documents/datasource/Landing facturas/'))"}];
  const site='https://ledenses.sharepoint.com/sites/ledens.es';
  const host={apiId:'/providers/Microsoft.PowerApps/apis/shared_sharepointonline',connectionName:'shared_sharepointonline'};
  const secure={secureData:{properties:['inputs','outputs']}};
  const sp=(op,parameters,runAfter={})=>({type:'OpenApiConnection',inputs:{host:{...host,operationId:op},parameters:{dataset:site,...parameters},authentication:"@parameters('$authentication')"},runAfter,runtimeConfiguration:secure});
  const http=(uri,body,runAfter={})=>({type:'Http',inputs:{uri,method:'POST',headers:{Authorization:'Bearer __LEDENS_INGEST_TOKEN__','Content-Type':'application/json'},body,
    retryPolicy:{type:'exponential',count:4,interval:'PT10S'}},runAfter,runtimeConfiguration:secure});
  const after=name=>({[name]:['Succeeded']});
  const processUrl=`${apiBase}/@{body('Ingest')?['ingestion_id']}/process`;
  definition.actions={
    Get_content:sp('GetFileContent',{id:"@triggerBody()?['{Identifier}']",inferContentType:true}),
    Ingest:http(apiBase,{site_url:site,library:'Shared Documents',folder:'datasource/Landing facturas',item_id:"@string(triggerBody()?['ID'])",
      filename:"@triggerBody()?['{FilenameWithExtension}']",content_base64:"@base64(body('Get_content'))"},after('Get_content')),
    Status:{type:'InitializeVariable',inputs:{variables:[{name:'ingestStatus',type:'string',value:"@body('Ingest')?['status']"}]},runAfter:after('Ingest')},
    Unique_file:{type:'If',expression:{equals:["@body('Ingest')?['duplicate']",false]},runAfter:after('Status'),actions:{
      Poll:{type:'Until',expression:"@or(equals(variables('ingestStatus'),'ready'),equals(variables('ingestStatus'),'review'),equals(variables('ingestStatus'),'archived'))",
        limit:{count:60,timeout:'PT15M'},actions:{
          Wait:{type:'Wait',inputs:{interval:{count:5,unit:'Second'}},runAfter:{}},
          Process:http(processUrl,{},after('Wait')),
          Set_status:{type:'SetVariable',inputs:{name:'ingestStatus',value:"@body('Process')?['status']"},runAfter:after('Process')}
        },runAfter:{}},
      Can_archive:{type:'If',expression:{equals:["@variables('ingestStatus')",'ready']},runAfter:after('Poll'),actions:{
        List_quarters:sp('HttpRequest',{'parameters/method':'GET',
          'parameters/uri':"_api/web/GetFolderByServerRelativePath(decodedurl='/sites/ledens.es/Shared Documents/datasource')/Folders?$select=Name,ServerRelativeUrl",
          'parameters/headers':{Accept:'application/json;odata=nometadata'}}),
        Match_quarter:{type:'Query',inputs:{from:"@body('List_quarters')?['value']",
          where:"@equals(replace(item()?['Name'],' ',''),last(split(body('Process')?['destination_folder'],'/')))"},runAfter:after('List_quarters')},
        One_quarter:{type:'If',expression:{equals:["@length(body('Match_quarter'))",1]},runAfter:after('Match_quarter'),actions:{
          Move_original:sp('MoveFileAsync',{'parameters/sourceFileId':"@triggerBody()?['{Identifier}']",
            'parameters/destinationDataset':site,
            'parameters/destinationFolderPath':"@concat('/Shared Documents/datasource/',first(body('Match_quarter'))?['Name'])",
            'parameters/nameConflictBehavior':0}),
          Confirm_archive:http(`${apiBase}/@{body('Ingest')?['ingestion_id']}/archive`,{
            archive_url:"@concat('https://ledenses.sharepoint.com/sites/ledens.es/Shared%20Documents/datasource/',uriComponent(first(body('Match_quarter'))?['Name']),'/',uriComponent(triggerBody()?['{FilenameWithExtension}']))"
          },after('Move_original'))
        },else:{actions:{Missing_quarter:{type:'Terminate',inputs:{runStatus:'Failed',runError:{code:'QuarterFolderNotFound',message:'No unique destination quarter folder. Original remains in Landing facturas.'}},runAfter:{}}}}}
      },else:{actions:{}}}
    },else:{actions:{Duplicate:{type:'Compose',inputs:'Duplicate content; original retained in Landing facturas for review.',runAfter:{}}}}}
  };
  return {properties:{displayName:current.properties.displayName,definition,connectionReferences:current.properties.connectionReferences}};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const current=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
  const output=buildInvoiceFlow(current,process.argv[4]);
  await fs.writeFile(process.argv[3],JSON.stringify(output,null,2));
}
