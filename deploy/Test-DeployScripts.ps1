# Pruebas estáticas del despliegue (no ejecuta SQL ni npm install).
$ErrorActionPreference = 'Stop'
$deploy = $PSScriptRoot
$errors = @()

function Test-ParseFile([string]$Path) {
    $tokens = $null; $parseErrors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$parseErrors)
    foreach ($e in $parseErrors) { $script:errors += "$Path : $($e.Message)" }
}

Get-ChildItem $deploy -Filter '*.ps1' | ForEach-Object { Test-ParseFile $_.FullName }
Test-ParseFile (Join-Path $deploy 'Asada.Deploy.psm1')

Import-Module (Join-Path $deploy 'Asada.Deploy.psm1') -Force
$paths = Resolve-AsadaProjectRoot -DeployRoot $deploy
if (-not (Test-AsadaProjectLayout $paths)) { $errors += 'Layout backend/frontend/sql/sql incompleto en esta máquina.' }

$config = Get-AsadaDeployConfig
foreach ($s in @($config.ScriptEjecutarTodo, $config.ScriptDemo, $config.ScriptJobs, $config.ScriptVerificar)) {
    $p = Join-Path $paths.SqlDir $s
    if (-not (Test-Path $p)) { $errors += "Falta script SQL: $s" }
}

$todo = Get-Content (Join-Path $paths.SqlDir 'ejecutar_todo.sql') -Raw
foreach ($v in @('RutaDatos', 'RutaLog', 'RutaRespaldosASADA', 'RutaRespaldosASADA_DW')) {
    if ($todo -notmatch ":setvar $v") { $errors += "ejecutar_todo.sql sin :setvar $v" }
}

$inst = Get-Content (Join-Path $deploy 'instalar.ps1') -Raw
$act = Get-Content (Join-Path $deploy 'actualizar.ps1') -Raw
if ($act -match 'Invoke-AsadaSql[^\n]+ScriptEjecutarTodo|InputFile\s+\$config\.ScriptEjecutarTodo') {
    $errors += 'actualizar.ps1 no debe invocar ejecutar_todo.sql'
}
if ($inst -notmatch 'ASADA ya existe') { $errors += 'instalar.ps1 debe rechazar ASADA existente' }

$mod = Get-Content (Join-Path $deploy 'Asada.Deploy.psm1') -Raw
if ($mod -notmatch 'ASADA\.dbo\.Tramo_Mora') { $errors += 'Migraciones deben consultar ASADA.dbo (no master)' }
if ($mod -notmatch 'Test-AsadaMigrationApplied') { $errors += 'Falta verificación post-migración' }
if ($act -notmatch 'Test-AsadaCoreSchema') { $errors += 'actualizar.ps1 debe validar esquema núcleo' }
if ($act -notmatch 'WhatIf.*No se ejecuta SQL') { $errors += 'actualizar.ps1 WhatIf debe evitar migraciones/jobs' }

if ($errors.Count -eq 0) {
    Write-Host 'Test-DeployScripts: OK' -ForegroundColor Green
    exit 0
}
Write-Host 'Test-DeployScripts: FALLOS' -ForegroundColor Red
$errors | ForEach-Object { Write-Host "  - $_" }
exit 1
