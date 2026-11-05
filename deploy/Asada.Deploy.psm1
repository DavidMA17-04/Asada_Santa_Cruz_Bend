# Módulo compartido de despliegue ASADA Santa Cruz (backend/deploy).
Set-StrictMode -Version Latest

function Get-AsadaDeployConfig {
    Import-PowerShellDataFile -Path (Join-Path $PSScriptRoot 'config.psd1')
}

function Resolve-AsadaProjectRoot {
    param([string]$DeployRoot = $PSScriptRoot)
    $backendRoot = Split-Path $DeployRoot -Parent
    $projectRoot = Split-Path $backendRoot -Parent
    @{
        Deploy   = $DeployRoot
        Backend  = $backendRoot
        Frontend = Join-Path $projectRoot 'frontend'
        SqlRoot  = Join-Path $projectRoot 'sql'
        SqlDir   = Join-Path $projectRoot 'sql\sql'
        Root     = $projectRoot
    }
}

function Test-AsadaProjectLayout {
    param($Paths)
    $ok = $true
    foreach ($pair in @(
        @{ N = 'backend'; P = $Paths.Backend; F = 'package.json' }
        @{ N = 'frontend'; P = $Paths.Frontend; F = 'package.json' }
        @{ N = 'sql/sql'; P = $Paths.SqlDir; F = 'ejecutar_todo.sql' }
    )) {
        $f = Join-Path $pair.P $pair.F
        if (-not (Test-Path $f)) {
            Write-Host "ERROR: Falta $($pair.N) ($f)" -ForegroundColor Red
            $ok = $false
        }
    }
    return $ok
}

function Write-AsadaDeployLog {
    param([string]$Message, [string]$LogPath)
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    if ($LogPath) { Add-Content -Path $LogPath -Value $line -Encoding UTF8 }
    Write-Host $line
}

function Test-AsadaNodeAndSqlCmd {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'No se encontró Node.js 20+.' }
    $major = [int]((node -v).TrimStart('v').Split('.')[0])
    if ($major -lt 20) { throw "Node.js $major es insuficiente (se requiere 20+)." }
    if (-not (Get-Command sqlcmd -ErrorAction SilentlyContinue)) { throw 'No se encontró sqlcmd (SSMS o winget install sqlcmd).' }
}

function Get-AsadaOdbcDriver {
    try {
        $inst = (Get-ItemProperty 'HKLM:\SOFTWARE\ODBC\ODBCINST.INI\ODBC Drivers').PSObject.Properties.Name
        foreach ($d in 'ODBC Driver 18 for SQL Server', 'ODBC Driver 17 for SQL Server') {
            if ($inst -contains $d) { return $d }
        }
    } catch { }
    throw 'No se encontró ODBC Driver 17/18 for SQL Server.'
}

