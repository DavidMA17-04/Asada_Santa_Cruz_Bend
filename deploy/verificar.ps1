# Diagnóstico de solo lectura (SQL + comprobaciones locales).
param([string]$Servidor)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Asada.Deploy.psm1') -Force
$config = Get-AsadaDeployConfig
$paths = Resolve-AsadaProjectRoot -DeployRoot $PSScriptRoot

Write-Host "==> Verificación ASADA Santa Cruz" -ForegroundColor Cyan
if (-not (Test-AsadaProjectLayout $paths)) { exit 1 }

Test-AsadaNodeAndSqlCmd | Out-Null
$sql = Resolve-AsadaSqlServer -Servidor $Servidor
$Servidor = $sql.Servidor

Write-Host "Servidor: $Servidor"
Get-AsadaSqlEditionInfo -Servidor $Servidor | Format-List Edition, SupportsAgent, AgentInstalled, AgentRunning

Write-Host "`n--- SQL (verificar_instalacion.sql) ---"
Push-Location $paths.SqlDir
try {
    $sqlLines = @(& sqlcmd -S $Servidor -E -C -b -f 65001 -i $config.ScriptVerificar 2>&1 | ForEach-Object { "$_" })
    $sqlLines | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Verificación SQL falló (sqlcmd devolvió error).' -ForegroundColor Red
        exit 1
    }

    $summary = $sqlLines | Where-Object { $_ -match 'Resumen diagnóstico:' } | Select-Object -Last 1
    $errCount = 0
    $advCount = 0
    if ($summary -match '(\d+)\s+error') { $errCount = [int]$Matches[1] }
    if ($summary -match '(\d+)\s+advertencia') { $advCount = [int]$Matches[1] }

    if ($errCount -gt 0) {
        Write-Host "Diagnóstico SQL: $errCount error(es) crítico(s)." -ForegroundColor Red
        exit 1
    }
    if ($advCount -gt 0) {
        Write-Host "Diagnóstico SQL completado con $advCount advertencia(s) (revise filas Advertencia arriba)." -ForegroundColor Yellow
    } else {
        Write-Host 'Diagnóstico SQL completado sin errores ni advertencias.' -ForegroundColor Green
    }
} finally {
    Pop-Location
}

Write-Host "`n--- Archivos locales ---"
@(
    @{ N = 'backend/.env'; P = Join-Path $paths.Backend '.env' }
    @{ N = 'frontend/dist/index.html'; P = Join-Path $paths.Frontend 'dist\index.html' }
    @{ N = 'backend/node_modules'; P = Join-Path $paths.Backend 'node_modules' }
) | ForEach-Object {
    $ok = Test-Path $_.P
    $tag = if ($ok) { 'OK' } else { 'FALTA' }
    Write-Host "  [$tag] $($_.N)"
}

Write-Host "`nPara iniciar: deploy\INICIAR.bat (requiere .env y frontend/dist)."
