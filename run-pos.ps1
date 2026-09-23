$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$entry = Join-Path $root 'dist\main\main\main.js'

if (!(Test-Path $entry)) {
    Write-Host 'Bake Alley POS has not been built yet.'
    Write-Host 'Run: npm run build'
    exit 1
}

if (!(Test-Path $electron)) {
    Write-Host 'Electron is not installed in node_modules.'
    Write-Host 'Run: npm install'
    exit 1
}

Start-Process -FilePath $electron -ArgumentList @($root) -WorkingDirectory $root
