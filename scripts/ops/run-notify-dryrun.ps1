# ALT-08.2 — runner seguro, somente simulação.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $root
$env:VIGIA_NOTIFY_SCHEDULER = '1'
$env:VIGIA_NOTIFY_DRY_RUN = '1'
$env:DEMO_MODE = '0'
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
& npm.cmd run worker:notify:supervised
exit $LASTEXITCODE
