#!/usr/bin/env pwsh
#
# Deploy the Caldova demo data and semantic model into an existing Fabric workspace.
#
# This script never creates or deletes a workspace, and never signs you in.
# Authenticate fabio yourself first; the script only checks that it is ready.
#
# This is the PowerShell twin of deploy.sh. Keep the two in step.

[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$Reset,
    [switch]$SkipGenerate,
    [switch]$SkipData,
    [string]$Capacity,
    [Alias('h')][switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RootDir = Split-Path -Parent $PSCommandPath
$DataDir = Join-Path $RootDir 'data'
$GeneratedDir = Join-Path $DataDir 'generated'
$FabricDir = Join-Path $RootDir 'fabric'
$DaxDir = Join-Path $FabricDir 'dax'
$EnvFile = Join-Path $RootDir '.env'
$WorkDir = Join-Path $RootDir '.deploy-work'

$ModelFolderName = 'caldova-operations.SemanticModel'
$ModelSourceDir = Join-Path $FabricDir $ModelFolderName
$DatabaseQueryToken = '{{DATABASE_QUERY_SOURCE}}'
$RestockQueryToken = '{{RESTOCK_QUERY_SOURCE}}'

$TableSpecs = [ordered]@{
    stores            = 'stores.csv'
    products          = 'products.csv'
    inventory         = 'inventory.csv'
    sales             = 'sales.csv'
}
$RestockColumns = @(
    'id', 'store_id', 'sku', 'qty', 'requested_by',
    'requested_by_id', 'requested_at', 'status', 'note'
)

$script:Config = @{}
$script:WorkspaceId = ''
$script:LakehouseId = ''
$script:SqlEndpointId = ''
$script:SqlEndpointConnectionString = ''
$script:SemanticModelId = ''

$env:FABIO_NO_VERSION_CHECK = '1'

function Write-Log {
    param([string]$Message)
    Write-Host "[deploy] $Message"
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[deploy] warning: $Message" -ForegroundColor Yellow
}

function Stop-WithError {
    param([string]$Message)
    Write-Host "[deploy] error: $Message" -ForegroundColor Red
    exit 1
}

function Show-Usage {
    @'
Usage: ./deploy.ps1 [options]

Load the Caldova dataset into a Fabric lakehouse and deploy the semantic model on top of it.
The target workspace must already exist; this script never creates or deletes one, and never
signs you in to fabio.

Options:
  -DryRun            Validate everything locally and print the Fabric calls without making them.
  -Reset             Delete only the named semantic model and lakehouse, then exit.
  -SkipGenerate      Reuse the CSVs already in data/generated instead of regenerating them.
  -SkipData          Leave the Delta tables alone and only deploy the semantic model.
  -Capacity <id>     Assign the workspace to this capacity before deploying.
  -Help              Show this help.

Configuration comes from .env; see .env.example for the full list of settings.
'@ | Write-Host
}

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

function Import-EnvFile {
    if (-not (Test-Path -LiteralPath $EnvFile)) {
        Stop-WithError 'No .env found. Copy .env.example to .env and fill it in.'
    }

    foreach ($rawLine in Get-Content -LiteralPath $EnvFile) {
        $line = $rawLine.TrimEnd("`r")
        if ($line -match '^\s*(#|$)') { continue }
        if ($line -notmatch '=') { continue }

        $key = ($line -split '=', 2)[0].Trim()
        $value = ($line -split '=', 2)[1]
        if (-not $key) { continue }

        if ($value.Length -ge 2) {
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }

        if ($key -like 'FABRIC_*' -or $key -like 'FABIO_*' -or $key -like 'RAYFIN_*') {
            $script:Config[$key] = $value
            if ($key -like 'FABIO_*' -and $value) {
                Set-Item -Path "env:$key" -Value $value
            }
        }
    }
}

function Get-Config {
    param([string]$Key, [string]$Default = '')
    if ($script:Config.Contains($Key) -and $script:Config[$Key]) {
        return $script:Config[$Key]
    }
    return $Default
}

function Set-ConfigDefaults {
    $script:Config['FABRIC_LAKEHOUSE_NAME'] = Get-Config 'FABRIC_LAKEHOUSE_NAME' 'caldova'
    $script:Config['FABRIC_SEMANTIC_MODEL_NAME'] = Get-Config 'FABRIC_SEMANTIC_MODEL_NAME' 'caldova-operations'
    $script:Config['FABRIC_MODEL_STORAGE_MODE'] = Get-Config 'FABRIC_MODEL_STORAGE_MODE' 'onelake'

    if ($Capacity) { $script:Config['FABRIC_CAPACITY_ID'] = $Capacity }

    $mode = Get-Config 'FABRIC_MODEL_STORAGE_MODE'
    if ($mode -ne 'onelake' -and $mode -ne 'sql') {
        Stop-WithError "FABRIC_MODEL_STORAGE_MODE must be 'onelake' or 'sql', got '$mode'."
    }

    if (-not (Get-Config 'FABRIC_WORKSPACE_ID') -and -not (Get-Config 'FABRIC_WORKSPACE_NAME')) {
        Stop-WithError 'Set FABRIC_WORKSPACE_ID or FABRIC_WORKSPACE_NAME in .env. This script never creates a workspace.'
    }
}

# ---------------------------------------------------------------------------
# fabio helpers
# ---------------------------------------------------------------------------

function Invoke-Fabio {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$FabioArgs)
    $output = & fabio --json --lro-timeout 600 @FabioArgs 2>$null
    return [pscustomobject]@{
        Success = ($LASTEXITCODE -eq 0)
        Output  = ($output -join "`n")
    }
}

# Read a single value out of a fabio response through its JMESPath --query support,
# so neither this script nor its bash twin needs a JSON parser.
function Get-FabioValue {
    param(
        [Parameter(Mandatory = $true)][string]$Query,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$FabioArgs
    )
    $output = & fabio --output plain --query $Query --lro-timeout 600 @FabioArgs 2>$null
    if ($LASTEXITCODE -ne 0) { return '' }
    return (($output -join "`n").Trim())
}

function Invoke-FabioWithRetry {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$FabioArgs)
    $maxAttempts = 4
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        if ((Invoke-Fabio @FabioArgs).Success) { return }
        if ($attempt -eq $maxAttempts) {
            Stop-WithError "fabio command failed after $maxAttempts attempts: fabio $($FabioArgs -join ' ')"
        }
        Write-Warn "fabio call failed (attempt $attempt/$maxAttempts); retrying in 10s."
        Start-Sleep -Seconds 10
    }
}

