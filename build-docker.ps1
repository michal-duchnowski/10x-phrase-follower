# Build Docker image with environment variables from .env file.
# The file is mounted as a BuildKit secret and is not retained in image layers.

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

# Build Docker image with an ephemeral BuildKit secret
Write-Host "Building Docker image with an ephemeral .env secret..." -ForegroundColor Green

# Enable BuildKit for better layer caching (no Dockerfile changes needed)
$env:DOCKER_BUILDKIT = "1"

docker build `
    --secret id=build_env,src=.env `
    -t phrase-follower:local .

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nBuild successful! You can now run:" -ForegroundColor Green
    Write-Host "  docker compose up" -ForegroundColor Cyan
} else {
    Write-Host "`nBuild failed!" -ForegroundColor Red
    exit 1
}

