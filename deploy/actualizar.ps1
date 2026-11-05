# Actualización de instalación EXISTENTE (no ejecuta ejecutar_todo.sql).
# Requiere confirmación explícita para migraciones y constancia de respaldo comprobable.
# Uso: .\actualizar.ps1 -Servidor localhost -ConfirmarMigracion -ConfirmarRespaldoComprobable [-InstalarJobsFaltantes] [-WhatIf]
param(
    [string]$Servidor,
    [switch]$ConfirmarMigracion,
    [switch]$ConfirmarRespaldoComprobable,
    [switch]$InstalarJobsFaltantes,
    [string]$RutaRespaldosASADA_DW,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$deployRoot = $PSScriptRoot
Import-Module (Join-Path $deployRoot 'Asada.Deploy.psm1') -Force
$config = Get-AsadaDeployConfig
$paths = Resolve-AsadaProjectRoot -DeployRoot $deployRoot

if (-not (Test-AsadaProjectLayout $paths)) { exit 1 }

$logPath = $null
if (-not $WhatIf) {
    $logDir = Join-Path $deployRoot 'log'
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
    $logPath = Join-Path $logDir ("actualizar_{0:yyyyMMdd_HHmmss}.log" -f (Get-Date))
}

Write-AsadaDeployLog "Inicio actualización$(if ($WhatIf) { ' [WhatIf]' } else { '' })" $logPath
Test-AsadaNodeAndSqlCmd | Out-Null
$sql = Resolve-AsadaSqlServer -Servidor $Servidor
$Servidor = $sql.Servidor
$db = Get-AsadaDatabaseState -Servidor $Servidor

if (-not $db.Asada) {
    Write-AsadaDeployLog "ERROR: ASADA no existe. Use instalar.ps1 para instalación nueva." $logPath
    exit 1
}
if (-not $db.AsadaDw) {
    Write-AsadaDeployLog "ERROR: ASADA_DW no existe. Estado ambiguo; no se continúa." $logPath
    exit 1
}

$core = Test-AsadaCoreSchema -Servidor $Servidor
$coreOk = $core.AbonadoFisico -and $core.AbonadoJuridico -and $core.PoliticaRespaldo -and $core.Conexion -and $core.Medidor
if (-not $coreOk) {
    Write-AsadaDeployLog 'ERROR: ASADA existe pero no tiene esquema núcleo esperado (Abonado_Fisico, Abonado_Juridico, Conexion, Medidor, Politica_Respaldo). Estado desconocido; no se aplican migraciones.' $logPath
    Write-Host 'Posible instalación parcial o corrupta. Restaure desde respaldo o reinstale en un equipo limpio.' -ForegroundColor Red
    exit 1
}

if (-not $WhatIf) {
    Write-AsadaDeployLog 'Diagnóstico previo (verificar_instalacion.sql)...' $logPath
    Invoke-AsadaSql -Servidor $Servidor -InputFile $config.ScriptVerificar -WorkingDirectory $paths.SqlDir |
        Tee-Object -FilePath $logPath -Append | Out-Null
}

$rbState = Get-AsadaRespaldosMultibaseMigrationState -Servidor $Servidor
Write-AsadaDeployLog ("Estado respaldos_multibase: $($rbState.Status) ($($rbState.TrueCount)/5)") $logPath
if ($rbState.Status -eq 'Partial') {
    Write-AsadaDeployLog 'ERROR: Migración respaldos_multibase parcialmente aplicada. Revise el diagnóstico antes de continuar.' $logPath
    Write-Host 'Estado parcial en migración 22 (marcadores incompletos). No se aplican migraciones automáticamente.' -ForegroundColor Red
    exit 1
}
if ($rbState.Status -eq 'Unknown') {
    Write-AsadaDeployLog "ERROR: No se pudo determinar el estado de respaldos_multibase. $($rbState.Detail)" $logPath
    Write-Host 'Estado desconocido de migración 22. No se aplican migraciones automáticamente.' -ForegroundColor Red
    exit 1
}

$pending = Get-AsadaPendingMigrations -Servidor $Servidor -Config $config
if ($pending.Count -eq 0) {
    Write-AsadaDeployLog 'No hay migraciones conocidas pendientes.' $logPath
} else {
    Write-AsadaDeployLog ("Migraciones pendientes: " + ($pending.Id -join ', ')) $logPath
    foreach ($m in $pending) { Write-AsadaDeployLog "  - $($m.Id): $($m.Descripcion) -> $($m.Script)" $logPath }
}

if (-not $ConfirmarMigracion -or -not $ConfirmarRespaldoComprobable) {
    Write-Host ""
    Write-Host "DETENIDO: Para aplicar migraciones debe indicar:" -ForegroundColor Yellow
    Write-Host "  -ConfirmarMigracion -ConfirmarRespaldoComprobable"
    Write-Host "y haber realizado un respaldo comprobable de ASADA (y ASADA_DW si aplica) antes de continuar."
    if ($logPath) { Write-Host "Log: $logPath" }
    exit 0
}

if ($pending.Count -eq 0) {
    Write-AsadaDeployLog 'Sin migraciones que aplicar (confirmación recibida).' $logPath
} elseif ($WhatIf) {
    Write-Host "[WhatIf] Se aplicarían, en orden: $($pending.Script -join ', ')"
    Write-Host "[WhatIf] No se ejecuta SQL ni se instalan jobs."
} else {
    $sqlVars = @{}
    if ($RutaRespaldosASADA_DW) {
        $config.RutaRespaldosASADA_DW = (Normalize-AsadaDirectoryPath $RutaRespaldosASADA_DW)
    }
    $sqlVars['RutaRespaldosASADA_DW'] = (Normalize-AsadaDirectoryPath $config.RutaRespaldosASADA_DW)

    foreach ($m in $pending) {
        $scriptPath = Join-Path $paths.SqlDir $m.Script
        if (-not (Test-Path $scriptPath)) {
            Write-AsadaDeployLog "ERROR: Falta script $($m.Script)" $logPath
            exit 1
        }
        Write-AsadaDeployLog "Aplicando $($m.Script) (id=$($m.Id))..." $logPath
        try {
            Invoke-AsadaSql -Servidor $Servidor -InputFile $m.Script -Variables $sqlVars -WorkingDirectory $paths.SqlDir
        } catch {
            Write-AsadaDeployLog "FALLÓ $($m.Script): $($_.Exception.Message)" $logPath
            throw
        }
        if (-not (Test-AsadaMigrationApplied -Servidor $Servidor -Migration $m)) {
            $msg = "La migración $($m.Id) terminó pero no pasó la verificación posterior. Deteniendo cadena."
            Write-AsadaDeployLog "ERROR: $msg" $logPath
            throw $msg
        }
        Write-AsadaDeployLog "OK $($m.Script) (verificado)" $logPath
    }
    Write-AsadaDeployLog 'Diagnóstico posterior...' $logPath
    Invoke-AsadaSql -Servidor $Servidor -InputFile $config.ScriptVerificar -WorkingDirectory $paths.SqlDir |
        Tee-Object -FilePath $logPath -Append | Out-Null
}

if ($InstalarJobsFaltantes -and -not $WhatIf) {
    & (Join-Path $deployRoot 'Install-AsadaAgentJobs.ps1') -Servidor $Servidor -SqlDir $paths.SqlDir -Modo 'Actualizar'
} elseif ($InstalarJobsFaltantes -and $WhatIf) {
    Write-Host '[WhatIf] Se evaluaría InstalarJobsFaltantes (sin cambios en msdb).'
}

Write-AsadaDeployLog 'Actualización finalizada.' $logPath
if ($logPath) { Write-Host "Ver log: $logPath" -ForegroundColor Green }
