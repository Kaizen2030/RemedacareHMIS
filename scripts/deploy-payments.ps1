# Deploys the RemedacareHMS payment functions to Supabase and prepares the background sweep.
#
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-payments.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-payments.ps1 -SiteUrl https://app.yourhospital.co.ke
#
# What it does:
#   1. Logs you in to Supabase (browser) unless SUPABASE_ACCESS_TOKEN is already set
#   2. Creates two random secrets ONCE and keeps them in %USERPROFILE%\.remedacare (never in the repo)
#   3. Sets the function secrets, then deploys the 4 payments-* functions (built by Supabase, no Docker)
#   4. Puts the SQL that schedules the lost-webhook sweep on your clipboard
param(
  [string]$ProjectRef = 'izsincdmayaogcwbhlty',
  [string]$SiteUrl = 'https://remedacarehms.com',
  [switch]$RotateSecrets
)
$ErrorActionPreference = 'Stop'
$Cli = 'supabase@2.20.12'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Invoke-Cli([string[]]$CliArgs) {
  & npx --yes $Cli @CliArgs
  if ($LASTEXITCODE -ne 0) { throw "supabase $($CliArgs -join ' ') failed (exit $LASTEXITCODE)" }
}
function New-Secret([int]$Bytes) {
  $b = New-Object byte[] $Bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return -join ($b | ForEach-Object { $_.ToString('x2') })
}

Write-Host "`n== RemedacareHMS payments deploy -> project $ProjectRef" -ForegroundColor Cyan

# 1. Login
if (-not $env:SUPABASE_ACCESS_TOKEN) {
  Write-Host "`n[1/4] Logging in to Supabase (a browser window opens; approve it, then come back)..."
  Invoke-Cli @('login')
} else { Write-Host "`n[1/4] Using SUPABASE_ACCESS_TOKEN from the environment" }

# 2. Secrets: generated once, reused on later runs so pending M-Pesa callbacks keep working
$SecretDir = Join-Path $env:USERPROFILE '.remedacare'
$SecretFile = Join-Path $SecretDir "payments-secrets-$ProjectRef.json"
New-Item -ItemType Directory -Force $SecretDir | Out-Null
if ((Test-Path $SecretFile) -and -not $RotateSecrets) {
  $s = Get-Content $SecretFile -Raw | ConvertFrom-Json
  Write-Host "[2/4] Reusing secrets from $SecretFile"
} else {
  $s = [pscustomobject]@{ webhook = (New-Secret 32); cron = (New-Secret 24); created = (Get-Date).ToString('s') }
  $s | ConvertTo-Json | Set-Content -Encoding UTF8 $SecretFile
  Write-Host "[2/4] New secrets saved to $SecretFile (keep this file private; do not commit it)"
}

$EnvFile = Join-Path $env:TEMP "rc-payments-$([guid]::NewGuid()).env"
try {
  @("PAYMENTS_WEBHOOK_SECRET=$($s.webhook)", "PAYMENTS_CRON_SECRET=$($s.cron)", "SITE_URL=$SiteUrl") |
    Set-Content -Encoding ASCII $EnvFile
  Invoke-Cli @('secrets', 'set', '--env-file', $EnvFile, '--project-ref', $ProjectRef)
} finally { Remove-Item -Force -ErrorAction SilentlyContinue $EnvFile }

# 3. Deploy (bundled by Supabase's API, so Docker is not needed)
Write-Host "`n[3/4] Deploying functions..."
foreach ($fn in 'payments-initiate', 'payments-status', 'payments-refund', 'payments-webhook', 'appointments-reminders', 'gemini-proxy', 'fhir', 'fhir-bundle', 'fhir-claim', 'fhir-patient', 'fhir-encounter', 'patient-portal') {
  Write-Host "  - $fn"
  Invoke-Cli @('functions', 'deploy', $fn, '--project-ref', $ProjectRef, '--no-verify-jwt', '--use-api')
}

# 4. Sweep SQL -> clipboard
$Sql = @"
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname = 'payments-sweep';
select cron.schedule('payments-sweep', '*/3 * * * *', `$job`$
  select net.http_post(
    url := 'https://$ProjectRef.supabase.co/functions/v1/payments-status',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '$($s.cron)'),
    body := '{"sweep":true}'::jsonb)
`$job`$);
select cron.unschedule(jobid) from cron.job where jobname = 'appointments-reminders';
select cron.schedule('appointments-reminders', '*/5 * * * *', `$job`$
  select net.http_post(
    url := 'https://$ProjectRef.supabase.co/functions/v1/appointments-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '$($s.cron)'),
    body := '{"sweep":true}'::jsonb)
`$job`$);
select jobid, jobname, schedule, active from cron.job where jobname in ('payments-sweep', 'appointments-reminders') order by jobname;
"@
Set-Clipboard -Value $Sql
Write-Host "`n[4/4] Done. The sweep SQL is on your clipboard." -ForegroundColor Green
Write-Host "      Paste it into Supabase -> SQL Editor -> Run (choose 'Run without RLS' if asked)."
Write-Host "      You should get two rows: appointments-reminders (every 5 min) and payments-sweep (every 3 min), both active"
Write-Host "`nWebhook URL for your gateways: https://$ProjectRef.supabase.co/functions/v1/payments-webhook?provider=<daraja|paystack|flutterwave|pesapal>"
Write-Host "Card checkouts return patients to: $SiteUrl/billing  (change with -SiteUrl if that is not your web address)`n"
