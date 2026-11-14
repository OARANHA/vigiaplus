# ALT-08.2 — instalação manual e reversível.
# Uso: powershell -NoProfile -File scripts/ops/install-notify-dryrun-task.ps1 -Install
param([switch]$Install, [switch]$Remove)
$ErrorActionPreference = 'Stop'
$name = 'VigiaPlus-Notify-DryRun'
if ($Install -and $Remove) { throw 'Escolha somente -Install ou -Remove' }
if (-not $Install -and -not $Remove) {
  Write-Output 'Nenhuma alteração. Use -Install ou -Remove explicitamente.'
  exit 0
}
if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop
  Write-Output "Tarefa $name removida."
  exit 0
}
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runner = Join-Path $PSScriptRoot 'run-notify-dryrun.ps1'
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $runner + '"'
$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 365)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 4) -StartWhenAvailable
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger `
  -Settings $settings -Description 'VigiaPlus: dry-run sem envios externos; ALT-08.2' -Force | Out-Null
Write-Output "Tarefa $name registrada em simulação. Não habilita entrega real."