function Write-Preview {
    param([string]$Command)
    Write-Log "would run: fabio $Command"
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

function Test-Prerequisites {
    if (-not (Get-Command fabio -ErrorAction SilentlyContinue)) {
        Write-Host @'
[deploy] error: fabio was not found on PATH.

Install it, then run this script again:
  curl -fsSL https://raw.githubusercontent.com/iemejia/fabio/main/install.sh | bash

This script deliberately does not run remote installers for you.
'@ -ForegroundColor Red
        exit 1
    }

    foreach ($tool in @('node', 'npm')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            Stop-WithError "Required command not found on PATH: $tool"
        }
    }

    if (-not (Test-Path -LiteralPath $ModelSourceDir)) {
        Stop-WithError "Semantic model source not found: $ModelSourceDir"
    }
    $modelFile = Join-Path $ModelSourceDir 'definition/model.tmdl'
    if (-not (Test-Path -LiteralPath $modelFile)) {
        Stop-WithError "Missing definition/model.tmdl in $ModelSourceDir"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $DaxDir 'smoke-test.dax'))) {
        Stop-WithError "Missing smoke test query: $DaxDir/smoke-test.dax"
    }
    if ((Get-Content -LiteralPath $modelFile -Raw) -notlike "*$DatabaseQueryToken*") {
        Stop-WithError "model.tmdl no longer contains the $DatabaseQueryToken placeholder; the deploy cannot bind it to a lakehouse."
    }
    if ((Get-Content -LiteralPath $modelFile -Raw) -notlike "*$RestockQueryToken*") {
        Stop-WithError "model.tmdl no longer contains the $RestockQueryToken placeholder; the deploy cannot bind reorders to the Rayfin database."
    }
}

