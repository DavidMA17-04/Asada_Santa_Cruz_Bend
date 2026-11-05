# Zip del proyecto (tres carpetas hermanas). Excluye node_modules, .git, .env.
param([string]$Destino)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Asada.Deploy.psm1') -Force
$paths = Resolve-AsadaProjectRoot -DeployRoot $PSScriptRoot
if (-not (Test-AsadaProjectLayout $paths)) { exit 1 }

$nombre = 'ASADA_proyecto'
if (-not $Destino) {
    $Destino = Join-Path ([Environment]::GetFolderPath('Desktop')) ("{0}_{1:yyyy-MM-dd}.zip" -f $nombre, (Get-Date))
}

$temporal = Join-Path $env:TEMP ("empaquetar_" + [guid]::NewGuid().ToString('N'))
$carpeta = Join-Path $temporal $nombre

try {
    Write-Host "Copiando desde $($paths.Root)..." -ForegroundColor Cyan
    robocopy $paths.Root $carpeta /E `
        /XD node_modules .git .vscode dist deploy\log `
        /XF .env *.log '~$*' `
        /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy falló ($LASTEXITCODE)" }
    if (Test-Path (Join-Path $carpeta 'backend\.env')) { throw 'backend\.env no debe incluirse en el zip.' }

    if (Test-Path $Destino) { Remove-Item $Destino -Force }
    Compress-Archive -Path $carpeta -DestinationPath $Destino
    $mb = [math]::Round((Get-Item $Destino).Length / 1MB, 2)
    Write-Host "Listo: $Destino ($mb MB)" -ForegroundColor Green
    Write-Host "Clonar o descomprimir con estructura backend / frontend / sql y usar deploy\INSTALAR.bat"
}
finally {
    if (Test-Path $temporal) { Remove-Item $temporal -Recurse -Force }
}
