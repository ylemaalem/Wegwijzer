# Wegwijzer — Edge Function deploy script (Windows PowerShell)
# Gebruik: ./deploy.ps1

# Laad .env bestand
$envFile = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envFile)) {
    Write-Host "FOUT: .env bestand niet gevonden. Maak .env aan met:" -ForegroundColor Red
    Write-Host "  SUPABASE_ACCESS_TOKEN=jouw_token"
    Write-Host "  SUPABASE_PROJECT_REF=jouw_project_ref"
    exit 1
}

Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
        [System.Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), "Process")
    }
}

$token = $env:SUPABASE_ACCESS_TOKEN
$projectRef = $env:SUPABASE_PROJECT_REF

if (-not $token -or -not $projectRef) {
    Write-Host "FOUT: SUPABASE_ACCESS_TOKEN of SUPABASE_PROJECT_REF ontbreekt in .env" -ForegroundColor Red
    exit 1
}

Write-Host "Deploying edge function 'chat' naar project $projectRef..." -ForegroundColor Cyan
npx supabase functions deploy chat --no-verify-jwt --project-ref $projectRef
Write-Host "Klaar!" -ForegroundColor Green
