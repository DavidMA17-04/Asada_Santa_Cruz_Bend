# Instala jobs del proyecto en msdb (deshabilitados). No inicia ni habilita SQL Server Agent.
param(
    [Parameter(Mandatory)][string]$Servidor,
    [Parameter(Mandatory)][string]$SqlDir,
    [ValidateSet('Nuevo', 'Actualizar')][string]$Modo = 'Nuevo',
    [switch]$Recrear
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Asada.Deploy.psm1') -Force
$config = Get-AsadaDeployConfig
$edition = Get-AsadaSqlEditionInfo -Servidor $Servidor

if (-not $edition.SupportsAgent) {
    Write-Host "SQL Server Express: no se instalan jobs (Agent no disponible para programación)." -ForegroundColor Yellow
    Write-Host "Los respaldos y el ETL pueden ejecutarse manualmente desde la aplicación o con sp_EjecutarRespaldo / sp_EjecutarCargaDW."
    return
}

$expected = $config.JobsProyecto
$q = "SET NOCOUNT ON; SELECT name FROM msdb.dbo.sysjobs WHERE name LIKE N'Job[_]%';"
$existing = @((sqlcmd -S $Servidor -E -C -h -1 -W -Q $q) | Where-Object { $_ -and $_ -notmatch '^\(' })
$projectExisting = @($existing | Where-Object { $expected -contains $_ })

if ($Modo -eq 'Actualizar') {
    Write-Host "Jobs del proyecto ya presentes: $($projectExisting -join ', ')"
    $cmp = Compare-AsadaJobsWithScripts -SqlDir $SqlDir
    foreach ($jobName in @('Job_RespaldoCompleto', 'Job_RespaldoDiferencial', 'Job_RespaldoLogTransacciones')) {
        if ($projectExisting -contains $jobName) {
            $preview = Get-AsadaInstalledJobStepPreview -Servidor $Servidor -JobName $jobName
            if ($preview -and $preview -notmatch 'nombre_base') {
                Write-Host "ADVERTENCIA: $jobName puede tener comandos sin filtro p.nombre_base (desactualizado)." -ForegroundColor Yellow
                Write-Host "  Vea deploy/ESTRATEGIA_JOBS.md — no se recrea automáticamente (preserva historial msdb)."
            }
        }
    }
    $missing = @($expected | Where-Object { $projectExisting -notcontains $_ })
    if ($missing.Count -eq 0) {
        Write-Host "No hay jobs faltantes. No se elimina ni recrea ningún job (use -Recrear solo en instalación nueva con autorización)."
        if (-not $cmp.ScriptFiltersAsadaBase) {
            Write-Host "ADVERTENCIA: El script 17 en el repo no filtra nombre_base=ASADA; revise la versión publicada." -ForegroundColor Yellow
        }
        return
    }
    if ($missing -contains 'Job_RespaldoCompletoDW' -and (Test-Path (Join-Path $SqlDir $config.ScriptJobSoloDw))) {
        Write-Host "Instalando solo job faltante: Job_RespaldoCompletoDW"
        Invoke-AsadaSql -Servidor $Servidor -InputFile $config.ScriptJobSoloDw -WorkingDirectory $SqlDir
    }
    $still = @($missing | Where-Object { $_ -ne 'Job_RespaldoCompletoDW' })
    if ($still.Count -gt 0) {
        Write-Host "ADVERTENCIA: Faltan jobs: $($still -join ', '). No se ejecuta 17_jobs_sql_agent.sql completo en modo Actualizar (recrearía jobs)." -ForegroundColor Yellow
        Write-Host "Instálelos manualmente con autorización o use instalación nueva en un equipo limpio."
    }
    return
}

# Modo Nuevo
if ($projectExisting.Count -gt 0 -and -not $Recrear) {
    Write-Host "ERROR: Ya existen jobs del proyecto ($($projectExisting -join ', ')). Use -RecrearJobs solo si autoriza recrearlos (elimina esos jobs)." -ForegroundColor Red
    exit 1
}

Write-Host "Instalando jobs desde 17_jobs_sql_agent.sql (todos deshabilitados al nacer)..."
Invoke-AsadaSql -Servidor $Servidor -InputFile $config.ScriptJobs -WorkingDirectory $SqlDir

$cmp = Compare-AsadaJobsWithScripts -SqlDir $SqlDir
if (-not $cmp.ScriptIncludesDwJob) {
    Write-Host "Instalando Job_RespaldoCompletoDW adicional..."
    Invoke-AsadaSql -Servidor $Servidor -InputFile $config.ScriptJobSoloDw -WorkingDirectory $SqlDir
}

$missingAfter = @()
foreach ($jobName in $expected) {
    $q = "SET NOCOUNT ON; SELECT CASE WHEN EXISTS (SELECT 1 FROM msdb.dbo.sysjobs WHERE name = N'$($jobName.Replace("'", "''"))') THEN 1 ELSE 0 END;"
    $exists = Invoke-AsadaSqlQuery -Servidor $Servidor -Query $q
    if ($exists -ne '1') { $missingAfter += $jobName }
}
if ($missingAfter.Count -gt 0) {
    throw "Tras la instalación faltan jobs: $($missingAfter -join ', ')"
}

Write-Host "Seis jobs presentes. Permanece deshabilitados Agent y horarios hasta activación manual."
Write-Host "Compruebe en SSMS: job.enabled=0 y schedule.enabled=0 para cada Job_*."