# fabio is never asked to sign in here. If it is not ready, that is the operator's call.
function Test-Authentication {
    $status = Get-FabioValue 'status' auth status
    if ($status -ne 'authenticated') {
        Write-Host @'
[deploy] error: fabio is not authenticated.

Sign in yourself, then run this script again. This script never runs `fabio auth login`,
because interactive authentication must remain under the operator's control.

Check the current state with:
  fabio auth status
'@ -ForegroundColor Red
        exit 1
    }
    $source = Get-FabioValue 'credential_source' auth status
    Write-Log "fabio is authenticated (source: $source)."
}

# ---------------------------------------------------------------------------
# Workspace
# ---------------------------------------------------------------------------

function Write-EndpointHint {
    Write-Host @'

Verify that the workspace ID or name is correct and that fabio is authenticated
to the tenant that contains it.
'@ -ForegroundColor Yellow
}

function Resolve-Workspace {
    $workspaceId = Get-Config 'FABRIC_WORKSPACE_ID'
    $workspaceName = Get-Config 'FABRIC_WORKSPACE_NAME'

    if ($workspaceId) {
        $resolvedName = Get-FabioValue 'displayName' workspace show --id $workspaceId
        if (-not $resolvedName) {
            Write-Host "[deploy] error: workspace $workspaceId was not found." -ForegroundColor Red
            Write-EndpointHint
            exit 1
        }
        if ($workspaceName -and $resolvedName -ne $workspaceName) {
            Stop-WithError "Workspace $workspaceId is named '$resolvedName', but .env expects '$workspaceName'."
        }
        $script:WorkspaceId = $workspaceId
        Write-Log "Using workspace '$resolvedName' ($($script:WorkspaceId))"
        return
    }

    $matchCount = Get-FabioValue "length([?displayName=='$workspaceName'])" workspace list --all
    if (-not $matchCount) { $matchCount = '0' }

    if ($matchCount -eq '0') {
        Write-Host "[deploy] error: no workspace named '$workspaceName' was found." -ForegroundColor Red
        Write-EndpointHint
        exit 1
    }
    if ($matchCount -ne '1') {
        Stop-WithError "Found $matchCount workspaces named '$workspaceName'. Set FABRIC_WORKSPACE_ID in .env to pick one."
    }

    $script:WorkspaceId = Get-FabioValue "[?displayName=='$workspaceName'].id | [0]" workspace list --all
    if (-not $script:WorkspaceId) {
        Stop-WithError "Could not read the id of workspace '$workspaceName'."
    }
    Write-Log "Using workspace '$workspaceName' ($($script:WorkspaceId))"
}

function Set-WorkspaceCapacity {
    $capacityId = Get-Config 'FABRIC_CAPACITY_ID'
    if (-not $capacityId) { return }

    $current = Get-FabioValue 'capacityId' workspace show --id $script:WorkspaceId
    if ($current -eq $capacityId) {
        Write-Log "Workspace is already on capacity $capacityId"
        return
    }

    Write-Log "Assigning workspace to capacity $capacityId"
    Invoke-FabioWithRetry workspace assign-capacity --id $script:WorkspaceId --capacity $capacityId
}

# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

function Build-Dataset {
    if ($SkipGenerate) {
        Write-Log 'Reusing the CSVs already in data/generated'
    }
    else {
        Write-Log 'Generating the Caldova dataset'
        Push-Location $DataDir
        try {
            & npm run --silent generate
            if ($LASTEXITCODE -ne 0) { Stop-WithError 'The dataset generator failed.' }
        }
        finally { Pop-Location }
    }

    Test-DatasetFiles
}

function Test-DatasetFiles {
    foreach ($file in $TableSpecs.Values) {
        if (-not (Test-Path -LiteralPath (Join-Path $GeneratedDir $file))) {
            Stop-WithError "Expected dataset file is missing: $GeneratedDir/$file. Run 'npm run generate' in data/."
        }
    }
}

