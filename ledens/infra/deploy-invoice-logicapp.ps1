param([switch]$Enable)
$ErrorActionPreference='Stop'
$taskSubscription='ee069061-db06-4a57-8ce7-c752a2985d27'
$taskSubscriptionRoot='/subscriptions/'+$taskSubscription
$taskResourceRoot=$taskSubscriptionRoot+'/resourceGroups/rg-ledens'
$taskWorkflowPath=$taskResourceRoot+'/providers/Microsoft.Logic/workflows/ledens-invoice-ingestion'
$taskConnectionPath=$taskResourceRoot+'/providers/Microsoft.Web/connections/sharepoint-ledens-facturas'
$taskToken=az account get-access-token --subscription $taskSubscription --query accessToken -o tsv
if($LASTEXITCODE -ne 0){throw 'Azure authentication failed'}
function Invoke-InvoiceArm {
    param([string]$Method='GET',[string]$Path,[object]$Body)
    $taskRequest=@{Method=$Method;Uri=('https://management.azure.com'+$Path);Headers=@{Authorization='Bearer '+$taskToken}}
    if($null -ne $Body){$taskRequest.ContentType='application/json';$taskRequest.Body=[Text.Encoding]::UTF8.GetBytes(($Body|ConvertTo-Json -Depth 100 -Compress))}
    Invoke-RestMethod @taskRequest
}
az provider register --namespace Microsoft.Logic --subscription $taskSubscription --wait --output none
if($LASTEXITCODE -ne 0){throw 'Logic Apps provider registration failed'}
$taskApiPath=$taskSubscriptionRoot+'/providers/Microsoft.Web/locations/westeurope/managedApis/sharepointonline'
$taskSwagger=Invoke-InvoiceArm -Path ($taskApiPath+'?api-version=2016-06-01&export=true')
$taskTemporary=Join-Path ([IO.Path]::GetTempPath()) ('ledens-logicapp-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($taskTemporary)|Out-Null
$taskSwaggerFile=Join-Path $taskTemporary 'swagger.json'
$taskDefinitionFile=Join-Path $taskTemporary 'logicapp.json'
$taskSwagger|ConvertTo-Json -Depth 100|Set-Content -LiteralPath $taskSwaggerFile
node (Join-Path $PSScriptRoot 'build-invoice-logicapp.mjs') (Join-Path $PSScriptRoot 'invoice-flow-source.json') $taskSwaggerFile $taskDefinitionFile
if($LASTEXITCODE -ne 0){throw 'Logic App definition generation failed'}
try {$taskConnection=Invoke-InvoiceArm -Path ($taskConnectionPath+'?api-version=2016-06-01')}
catch {
    if([int]$_.Exception.Response.StatusCode -ne 404){throw}
    $taskConnection=Invoke-InvoiceArm -Method PUT -Path ($taskConnectionPath+'?api-version=2016-06-01') -Body @{
        location='westeurope';kind='V1';properties=@{displayName='Ledens - Invoice ingestion';api=@{id=$taskApiPath}}
    }
}
$taskDefinition=Get-Content -LiteralPath $taskDefinitionFile -Raw|ConvertFrom-Json
if($Enable -and @($taskConnection.properties.statuses|Where-Object status -eq 'Connected').Count -gt 0){$taskDefinition.properties.state='Enabled'}
$taskWorkflow=Invoke-InvoiceArm -Method PUT -Path ($taskWorkflowPath+'?api-version=2019-05-01') -Body $taskDefinition
$taskSecretScope=$taskResourceRoot+'/providers/Microsoft.KeyVault/vaults/kv-ledens-ee069061/secrets/invoice-ingest-token'
az role assignment create --subscription $taskSubscription --assignee-object-id $taskWorkflow.identity.principalId --assignee-principal-type ServicePrincipal --role 'Key Vault Secrets User' --scope $taskSecretScope --output none
if($LASTEXITCODE -ne 0){throw 'Could not grant access to the single ingestion secret'}
[pscustomobject]@{name=$taskWorkflow.name;state=$taskWorkflow.properties.state;sharepointStatus=$taskConnection.properties.statuses.status}|ConvertTo-Json
if($taskWorkflow.properties.state -eq 'Disabled'){Write-Output 'Authorize the SharePoint API connection in Azure, then rerun with -Enable. No polling runs while disabled.'}
Write-Output ('Generated definition: '+$taskDefinitionFile)
