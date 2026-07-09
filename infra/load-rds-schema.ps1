# Load the CM-Pharmacy schema into RDS from Windows/PowerShell (no bash needed).
# Mirrors db/load-schema.sh: applies supabase/migrations/*.sql then db/functions/*.sql.
#
# Prereqs: psql in PATH, AWS CLI configured, Terraform state present in ./terraform
# so the RDS endpoint + Secrets Manager ARN can be read from outputs.
#
#   cd CM-Pharmacy-API/infra
#   .\load-rds-schema.ps1
$ErrorActionPreference = "Stop"

$InfraDir = $PSScriptRoot
$TfDir    = Join-Path $InfraDir "terraform"
$ApiRoot  = Split-Path $InfraDir -Parent

# ── Read connection details from Terraform outputs ───────────────────────────
Push-Location $TfDir
try {
  $SecretArn = terraform output -raw rds_master_user_secret_arn
  $Address   = terraform output -raw rds_address
  $DbName    = terraform output -raw rds_db_name
} finally {
  Pop-Location
}

# ── Fetch the RDS master password from Secrets Manager ───────────────────────
$Secret = aws secretsmanager get-secret-value --secret-id $SecretArn --query SecretString --output text
$Parsed = $Secret | ConvertFrom-Json

# Drive psql entirely via libpq environment variables — no connection URL and no
# dbname argument on the command line. This avoids any arg-parsing ambiguity and
# guarantees the password reaches psql (it reads PGPASSWORD from the environment).
$env:PGHOST     = $Address
$env:PGPORT     = "5432"
$env:PGUSER     = $Parsed.username
$env:PGDATABASE = $DbName
$env:PGPASSWORD = $Parsed.password
$env:PGSSLMODE  = "require"   # RDS is reachable over the public internet — force TLS.

if ([string]::IsNullOrEmpty($env:PGPASSWORD)) {
  throw "Failed to read password from Secrets Manager secret $SecretArn"
}
Write-Host "Connecting as '$($env:PGUSER)' to $Address/$DbName (password length $($env:PGPASSWORD.Length))" -ForegroundColor Cyan

# ── Connection smoke test ────────────────────────────────────────────────────
psql -v ON_ERROR_STOP=1 -c "select 1 as ok;"

# ── Apply migrations, then RPC functions (same order as bootstrap) ───────────
Write-Host "Applying migrations..." -ForegroundColor Green
Get-ChildItem "$ApiRoot\supabase\migrations\*.sql" | Sort-Object Name | ForEach-Object {
  Write-Host "  -> $($_.Name)"
  psql -v ON_ERROR_STOP=1 -q -f $_.FullName
}

Write-Host "Applying RPC functions..." -ForegroundColor Green
Get-ChildItem "$ApiRoot\db\functions\*.sql" | Sort-Object Name | ForEach-Object {
  Write-Host "  -> $($_.Name)"
  psql -v ON_ERROR_STOP=1 -q -f $_.FullName
}

Write-Host "Done. Tables:" -ForegroundColor Green
psql -c "\dt"

# Clear the connection env vars from this session.
$env:PGPASSWORD = $null
$env:PGHOST = $null; $env:PGPORT = $null; $env:PGUSER = $null
$env:PGDATABASE = $null; $env:PGSSLMODE = $null
