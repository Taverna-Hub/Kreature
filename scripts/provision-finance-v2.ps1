[CmdletBinding()]
param(
  [switch]$ValidateOnly,
  [switch]$ReadRootKeyFromClipboard,
  [switch]$GenerateRootKeyToClipboard
)

$ErrorActionPreference = 'Stop'

function Wait-ForConfirmation {
  param([Parameter(Mandatory)][string]$Message)

  $reply = Read-Host "$Message [s/N]"
  if ($reply -notmatch '^[sS]$') {
    throw 'Provisionamento cancelado pelo operador.'
  }
}

function ConvertFrom-SecureString {
  param([Parameter(Mandatory)][securestring]$Value)

  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Assert-Base64RootKey {
  param([Parameter(Mandatory)][string]$Value)

  # Accept the common forms copied from a terminal, password manager, or
  # environment-variable snippet without weakening the actual key requirement.
  $Value = $Value.Trim() -replace '^DATA_ROOT_KEY_V1\s*=\s*', ''
  $Value = $Value.Trim('"', "'") -replace '\s', ''

  try {
    $bytes = [Convert]::FromBase64String($Value)
  }
  catch {
    throw 'A chave deve estar em Base64 válido.'
  }

  if ($bytes.Length -ne 32) {
    throw 'A chave deve decodificar para exatamente 32 bytes.'
  }
}

function Invoke-Supabase {
  param([Parameter(Mandatory)][string[]]$Arguments)

  & npx supabase @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "O comando Supabase falhou: supabase $($Arguments -join ' ')"
  }
}

if ($ValidateOnly) {
  Write-Host 'Validação concluída: o provisionamento pode ser executado diretamente pelo PowerShell.'
  exit 0
}

if ($ReadRootKeyFromClipboard -and $GenerateRootKeyToClipboard) {
  throw 'Use apenas uma opção de chave: -ReadRootKeyFromClipboard ou -GenerateRootKeyToClipboard.'
}

Write-Host ''
Write-Host 'Kreature Finance v2 — provisionamento seguro' -ForegroundColor Cyan
Write-Host 'A chave não será gravada em .env, Git, banco de dados ou logs.'

Write-Host ''
Write-Host '1/5 — Gere e guarde a chave de recuperação' -ForegroundColor Cyan
Write-Host 'Gere 32 bytes em Base64, por exemplo:'
Write-Host '  $bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); [Convert]::ToBase64String($bytes)'
Write-Host 'Guarde-a em um cofre offline criptografado antes de continuar.' -ForegroundColor Yellow
if ($GenerateRootKeyToClipboard) {
  if (-not (Get-Command Set-Clipboard -ErrorAction SilentlyContinue)) {
    throw 'Set-Clipboard não está disponível neste PowerShell.'
  }
  $keyBytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($keyBytes)
    $rootKey = [Convert]::ToBase64String($keyBytes)
  }
  finally {
    $rng.Dispose()
    Remove-Variable keyBytes -ErrorAction SilentlyContinue
  }
  Set-Clipboard -Value $rootKey
  Write-Host 'Uma nova chave foi copiada para a área de transferência sem ser exibida.' -ForegroundColor Green
  Read-Host 'Cole-a agora no cofre offline e pressione Enter para continuar' | Out-Null
}
elseif ($ReadRootKeyFromClipboard) {
  if (-not (Get-Command Get-Clipboard -ErrorAction SilentlyContinue)) {
    throw 'Get-Clipboard não está disponível neste PowerShell. Use o prompt protegido sem -ReadRootKeyFromClipboard.'
  }
  $rootKey = Get-Clipboard -Raw
  if ([string]::IsNullOrWhiteSpace($rootKey)) {
    throw 'A área de transferência está vazia.'
  }
  Write-Host 'Chave lida da área de transferência sem ser exibida.' -ForegroundColor Green
}
else {
  $secureRootKey = Read-Host 'Cole DATA_ROOT_KEY_V1 (entrada oculta)' -AsSecureString
  $rootKey = ConvertFrom-SecureString -Value $secureRootKey
}
$rootKey = $rootKey.Trim() -replace '^DATA_ROOT_KEY_V1\s*=\s*', ''
$rootKey = $rootKey.Trim('"', "'") -replace '\s', ''
Assert-Base64RootKey -Value $rootKey

try {
  Write-Host ''
  Write-Host '2/5 — Cadastre os secrets da Edge Function' -ForegroundColor Cyan
  Wait-ForConfirmation 'Cadastrar DATA_ROOT_KEY_ACTIVE_VERSION=1 e DATA_ROOT_KEY_V1 agora?'
  Invoke-Supabase -Arguments @('secrets', 'set', 'DATA_ROOT_KEY_ACTIVE_VERSION=1', "DATA_ROOT_KEY_V1=$rootKey")
  Write-Host 'Secrets cadastrados. O valor não foi gravado localmente.' -ForegroundColor Green

  Write-Host ''
  Write-Host '3/5 — Implante a Edge Function' -ForegroundColor Cyan
  Wait-ForConfirmation 'Implantar finance-v2 agora?'
  Invoke-Supabase -Arguments @('functions', 'deploy', 'finance-v2', '--use-api')

  Write-Host ''
  Write-Host '4/5 — Endureça Auth e API no Dashboard' -ForegroundColor Cyan
  Write-Host 'Abra: https://supabase.com/dashboard/project/qpxyjmvsrvkotdugwbhi'
  Write-Host 'Em Authentication, configure confirmação de e-mail, senha mínima de 12 caracteres e reautenticação na troca de senha.'
  Write-Host 'Mantenha MFA TOTP habilitado; o fluxo de cadastro será ligado pelo frontend v2.'
  Write-Host 'Não altere os schemas expostos agora: o frontend atual ainda depende de public.' -ForegroundColor Yellow
  Write-Host 'Somente no corte coordenado, após publicar o frontend v2, exponha api e remova public, app_private e catalog.' -ForegroundColor Yellow
  Read-Host 'Pressione Enter após concluir somente as configurações de Auth' | Out-Null

  Write-Host ''
  Write-Host '5/5 — Valide antes do corte destrutivo' -ForegroundColor Cyan
  Write-Host 'Execute npm test e npm run build; depois teste dois usuários sintéticos para RLS, FKs e descriptografia.'
  Write-Host 'Não execute supabase/cutover/RESET-V2.md antes dessas validações e da aprovação da manutenção.' -ForegroundColor Yellow
}
finally {
  Remove-Variable rootKey -ErrorAction SilentlyContinue
  Remove-Variable secureRootKey -ErrorAction SilentlyContinue
}