function Resolve-Lakehouse {
    $name = Get-Config 'FABRIC_LAKEHOUSE_NAME'
    $matchCount = Get-FabioValue "length([?displayName=='$name'])" lakehouse list --workspace $script:WorkspaceId --all
    if (-not $matchCount) { $matchCount = '0' }

    switch ($matchCount) {
        '0' {
            Write-Log "Creating lakehouse '$name'"
            Invoke-FabioWithRetry lakehouse create --workspace $script:WorkspaceId --name $name
        }
        '1' { Write-Log "Reusing lakehouse '$name'" }
        default {
            Stop-WithError "Found $matchCount lakehouses named '$name' in this workspace. Remove the duplicates first."
        }
    }

    $script:LakehouseId = Get-FabioValue "[?displayName=='$name'].id | [0]" lakehouse list --workspace $script:WorkspaceId --all
    if (-not $script:LakehouseId) {
        Stop-WithError "Could not read the id of lakehouse '$name'."
    }

    Wait-ForSqlEndpoint
    Write-Log "Lakehouse $($script:LakehouseId) ready, SQL endpoint $($script:SqlEndpointId)"
}

function Wait-ForSqlEndpoint {
    for ($attempt = 1; $attempt -le 30; $attempt++) {
        $script:SqlEndpointId = Get-FabioValue 'properties.sqlEndpointProperties.id' lakehouse show --workspace $script:WorkspaceId --id $script:LakehouseId
        $script:SqlEndpointConnectionString = Get-FabioValue 'properties.sqlEndpointProperties.connectionString' lakehouse show --workspace $script:WorkspaceId --id $script:LakehouseId
        if ($script:SqlEndpointId -and $script:SqlEndpointConnectionString) { return }
        Write-Log "Waiting for the lakehouse SQL endpoint to come up (attempt $attempt/30)"
        Start-Sleep -Seconds 10
    }
    Stop-WithError 'The lakehouse SQL endpoint did not become available in time.'
}

function Send-Tables {
    foreach ($table in $TableSpecs.Keys) {
        $file = $TableSpecs[$table]
        Write-Log "Loading $file into Delta table $table"
        Invoke-FabioWithRetry lakehouse upload-table `
            --workspace $script:WorkspaceId `
            --id $script:LakehouseId `
            --source-path (Join-Path $GeneratedDir $file) `
            --table $table `
            --mode Overwrite `
            --format Csv
    }

    Write-Log 'Refreshing SQL endpoint metadata'
    Invoke-FabioWithRetry sql-endpoint refresh-metadata --workspace $script:WorkspaceId --id $script:SqlEndpointId
}

function Test-Tables {
    $missing = @()
    foreach ($table in $TableSpecs.Keys) {
        $found = Get-FabioValue "length([?name=='$table'])" lakehouse list-tables --workspace $script:WorkspaceId --id $script:LakehouseId --all
        if (-not $found -or $found -eq '0') { $missing += $table }
    }

    if ($missing.Count -gt 0) {
        Stop-WithError "These Delta tables did not land in the lakehouse: $($missing -join ' ')"
    }
    Write-Log 'All four Delta tables are present'
}

# The semantic model binds RestockRequests by name and type, so check the shape the
# Rayfin app actually created rather than assuming it matches the model definition.
# The table lives in the Rayfin app's SQL database, which Fabric mirrors into OneLake.
# Reorder history belongs in the Rayfin app's own SQL database, not the lakehouse: the app writes
# there and Fabric mirrors it into OneLake for the model to read. Seeding anywhere else would put
# the same record in two places again.
#
# The generated SQL deletes the seeded ids before inserting them, so a repeat deploy cannot double
# the history, and reorders raised during a demo are untouched because their ids are not in it.
function Add-RestockSeed {
    $databaseId = $script:Config['RAYFIN_SQL_DATABASE_ID']
    if (-not $databaseId) {
        Write-Warn 'RAYFIN_SQL_DATABASE_ID is not set; skipping the seeded reorder history.'
        return
    }

    Write-Log 'Seeding reorder history into the Rayfin database'

    $csv = Join-Path $GeneratedDir 'restock_requests.csv'
    $sql = & node (Join-Path $DataDir 'reorder-seed.js') $csv
    if ($LASTEXITCODE -ne 0 -or -not $sql) {
        Stop-WithError 'Could not build the reorder seed SQL.'
    }

    $result = Invoke-Fabio sql-database query --force --workspace $script:WorkspaceId --id $databaseId --sql ($sql -join "`n")
    if (-not $result.Success) {
        Stop-WithError 'Seeding the reorder history failed.'
    }

    Write-Log 'Seeded reorder history is in place'
}

