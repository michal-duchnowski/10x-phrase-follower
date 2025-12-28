# Build Docker image with environment variables from .env file

# Check if .env exists
if (-not (Test-Path .env)) {
    Write-Host "Error: .env file not found!" -ForegroundColor Red
    Write-Host "Please create .env file with SUPABASE variables." -ForegroundColor Yellow
    exit 1
}

# Read .env file
$envVars = @{}
Get-Content .env | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
        $key = $matches[1].Trim()
        $value = $matches[2].Trim()
        $envVars[$key] = $value
    }
}

# Check required variables
$required = @('PUBLIC_SUPABASE_URL', 'PUBLIC_SUPABASE_KEY', 'SUPABASE_URL', 'SUPABASE_KEY')
$missing = @()
foreach ($var in $required) {
    if (-not $envVars.ContainsKey($var) -or [string]::IsNullOrWhiteSpace($envVars[$var])) {
        $missing += $var
    }
}

if ($missing.Count -gt 0) {
    Write-Host "Error: Missing required environment variables:" -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
    exit 1
}

# Build Docker image with build args
Write-Host "Building Docker image with environment variables..." -ForegroundColor Green

# Enable BuildKit for better layer caching (no Dockerfile changes needed)
$env:DOCKER_BUILDKIT = "1"

docker build `
    --build-arg PUBLIC_SUPABASE_URL="$($envVars['PUBLIC_SUPABASE_URL'])" `
    --build-arg PUBLIC_SUPABASE_KEY="$($envVars['PUBLIC_SUPABASE_KEY'])" `
    --build-arg SUPABASE_URL="$($envVars['SUPABASE_URL'])" `
    --build-arg SUPABASE_KEY="$($envVars['SUPABASE_KEY'])" `
    --build-arg NODE_ENV="production" `
    -t phrase-follower:local .

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nBuild successful! You can now run:" -ForegroundColor Green
    Write-Host "  docker compose up" -ForegroundColor Cyan
} else {
    Write-Host "`nBuild failed!" -ForegroundColor Red
    exit 1
}

