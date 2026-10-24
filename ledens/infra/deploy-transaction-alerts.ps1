param([switch]$AuthorizedSecretRead,[switch]$Enable)
$ErrorActionPreference='Stop'
if(-not $AuthorizedSecretRead){throw 'Explicit authorization required: grant only invoice-ingest-token read access to ledens-transaction-alerts.'}
$taskSubscription='ee069061-db06-4a57-8ce7-c752a2985d27'
$taskRoot='/subscriptions/'+$taskSubscription+'/resourceGroups/rg-ledens'
$taskToken=az.cmd account get-access-token --query accessToken -o tsv
if($LASTEXITCODE -ne 0 -or -not $taskToken){throw 'Azure authentication failed'}
function Invoke-AlertsArm([string]$Method,[string]$Resource,[object]$Body){
 $taskOptions=@{Method=$Method;Uri=('https://management.azure.com'+$Resource);Headers=@{Authorization='Bearer '+$taskToken}}
 if($null -ne $Body){$taskOptions.ContentType='application/json';$taskOptions.Body=[Text.Encoding]::UTF8.GetBytes(($Body|ConvertTo-Json -Depth 100 -Compress))}
 Invoke-RestMethod @taskOptions
}
$taskConn=Invoke-AlertsArm GET ($taskRoot+'/providers/Microsoft.Web/connections/office365-ledens-alerts?api-version=2016-06-01')
if($Enable -and -not ($taskConn.properties.statuses | Where-Object status -eq 'Connected')){throw 'Authorize Outlook before enabling'}
$taskJson=Join-Path ([IO.Path]::GetTempPath()) ('ledens-alerts-'+[guid]::NewGuid().ToString()+'.json')
node (Join-Path $PSScriptRoot 'build-transaction-alerts-logicapp.mjs') $taskJson
if($LASTEXITCODE -ne 0){throw 'Unable to build workflow'}
try{$taskDef=Get-Content -Raw -LiteralPath $taskJson | ConvertFrom-Json -AsHashtable}finally{Remove-Item -LiteralPath $taskJson}
$taskWorkflowId=$taskRoot+'/providers/Microsoft.Logic/workflows/ledens-transaction-alerts'
$taskWorkflow=Invoke-AlertsArm PUT ($taskWorkflowId+'?api-version=2019-05-01') $taskDef
$taskSecret=$taskRoot+'/providers/Microsoft.KeyVault/vaults/kv-ledens-ee069061/secrets/invoice-ingest-token'
$taskAssignments=Invoke-AlertsArm GET ($taskSecret+'/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01')
$taskRole='/subscriptions/'+$taskSubscription+'/providers/Microsoft.Authorization/roleDefinitions/4633458b-17de-408a-b874-0445c86b69e6'
if(-not ($taskAssignments.value | Where-Object {$_.properties.principalId -eq $taskWorkflow.identity.principalId -and $_.properties.roleDefinitionId -eq $taskRole -and $_.properties.scope -eq $taskSecret})){
 $null=Invoke-AlertsArm PUT ($taskSecret+'/providers/Microsoft.Authorization/roleAssignments/'+[guid]::NewGuid().ToString()+'?api-version=2022-04-01') @{properties=@{principalId=$taskWorkflow.identity.principalId;principalType='ServicePrincipal';roleDefinitionId=$taskRole}}
}
$taskGroupId=$taskRoot+'/providers/Microsoft.Insights/actionGroups/ledens-transaction-alerts'
$null=Invoke-AlertsArm PUT ($taskGroupId+'?api-version=2023-01-01') @{location='global';properties=@{groupShortName='LedensTxn';enabled=$true;emailReceivers=@(@{name='Alvaro';emailAddress='alvaro.navarro@ledens.es';useCommonAlertSchema=$true})}}
foreach($taskName in @('ledens-invoice-ingestion','ledens-bank-bridge','ledens-transaction-alerts')){
 $taskScope=$taskRoot+'/providers/Microsoft.Logic/workflows/'+$taskName
 $taskRule=@{location='global';properties=@{description=('Fallo técnico en '+$taskName+'. Revisar ejecución en Azure.');severity=2;enabled=$true;scopes=@($taskScope);evaluationFrequency='PT1M';windowSize='PT5M';autoMitigate=$true;criteria=@{'odata.type'='Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria';allOf=@(@{name='FailedRuns';metricName='RunsFailed';metricNamespace='Microsoft.Logic/workflows';operator='GreaterThan';threshold=0;timeAggregation='Total';criterionType='StaticThresholdCriterion'})};actions=@(@{actionGroupId=$taskGroupId})}}
 $null=Invoke-AlertsArm PUT ($taskRoot+'/providers/Microsoft.Insights/metricAlerts/'+$taskName+'-failed?api-version=2018-03-01') $taskRule
}
if($Enable){$null=Invoke-AlertsArm POST ($taskWorkflowId+'/enable?api-version=2019-05-01');Write-Output 'Email workflow enabled. Verify a real delivered_at and received email.'}
else{Write-Output 'Email workflow prepared Disabled. Confirm migration 011 and Outlook connection before enabling.'}