function Show-RestockSchema {
    $endpointId = $script:Config['RAYFIN_SQL_ENDPOINT_ID']
    if (-not $endpointId) {
        Write-Warn 'RAYFIN_SQL_ENDPOINT_ID is not set; skipping the RestockRequests shape check.'
        return
    }

    $sql = "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'RestockRequests' ORDER BY ORDINAL_POSITION"
    $types = Get-FabioValue "[].join(' ', [COLUMN_NAME, DATA_TYPE])" sql-endpoint query --workspace $script:WorkspaceId --id $endpointId --sql $sql

    if (-not $types) {
        Write-Warn 'Could not read the RestockRequests schema from the Rayfin SQL endpoint. Mirroring may still be catching up.'
        return
    }

    Write-Log 'RestockRequests columns:'
    $lines = $types -split "`n" | Where-Object { $_ }
    foreach ($line in $lines) { Write-Host "[deploy]   $line" }

    $missing = @()
    foreach ($column in $RestockColumns) {
        if (-not ($lines | Where-Object { $_ -like "$column *" })) { $missing += $column }
    }

    if ($missing.Count -gt 0) {
        Stop-WithError "RestockRequests is missing these columns: $($missing -join ' ')"
    }
}

# ---------------------------------------------------------------------------
# Semantic model
# ---------------------------------------------------------------------------

function Set-StagedSemanticModel {
    $modelName = Get-Config 'FABRIC_SEMANTIC_MODEL_NAME'
    $mode = Get-Config 'FABRIC_MODEL_STORAGE_MODE'
    $stagedRoot = Join-Path $WorkDir 'deploy-source'
    $stagedItem = Join-Path $stagedRoot "$modelName.SemanticModel"

    if (Test-Path -LiteralPath $stagedRoot) { Remove-Item -LiteralPath $stagedRoot -Recurse -Force }
    New-Item -ItemType Directory -Path $stagedItem -Force | Out-Null
    Copy-Item -Path (Join-Path $ModelSourceDir '*') -Destination $stagedItem -Recurse -Force

    if ($mode -eq 'onelake') {
        $sourceExpression = "AzureStorage.DataLake(`"https://onelake.dfs.fabric.microsoft.com/$($script:WorkspaceId)/$($script:LakehouseId)`")"
    }
    else {
        if (-not $script:SqlEndpointConnectionString) {
            Stop-WithError 'SQL storage mode needs a SQL endpoint connection string.'
        }
        $sourceExpression = "Sql.Database(`"$($script:SqlEndpointConnectionString)`", `"$($script:SqlEndpointId)`")"
    }

    # Reorders are written by the Rayfin app into its own Fabric SQL database, which
    # Fabric mirrors into OneLake as Delta. Direct Lake reads that copy, so the model and
    # the app never disagree about what was ordered.
    $rayfinDatabaseId = $script:Config['RAYFIN_SQL_DATABASE_ID']
    if (-not $rayfinDatabaseId) {
        Stop-WithError "RAYFIN_SQL_DATABASE_ID is not set. Deploy the Rayfin app with 'npx rayfin up' and copy its SQL database id into .env."
    }
    $restockExpression = "AzureStorage.DataLake(`"https://onelake.dfs.fabric.microsoft.com/$($script:WorkspaceId)/$rayfinDatabaseId`")"

    $modelFile = Join-Path $stagedItem 'definition/model.tmdl'
    $modelText = Get-Content -LiteralPath $modelFile -Raw
    $modelText = $modelText.Replace($DatabaseQueryToken, $sourceExpression)
    Set-Content -LiteralPath $modelFile -Value $modelText.Replace($RestockQueryToken, $restockExpression) -NoNewline

    $platformFile = Join-Path $stagedItem '.platform'
    $platformText = Get-Content -LiteralPath $platformFile -Raw
    Set-Content -LiteralPath $platformFile -Value $platformText.Replace('caldova-operations', $modelName) -NoNewline

    # A SQL-endpoint binding addresses tables through a schema; a schema-less lakehouse
    # read straight from OneLake does not have one. RestockRequests is skipped: it reads
    # the Rayfin SQL database, whose mirrored tables always sit under a dbo schema, so it
    # carries its own schemaName already.
    if ($mode -eq 'sql') {
        foreach ($tableFile in Get-ChildItem -Path (Join-Path $stagedItem 'definition/tables') -Filter '*.tmdl' | Where-Object { $_.Name -ne 'RestockRequests.tmdl' }) {
            $lines = Get-Content -LiteralPath $tableFile.FullName
            $rewritten = foreach ($line in $lines) {
                $line
                if ($line -match 'entityName: ') { "`t`t`tschemaName: dbo" }
            }
            Set-Content -LiteralPath $tableFile.FullName -Value $rewritten
        }
    }

    return $stagedRoot
}

