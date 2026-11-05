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
Invoke-AsadaSql -Servidor $Servidor -InputFile $config.ScriptVerificar -WorkingDirectory $paths.SqlDir

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
