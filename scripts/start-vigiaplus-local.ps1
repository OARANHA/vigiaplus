# VIGIAPLUS — inicialização local independente do Neon
# Uso: powershell -ExecutionPolicy Bypass -File .\scripts\start-vigiaplus-local.ps1
#      powershell -ExecutionPolicy Bypass -File .\scripts\start-vigiaplus-local.ps1 -Mode demo
# O modo owner oferece cadastro real de clientes em PGlite LOCAL, sem credenciais
# hardcoded. Não é deployment de produção. Não mata processos das portas 3100/3199.
[CmdletBinding()]
param(
  [ValidateSet('owner','demo')][string]$Mode = 'owner',
  [ValidateRange(1024,65535)][int]$Port = 3199,
  [switch]$SkipInstall
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
if (-not (Test-Path (Join-Path $root 'package-lock.json'))) {
  throw 'package-lock.json ausente: nao executar instalacao sem lockfile.'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue) -or
    -not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw 'Node.js e npm nao encontrados. Instale Node.js 22+ antes de continuar.'
}
$nodeMajor = [int]((& node -p 'process.versions.node.split(".")[0]').Trim())
if ($nodeMajor -lt 22) { throw 'O VigiaPlus requer Node.js 22 ou superior.' }

# Verifica somente a porta exata. Nunca encerra outra aplicação automaticamente.
$client = [Net.Sockets.TcpClient]::new()
try {
  $result = $client.BeginConnect('127.0.0.1',$Port,$null,$null)
  if ($result.AsyncWaitHandle.WaitOne(600) -and $client.Connected) {
    throw "A porta $Port ja esta ocupada. Nao foi encerrado nenhum processo."
  }
} finally { $client.Dispose() }

$dir = Join-Path $root $(if ($Mode -eq 'demo') { '.data\vigiaplus-demo' } else { '.data\vigiaplus-owner' })
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# Importante: impede herdar conexoes remotas/configuracoes reais da sessao.
$env:DATABASE_URL = $null
$env:RLS_DATABASE_URL = $null
$env:DEMO_MODE = if ($Mode -eq 'demo') { '1' } else { '0' }
$env:VIGIA_SEED_SAMPLE_TENANTS = '0'
$env:VIGIA_DB_BOOTSTRAP_MODE = 'legacy-bootstrap'
$env:VIGIA_RLS_MODE = $null
$env:VIGIA_NOTIFY_SCHEDULER = '0'
$env:PGLITE_DIR = $dir
$env:NODE_ENV = 'development'
$env:HOSTNAME = '127.0.0.1'
$env:APP_URL = "http://127.0.0.1:$Port"
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $bytes = New-Object byte[] 48
  $rng.GetBytes($bytes)
  $env:SESSION_SECRET = [Convert]::ToBase64String($bytes)
} finally { $rng.Dispose() }
$env:ADMIN_EMAIL = $null
$env:ADMIN_PASSWORD = $null
$env:ADMIN_NAME = $null

try {
  if ($Mode -eq 'owner') {
    $email = Read-Host 'E-mail do proprietario (somente bootstrap da primeira execucao)'
    if ($email -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') {
      throw 'E-mail invalido.'
    }
    $secure = Read-Host -AsSecureString 'Senha do proprietario (12+ caracteres, maiuscula, minuscula, numero)'
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
      $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
      if ($password.Length -lt 12 -or $password -cnotmatch '[A-Z]' -or
          $password -cnotmatch '[a-z]' -or $password -notmatch '\d') {
        throw 'Senha precisa de 12+ caracteres, maiuscula, minuscula e numero.'
      }
      $env:ADMIN_EMAIL = $email.Trim().ToLowerInvariant()
      $env:ADMIN_PASSWORD = $password
      $env:ADMIN_NAME = 'Proprietario'
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
      $password = $null
    }
  }
  if (-not $SkipInstall -and -not (Test-Path 'node_modules')) {
    Write-Host 'Instalando dependencias de acordo com package-lock.json...'
    & npm ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci falhou.' }
  }
  Write-Host "VigiaPlus $Mode => http://127.0.0.1:$Port"
  Write-Host "Banco local isolado: $dir"
  Write-Host 'Para encerrar, use Ctrl+C nesta janela. Nenhum deploy sera realizado.'
  & npm run dev -- --hostname 127.0.0.1 --port $Port
  if ($LASTEXITCODE -ne 0) { throw "Next.js encerrou com codigo $LASTEXITCODE." }
} finally {
  foreach ($key in @('ADMIN_PASSWORD','ADMIN_EMAIL','ADMIN_NAME','SESSION_SECRET','DATABASE_URL','RLS_DATABASE_URL')) {
    [Environment]::SetEnvironmentVariable($key,$null,'Process')
  }
}