function Publish-SemanticModel {
    $modelName = Get-Config 'FABRIC_SEMANTIC_MODEL_NAME'
    $stagedRoot = Set-StagedSemanticModel
    $itemRef = "$modelName.SemanticModel"

    Write-Log 'Validating the staged model definition'
    if (-not (Invoke-Fabio deploy validate --source $stagedRoot).Success) {
        Stop-WithError 'The staged semantic model definition is not valid.'
    }

    Write-Log "Planning the deployment of '$modelName'"
    $planErrors = Get-FabioValue 'length(errors)' deploy plan --source $stagedRoot --workspace $script:WorkspaceId --include-items $itemRef
    if ($planErrors -and $planErrors -ne '0') {
        Stop-WithError "The deployment plan reported $planErrors error(s). Run 'fabio deploy plan' by hand to see them."
    }

    $deleteCount = Get-FabioValue "length(changes[?action=='Delete'])" deploy plan --source $stagedRoot --workspace $script:WorkspaceId --include-items $itemRef
    if ($deleteCount -and $deleteCount -ne '0') {
        Stop-WithError "The deployment plan wants to delete $deleteCount item(s). Refusing to apply it."
    }

    $foreignCount = Get-FabioValue "length(changes[?item_type!='SemanticModel'])" deploy plan --source $stagedRoot --workspace $script:WorkspaceId --include-items $itemRef
    if ($foreignCount -and $foreignCount -ne '0') {
        Stop-WithError "The deployment plan touches $foreignCount non-semantic-model item(s). Refusing to apply it."
    }

    Write-Log 'Applying the deployment'
    if (-not (Invoke-Fabio deploy apply --source $stagedRoot --workspace $script:WorkspaceId --include-items $itemRef --no-post-hooks).Success) {
        Stop-WithError 'Deploying the semantic model failed.'
    }

    $script:SemanticModelId = Get-FabioValue "[?displayName=='$modelName'].id | [0]" semantic-model list --workspace $script:WorkspaceId --all
    if (-not $script:SemanticModelId) {
        Stop-WithError 'The semantic model was deployed but could not be found by name.'
    }
    Write-Log "Semantic model $($script:SemanticModelId) deployed"
}

function Update-SemanticModel {
    Write-Log 'Refreshing the model to frame Direct Lake'
    if ((Invoke-Fabio semantic-model refresh --workspace $script:WorkspaceId --id $script:SemanticModelId).Success) {
        return
    }
    # Creating the model already kicks off a framing refresh, and Fabric rejects a
    # second one while it runs. The smoke query below is what actually proves the
    # model is ready, so waiting for the in-flight refresh is enough.
    Write-Log 'A refresh is already running; waiting for that one instead.'
}

function Invoke-SmokeTest {
    $daxFile = Join-Path $DaxDir 'smoke-test.dax'
    Write-Log 'Running the smoke query'

    for ($attempt = 1; $attempt -le 10; $attempt++) {
        $result = Invoke-Fabio semantic-model query --workspace $script:WorkspaceId --id $script:SemanticModelId --file $daxFile
        if ($result.Success) {
            Write-Log 'Smoke query succeeded:'
            Write-Host $result.Output
            return
        }
        Write-Log "The model is not answering queries yet (attempt $attempt/10); waiting 15s"
        Start-Sleep -Seconds 15
    }

    Stop-WithError "The model did not answer the smoke query. Try 'fabio semantic-model query --file $daxFile' by hand."
}

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

