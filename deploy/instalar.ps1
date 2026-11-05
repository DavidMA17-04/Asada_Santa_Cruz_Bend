# Instalación NUEVA — ASADA Santa Cruz (no usar si ASADA ya existe con datos; use actualizar.ps1).
# Uso: .\instalar.ps1 [-Servidor "localhost\SQLEXPRESS"] [-CargarDemo] [-InstalarJobs] [-WhatIf]
param(
    [string]$Servidor,
    [string]$RutaDatos,
    [string]$RutaLog,
    [string]$RutaRespaldosASADA,
    [string]$RutaRespaldosASADA_DW,
    [switch]$CargarDemo,
    [switch]$InstalarJobs,
    [switch]$RecrearJobs,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$deployRoot = $PSScriptRoot
Import-Module (Join-Path $deployRoot 'Asada.Deploy.psm1') -Force
$config = Get-AsadaDeployConfig
$paths = Resolve-AsadaProjectRoot -DeployRoot $deployRoot

if (-not (Test-AsadaProjectLayout $paths)) { exit 1 }

if ($RutaDatos) { $config.RutaDatos = $RutaDatos.Trim() }
if ($RutaLog) { $config.RutaLog = $RutaLog.Trim() }
if ($RutaRespaldosASADA) { $config.RutaRespaldosASADA = (Normalize-AsadaDirectoryPath $RutaRespaldosASADA) }
if ($RutaRespaldosASADA_DW) { $config.RutaRespaldosASADA_DW = (Normalize-AsadaDirectoryPath $RutaRespaldosASADA_DW) }
Test-AsadaPathForSql @($config.RutaDatos, $config.RutaLog, $config.RutaRespaldosASADA, $config.RutaRespaldosASADA_DW)

Write-Host "==> ASADA — instalación nueva (deploy)" -ForegroundColor Cyan
Write-Host "    Raíz del proyecto: $($paths.Root)"

Test-AsadaNodeAndSqlCmd | Out-Null
$driver = Get-AsadaOdbcDriver
$sql = Resolve-AsadaSqlServer -Servidor $Servidor
$Servidor = $sql.Servidor
Write-Host "    Servidor SQL: $Servidor"
Write-Host "    ODBC: $driver"

$edition = Get-AsadaSqlEditionInfo -Servidor $Servidor
Write-Host "    Edición: $($edition.Edition)"
if (-not $edition.SupportsAgent) {
    Write-Host "    ADVERTENCIA: SQL Express no incluye SQL Server Agent; -InstalarJobs no aplicará jobs programados." -ForegroundColor Yellow
}

$db = Get-AsadaDatabaseState -Servidor $Servidor
if ($db.Asada) {
    Write-Host ""
    Write-Host "ERROR: La base ASADA ya existe. Este script es solo para instalación desde cero." -ForegroundColor Red
    Write-Host "       Use deploy\actualizar.ps1 para actualizar una instalación existente."
    exit 1
}

$sqlVars = Get-AsadaSqlCmdVariables -Config $config

if ($WhatIf) {
    Write-Host "[WhatIf] Crear carpetas de respaldo y ejecutar ejecutar_todo.sql con variables de ruta."
    Initialize-AsadaBackupDirectory -Path $config.RutaRespaldosASADA -SqlService $sql.Servicio -WhatIf
    Initialize-AsadaBackupDirectory -Path $config.RutaRespaldosASADA_DW -SqlService $sql.Servicio -WhatIf
    Write-Host "[WhatIf] npm install/build backend y frontend."
    if ($CargarDemo) { Write-Host "[WhatIf] Ejecutar 19_datos_demo.sql" }
    if ($InstalarJobs) { Write-Host "[WhatIf] Instalar jobs deshabilitados." }
    exit 0
}

Initialize-AsadaBackupDirectory -Path $config.RutaRespaldosASADA -SqlService $sql.Servicio
Initialize-AsadaBackupDirectory -Path $config.RutaRespaldosASADA_DW -SqlService $sql.Servicio

Write-Host "==> Ejecutando ejecutar_todo.sql (creación de ASADA y ASADA_DW)..."
Invoke-AsadaSql -Servidor $Servidor -InputFile $config.ScriptEjecutarTodo -Variables $sqlVars -WorkingDirectory $paths.SqlDir

if ($CargarDemo) {
    Write-Host ""
    Write-Host "ADVERTENCIA: Va a cargar datos de demostración (medidores SC-, ~1 año simulado, ETL)." -ForegroundColor Yellow
    $demoCheck = Invoke-AsadaSqlQuery -Servidor $Servidor -Query "SET NOCOUNT ON; SELECT COUNT(*) FROM ASADA.dbo.Medidor WHERE numero_serie LIKE 'SC-%';"
    if ($demoCheck -ne '0') {
        Write-Host "ERROR: Ya existen medidores SC-. No se ejecuta la demo." -ForegroundColor Red
        exit 1
    }
    Write-Host "==> Ejecutando 19_datos_demo.sql ..."
    Invoke-AsadaSql -Servidor $Servidor -InputFile $config.ScriptDemo -WorkingDirectory $paths.SqlDir
    Write-Host "==> Validación DW (sp_ValidarCargaDW)..."
    Invoke-AsadaSql -Servidor $Servidor -InputFile $config.ScriptVerificar -WorkingDirectory $paths.SqlDir | Out-Host
}

if ($InstalarJobs) {
    & (Join-Path $deployRoot 'Install-AsadaAgentJobs.ps1') -Servidor $Servidor -SqlDir $paths.SqlDir -Modo 'Nuevo' -Recrear:$RecrearJobs
}

Write-Host "==> npm install (backend)..."
Push-Location $paths.Backend
try { npm install --no-fund --no-audit } finally { Pop-Location }

Write-Host "==> npm install + build (frontend)..."
Push-Location $paths.Frontend
try {
    npm install --no-fund --no-audit
    npm run build
} finally { Pop-Location }

$envRuta = Join-Path $paths.Backend '.env'
if (-not (Test-Path $envRuta)) {
    $text = [IO.File]::ReadAllText((Join-Path $paths.Backend '.env.example'), [Text.Encoding]::UTF8)
    $bytes = New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $secreto = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    $text = $text -replace '(?m)^DB_SERVIDOR=[^\r\n]*', ('DB_SERVIDOR=' + $Servidor.Replace('$', '$$'))
    $text = $text -replace '(?m)^DB_DRIVER=[^\r\n]*', ('DB_DRIVER=' + $driver)
    $text = $text -replace '(?m)^JWT_SECRETO=[^\r\n]*', ('JWT_SECRETO=' + $secreto)
    [IO.File]::WriteAllText($envRuta, $text, (New-Object Text.UTF8Encoding($false)))
    Write-Host "    backend\.env creado."
} else {
    Write-Host "    backend\.env ya existe (no se modifica)."
}

Write-Host ""
Write-Host "Instalación nueva completada." -ForegroundColor Green
Write-Host "Verifique: deploy\verificar.ps1 -Servidor `"$Servidor`""
Write-Host "Inicie: deploy\INICIAR.bat o cd backend && npm start"