function Find-AsadaSqlService {
    $s = Get-Service -Name 'MSSQLSERVER' -ErrorAction SilentlyContinue
    if ($s) { return $s }
    Get-Service -Name 'MSSQL$*' -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Resolve-AsadaSqlServer {
    param([string]$Servidor)
    if ($Servidor) { return @{ Servidor = $Servidor; Servicio = Find-AsadaSqlService } }
    $servicio = Find-AsadaSqlService
    if (-not $servicio) { throw 'No se encontró SQL Server en este equipo.' }
    if ($servicio.Status -ne 'Running') { throw "El servicio $($servicio.Name) está detenido." }
    $srv = if ($servicio.Name -eq 'MSSQLSERVER') { 'localhost' } else { 'localhost\' + $servicio.Name.Substring(6) }
    @{ Servidor = $srv; Servicio = $servicio }
}

function Format-AsadaSqlCmdVariable {
    param([string]$Name, [string]$Value)
    # sqlcmd -v sustituye :setvar; rutas Ruta* van entre comillas; barra final duplicada (escape sqlcmd).
    $v = [string]$Value
    $quote = ($Name -like 'Ruta*') -or ($v -match '\s')
    if (-not $quote) { return "${Name}=$v" }
    if ($v.EndsWith('\')) { $v = $v.TrimEnd('\') + '\\' }
    $escaped = $v -replace '"', '""'
    return "${Name}=""$escaped"""
}

function Invoke-AsadaSql {
    param(
        [string]$Servidor,
        [string]$InputFile,
        [hashtable]$Variables = @{},
        [string]$WorkingDirectory
    )
    $args = @('-S', $Servidor, '-E', '-C', '-b', '-f', '65001')
    foreach ($k in $Variables.Keys) {
        $args += @('-v', (Format-AsadaSqlCmdVariable -Name $k -Value ([string]$Variables[$k])))
    }
    if ($InputFile) { $args += @('-i', $InputFile) }
    Push-Location $WorkingDirectory
    try {
        & sqlcmd @args
        if ($LASTEXITCODE -ne 0) { throw "sqlcmd falló (código $LASTEXITCODE) en $InputFile" }
    } finally { Pop-Location }
}

function Invoke-AsadaSqlQuery {
    param([string]$Servidor, [string]$Query)
    $out = sqlcmd -S $Servidor -E -C -h -1 -W -Q $Query 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Consulta SQL falló: $Query" }
    ($out | Out-String).Trim()
}

function Get-AsadaDatabaseState {
    param([string]$Servidor)
    $q = @"
SET NOCOUNT ON;
SELECT CASE WHEN DB_ID('ASADA') IS NULL THEN 0 ELSE 1 END;
SELECT CASE WHEN DB_ID('ASADA_DW') IS NULL THEN 0 ELSE 1 END;
"@
    $lines = sqlcmd -S $Servidor -E -C -h -1 -W -Q $q
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo conectar a SQL Server.' }
    $nums = @($lines | Where-Object { $_ -match '^\d+$' })
    @{
        Asada   = ($nums[0] -eq '1')
        AsadaDw = ($nums[1] -eq '1')
    }
}

function Get-AsadaSqlEditionInfo {
    param([string]$Servidor)
    $edition = Invoke-AsadaSqlQuery -Servidor $Servidor -Query "SET NOCOUNT ON; SELECT SERVERPROPERTY('Edition');"
    $agent = Get-Service -Name 'SQLSERVERAGENT' -ErrorAction SilentlyContinue
    $agentOk = $null -ne $agent
    $agentRunning = $agentOk -and ($agent.Status -eq 'Running')
    $supportsAgent = $edition -notmatch 'Express'
    @{
        Edition        = $edition
        AgentInstalled = $agentOk
        AgentRunning   = $agentRunning
        SupportsAgent  = $supportsAgent
    }
}

function Test-AsadaPathForSql {
    param([string[]]$Paths)
    foreach ($p in $Paths) {
        if ([string]::IsNullOrWhiteSpace($p)) { throw 'Ruta vacía.' }
        if ($p -match '[<>|"?*]') { throw "Ruta no válida: $p" }
    }
}

function Initialize-AsadaBackupDirectory {
    param([string]$Path, [System.ServiceProcess.ServiceController]$SqlService, [switch]$WhatIf)
    if (-not (Test-Path $Path)) {
        if ($WhatIf) { Write-Host "[WhatIf] Crear carpeta $Path"; return }
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
    if (-not $SqlService) { return }
    $account = "NT SERVICE\$($SqlService.Name)"
    if ($WhatIf) {
        Write-Host "[WhatIf] icacls $Path -> $account :(OI)(CI)M"
        return
    }
    icacls $Path /grant "${account}:(OI)(CI)M" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ADVERTENCIA: No se pudo conceder permisos a $account en $Path (ejecute como administrador si los respaldos fallan)." -ForegroundColor Yellow
    }
}

function Normalize-AsadaDirectoryPath {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $Path }
    $p = $Path.Trim()
    if ($p -notmatch '[\\/]$') { $p += '\' }
    $p
}

function Get-AsadaSqlCmdVariables {
    param($Config)
    @{
        RutaDatos             = $Config.RutaDatos
        RutaLog               = $Config.RutaLog
        RutaRespaldosASADA    = (Normalize-AsadaDirectoryPath $Config.RutaRespaldosASADA)
        RutaRespaldosASADA_DW = (Normalize-AsadaDirectoryPath $Config.RutaRespaldosASADA_DW)
    }
}

function Test-AsadaCoreSchema {
    param([string]$Servidor)
    $q = @"
SET NOCOUNT ON;
SELECT CASE WHEN OBJECT_ID(N'ASADA.dbo.Abonado', N'U') IS NULL THEN 0 ELSE 1 END;
SELECT CASE WHEN OBJECT_ID(N'ASADA.dbo.Politica_Respaldo', N'U') IS NULL THEN 0 ELSE 1 END;
"@
    $lines = sqlcmd -S $Servidor -E -C -h -1 -W -Q $q
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo evaluar el esquema núcleo de ASADA.' }
    $nums = @($lines | Where-Object { $_ -match '^\d+$' })
    @{
        Abonado           = ($nums[0] -eq '1')
        PoliticaRespaldo  = ($nums[1] -eq '1')
    }
}

function Test-AsadaMigrationApplied {
    param([string]$Servidor, $Migration)
    switch ($Migration.Id) {
        'development_main' {
            $c = Invoke-AsadaSqlQuery -Servidor $Servidor -Query "SET NOCOUNT ON; SELECT CASE WHEN OBJECT_ID(N'ASADA.dbo.Tramo_Mora', N'U') IS NULL THEN 0 ELSE 1 END;"
            return ($c -eq '1')
        }
        'respaldos_multibase' {
            $col = Invoke-AsadaSqlQuery -Servidor $Servidor -Query "SET NOCOUNT ON; SELECT CASE WHEN COL_LENGTH(N'ASADA.dbo.Politica_Respaldo', N'nombre_base') IS NULL THEN 0 ELSE 1 END;"
            if ($col -ne '1') { return $false }
            $sp = Invoke-AsadaSqlQuery -Servidor $Servidor -Query "SET NOCOUNT ON; SELECT CASE WHEN OBJECT_DEFINITION(OBJECT_ID(N'ASADA.dbo.sp_EjecutarRespaldo')) LIKE N'%p.nombre_base%' THEN 1 ELSE 0 END;"
            return ($sp -eq '1')
        }
        default { throw "Migración desconocida: $($Migration.Id)" }
    }
}

function Get-AsadaPendingMigrations {
    param([string]$Servidor, $Config)
    $pending = @()
    foreach ($m in $Config.Migraciones) {
        if (-not (Test-AsadaMigrationApplied -Servidor $Servidor -Migration $m)) {
            $pending += $m
        }
    }
    $pending
}

function Get-AsadaProjectJobs {
    param([string]$Servidor, [string[]]$JobNames)
    $list = ($JobNames | ForEach-Object { "N'$_'" }) -join ','
    $q = "SET NOCOUNT ON; SELECT j.name, j.enabled FROM msdb.dbo.sysjobs j WHERE j.name IN ($list);"
    try {
        sqlcmd -S $Servidor -E -C -W -s'|' -Q $q
    } catch {
        @()
    }
}

function Compare-AsadaJobsWithScripts {
    param([string]$SqlDir)
    $jobScript = Join-Path $SqlDir '17_jobs_sql_agent.sql'
    $expected = @(
        'Job_RespaldoCompleto', 'Job_RespaldoDiferencial', 'Job_RespaldoLogTransacciones',
        'Job_CargaNocturnaDW', 'Job_MantenimientoNocturno', 'Job_RespaldoCompletoDW'
    )
    $text = Get-Content $jobScript -Raw -ErrorAction SilentlyContinue
    $hasDw = $text -match 'Job_RespaldoCompletoDW'
    $hasBaseFilter = $text -match "p\.nombre_base = ''ASADA''"
    @{
        Expected              = $expected
        ScriptIncludesDwJob = [bool]$hasDw
        ScriptFiltersAsadaBase = [bool]$hasBaseFilter
    }
}

function Get-AsadaInstalledJobStepPreview {
    param([string]$Servidor, [string]$JobName)
    $safe = $JobName.Replace("'", "''")
    $q = @"
SET NOCOUNT ON;
SELECT TOP (1) LEFT(js.command, 200)
FROM msdb.dbo.sysjobs j
JOIN msdb.dbo.sysjobsteps js ON js.job_id = j.job_id
WHERE j.name = N'$safe';
"@
    try {
        Invoke-AsadaSqlQuery -Servidor $Servidor -Query $q
    } catch {
        $null
    }
}

Export-ModuleMember -Function *