function Set-EnvValue {
    param([string]$Key, [string]$Value)

    $lines = @(Get-Content -LiteralPath $EnvFile)
    $seen = $false
    $rewritten = foreach ($line in $lines) {
        if ($line -match "^$([regex]::Escape($Key))=") {
            if (-not $seen) { "$Key=$Value"; $seen = $true }
        }
        else { $line }
    }
    if (-not $seen) { $rewritten += "$Key=$Value" }
    Set-Content -LiteralPath $EnvFile -Value $rewritten
}

function Save-State {
    Write-Log 'Writing the resolved ids back to .env'
    Set-EnvValue 'FABRIC_WORKSPACE_ID' $script:WorkspaceId
    if ($script:LakehouseId) { Set-EnvValue 'FABRIC_LAKEHOUSE_ID' $script:LakehouseId }
    if ($script:SqlEndpointId) { Set-EnvValue 'FABRIC_SQL_ENDPOINT_ID' $script:SqlEndpointId }
    if ($script:SemanticModelId) { Set-EnvValue 'FABRIC_SEMANTIC_MODEL_ID' $script:SemanticModelId }
}

function Show-Summary {
    $workspaceUrl = Get-FabioValue 'url' workspace url --id $script:WorkspaceId
    $lakehouseUrl = Get-FabioValue 'url' item url --workspace $script:WorkspaceId --id $script:LakehouseId --type Lakehouse
    $modelUrl = Get-FabioValue 'url' item url --workspace $script:WorkspaceId --id $script:SemanticModelId --type SemanticModel

    Write-Host ''
    Write-Log 'Done.'
    Write-Log "Workspace:      $($script:WorkspaceId)$(if ($workspaceUrl) { "  $workspaceUrl" })"
    Write-Log "Lakehouse:      $($script:LakehouseId)$(if ($lakehouseUrl) { "  $lakehouseUrl" })"
    Write-Log "SQL endpoint:   $($script:SqlEndpointId)"
    Write-Log "Semantic model: $($script:SemanticModelId)$(if ($modelUrl) { "  $modelUrl" })"
    Write-Log "Storage mode:   $(Get-Config 'FABRIC_MODEL_STORAGE_MODE')"
}

# ---------------------------------------------------------------------------
# Reset
# ---------------------------------------------------------------------------

function Invoke-Reset {
    $modelName = Get-Config 'FABRIC_SEMANTIC_MODEL_NAME'
    $lakehouseName = Get-Config 'FABRIC_LAKEHOUSE_NAME'

    Resolve-Workspace

    $modelId = Get-FabioValue "[?displayName=='$modelName'].id | [0]" semantic-model list --workspace $script:WorkspaceId --all
    if ($modelId) {
        Write-Log "Deleting semantic model '$modelName' ($modelId)"
        Invoke-Fabio semantic-model delete --workspace $script:WorkspaceId --id $modelId --force | Out-Null
    }
    else {
        Write-Log "No semantic model named '$modelName' to delete"
    }

    $lakehouseId = Get-FabioValue "[?displayName=='$lakehouseName'].id | [0]" lakehouse list --workspace $script:WorkspaceId --all
    if ($lakehouseId) {
        Write-Log "Deleting lakehouse '$lakehouseName' ($lakehouseId)"
        Invoke-Fabio lakehouse delete --workspace $script:WorkspaceId --id $lakehouseId --force | Out-Null
    }
    else {
        Write-Log "No lakehouse named '$lakehouseName' to delete"
    }

    Set-EnvValue 'FABRIC_LAKEHOUSE_ID' ''
    Set-EnvValue 'FABRIC_SQL_ENDPOINT_ID' ''
    Set-EnvValue 'FABRIC_SEMANTIC_MODEL_ID' ''

    Write-Log 'Reset complete. The workspace itself was left alone.'
}

# ---------------------------------------------------------------------------
# Dry run
# ---------------------------------------------------------------------------

