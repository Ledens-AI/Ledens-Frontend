# Creates or updates the Logic App «ledens-caixabank-statements» (see build-caixabank-logicapp.mjs).
# Deploy the backend (migration 038 and the /extractos/caixabank endpoint) first.
# Default state is Disabled; -Enable turns it on when the SharePoint connection is authorized.
param([switch]$Enable)
$ErrorActionPreference='Stop'
$taskSubscription='ee069061-db06-4a57-8ce7-c752a2985d27'
$taskSubscriptionRoot='/subscriptions/'+$taskSubscription
$taskResourceRoot=$taskSubscriptionRoot+'/resourceGroups/rg-ledens'
$taskName='ledens-caixabank-statements'
$taskWorkflowPath=$taskResourceRoot+'/providers/Microsoft.Logic/workflows/'+$taskName
$taskConnectionPath=$taskResourceRoot+'/providers/Microsoft.Web/connections/sharepoint-ledens-facturas'
$taskToken=az account get-access-token --subscription $taskSubscription --query accessToken -o tsv
if($LASTEXITCODE -ne 0){throw 'Azure authentication failed'}
function Invoke-StatementArm {
    param([string]$Method='GET',[string]$Path,[object]$Body)
    $taskRequest=@{Method=$Method;Uri=('https://management.azure.com'+$Path);Headers=@{Authorization='Bearer '+$taskToken}}
    if($null -ne $Body){$taskRequest.ContentType='application/json';$taskRequest.Body=[Text.Encoding]::UTF8.GetBytes(($Body|ConvertTo-Json -Depth 100 -Compress))}
    Invoke-RestMethod @taskRequest
}
# The SharePoint connection of the invoice flow is reused: same site, same library.
$taskConnection=Invoke-StatementArm -Path ($taskConnectionPath+'?api-version=2016-06-01')
$taskApiPath=$taskSubscriptionRoot+'/providers/Microsoft.Web/locations/westeurope/managedApis/sharepointonline'
$taskSwagger=Invoke-StatementArm -Path ($taskApiPath+'?api-version=2016-06-01&export=true')
$taskTemporary=Join-Path ([IO.Path]::GetTempPath()) ('ledens-caixabank-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($taskTemporary)|Out-Null
$taskSwaggerFile=Join-Path $taskTemporary 'swagger.json'
$taskDefinitionFile=Join-Path $taskTemporary 'logicapp.json'
$taskSwagger|ConvertTo-Json -Depth 100|Set-Content -LiteralPath $taskSwaggerFile
node (Join-Path $PSScriptRoot 'build-caixabank-logicapp.mjs') $taskSwaggerFile $taskDefinitionFile
if($LASTEXITCODE -ne 0){throw 'Logic App definition generation failed'}
$taskDefinition=Get-Content -LiteralPath $taskDefinitionFile -Raw|ConvertFrom-Json
if($Enable -and @($taskConnection.properties.statuses|Where-Object status -eq 'Connected').Count -gt 0){$taskDefinition.properties.state='Enabled'}
$taskWorkflow=Invoke-StatementArm -Method PUT -Path ($taskWorkflowPath+'?api-version=2019-05-01') -Body $taskDefinition
# The workflow identity may read only the ingestion token.
$taskSecretScope=$taskResourceRoot+'/providers/Microsoft.KeyVault/vaults/kv-ledens-ee069061/secrets/invoice-ingest-token'
az role assignment create --subscription $taskSubscription --assignee-object-id $taskWorkflow.identity.principalId --assignee-principal-type ServicePrincipal --role 'Key Vault Secrets User' --scope $taskSecretScope --output none
if($LASTEXITCODE -ne 0){throw 'Could not grant access to the single ingestion secret'}
# Run and action outcomes (status, codes, durations; never bodies) go to log-ledens.
$taskWorkspace=$taskResourceRoot+'/providers/Microsoft.OperationalInsights/workspaces/log-ledens'
Invoke-StatementArm -Method PUT -Path ($taskWorkflowPath+'/providers/Microsoft.Insights/diagnosticSettings/ledens-caixabank-runs?api-version=2021-05-01-preview') -Body @{
    properties=@{workspaceId=$taskWorkspace;logs=@(@{category='WorkflowRuntime';enabled=$true})}
}|Out-Null
# A failed run (refused statement, backend down, move failed) emails the existing action group.
$taskGroupId=$taskResourceRoot+'/providers/Microsoft.Insights/actionGroups/ledens-transaction-alerts'
Invoke-StatementArm -Method PUT -Path ($taskResourceRoot+'/providers/Microsoft.Insights/metricAlerts/'+$taskName+'-failed?api-version=2018-03-01') -Body @{
    location='global';properties=@{description=('Fallo en '+$taskName+': el extracto sigue en Landing. Revisar ejecución en Azure.');severity=2;enabled=$true;scopes=@($taskWorkflowPath)
        evaluationFrequency='PT1M';windowSize='PT5M';autoMitigate=$true
        criteria=@{'odata.type'='Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria';allOf=@(@{name='FailedRuns';metricName='RunsFailed';metricNamespace='Microsoft.Logic/workflows';operator='GreaterThan';threshold=0;timeAggregation='Total';criterionType='StaticThresholdCriterion'})}
        actions=@(@{actionGroupId=$taskGroupId})}
}|Out-Null
[pscustomobject]@{name=$taskWorkflow.name;state=$taskWorkflow.properties.state;sharepointStatus=$taskConnection.properties.statuses.status}|ConvertTo-Json
if($taskWorkflow.properties.state -eq 'Disabled'){Write-Output 'Prepared Disabled. Rerun with -Enable once the backend is deployed. No polling runs while disabled.'}
Write-Output ('Generated definition: '+$taskDefinitionFile)