function Show-DryRun {
    $workspaceId = Get-Config 'FABRIC_WORKSPACE_ID'
    $workspaceName = Get-Config 'FABRIC_WORKSPACE_NAME'
    $lakehouseName = Get-Config 'FABRIC_LAKEHOUSE_NAME'
    $modelName = Get-Config 'FABRIC_SEMANTIC_MODEL_NAME'
    $capacityId = Get-Config 'FABRIC_CAPACITY_ID'

    Write-Log 'Dry run. Nothing is sent to Fabric and no files are changed.'
    Write-Log "Workspace:      $(if ($workspaceId) { $workspaceId } else { "by name '$workspaceName'" })"
    Write-Log "Lakehouse:      $lakehouseName"
    Write-Log "Semantic model: $modelName"
    Write-Log "Storage mode:   $(Get-Config 'FABRIC_MODEL_STORAGE_MODE')"

    Test-DatasetFiles
    Write-Log 'All four dataset CSVs are present in data/generated'

    $script:WorkspaceId = '00000000-0000-0000-0000-000000000000'
    $script:LakehouseId = '11111111-1111-1111-1111-111111111111'
    $script:SqlEndpointId = '22222222-2222-2222-2222-222222222222'
    $script:SqlEndpointConnectionString = 'example.datawarehouse.fabric.microsoft.com'
    $stagedRoot = Set-StagedSemanticModel

    if ((Invoke-Fabio deploy validate --source $stagedRoot).Success) {
        Write-Log 'The staged semantic model definition is valid'
    }
    else {
        Stop-WithError "The staged semantic model definition is not valid. Run: fabio deploy validate --source $stagedRoot"
    }
    Write-Host ''

    if ($Reset) {
        Write-Log 'Reset would delete only these, and would leave the workspace in place:'
        Write-Preview "semantic-model delete --workspace <workspace> --name $modelName"
        Write-Preview "lakehouse delete --workspace <workspace> --name $lakehouseName"
        return
    }

    Write-Preview 'auth status'
    if ($workspaceId) {
        Write-Preview "workspace show --id $workspaceId"
    }
    else {
        Write-Preview 'workspace list --all'
    }
    if ($capacityId) {
        Write-Preview "workspace assign-capacity --id <workspace> --capacity $capacityId"
    }
    Write-Preview 'lakehouse list --workspace <workspace> --all'
    Write-Preview "lakehouse create --workspace <workspace> --name $lakehouseName"
    Write-Preview 'lakehouse show --workspace <workspace> --id <lakehouse>'

    if ($SkipData) {
        Write-Log 'would skip the data load because -SkipData was given'
    }
    else {
        foreach ($table in $TableSpecs.Keys) {
            $file = $TableSpecs[$table]
            Write-Preview "lakehouse upload-table --workspace <workspace> --id <lakehouse> --source-path data/generated/$file --table $table --mode Overwrite --format Csv"
        }
        Write-Preview 'sql-endpoint refresh-metadata --workspace <workspace> --id <sql-endpoint>'
        Write-Preview 'lakehouse list-tables --workspace <workspace> --id <lakehouse> --all'
        Write-Preview 'sql-endpoint query --workspace <workspace> --id <rayfin-sql-endpoint> --sql <RestockRequests schema>'
    }

    Write-Preview 'deploy validate --source <staged model>'
    Write-Preview "deploy plan --source <staged model> --workspace <workspace> --include-items $modelName.SemanticModel"
    Write-Preview "deploy apply --source <staged model> --workspace <workspace> --include-items $modelName.SemanticModel --no-post-hooks"
    Write-Preview 'semantic-model list --workspace <workspace> --all'
    Write-Preview 'semantic-model refresh --workspace <workspace> --id <model>'
    Write-Preview 'semantic-model query --workspace <workspace> --id <model> --file fabric/dax/smoke-test.dax'
}

# ---------------------------------------------------------------------------

function Invoke-Main {
    if ($Help) { Show-Usage; return }

    Import-EnvFile
    Set-ConfigDefaults
    Test-Prerequisites
    New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null

    try {
        if ($DryRun) {
            Show-DryRun
            return
        }

        Test-Authentication

        if ($Reset) {
            Invoke-Reset
            return
        }

        Resolve-Workspace
        Set-WorkspaceCapacity
        Resolve-Lakehouse

        if ($SkipData) {
            Write-Log 'Skipping the data load because -SkipData was given'
        }
        else {
            Build-Dataset
            Send-Tables
            Test-Tables
            Show-RestockSchema
            Add-RestockSeed
        }

        Publish-SemanticModel
        Update-SemanticModel
        Invoke-SmokeTest
        Save-State
        Show-Summary
    }
    finally {
        if (Test-Path -LiteralPath $WorkDir) {
            Remove-Item -LiteralPath $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

Invoke-Main
