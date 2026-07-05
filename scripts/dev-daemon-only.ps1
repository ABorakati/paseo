$ErrorActionPreference = "Stop"

# Standalone dev daemon on :6768 with a STABLE home so it survives preview restarts.
# Run this in the background; the metro/preview process connects to it.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PATH = "$ScriptDir\..\node_modules\.bin;$env:PATH"

if (-not $env:PASEO_HOME) {
    $env:PASEO_HOME = "$env:USERPROFILE\.paseo-dev-web"
    New-Item -ItemType Directory -Force -Path $env:PASEO_HOME | Out-Null
}
if (-not $env:PASEO_LOCAL_MODELS_DIR) {
    $env:PASEO_LOCAL_MODELS_DIR = "$env:USERPROFILE\.paseo\models\local-speech"
    New-Item -ItemType Directory -Force -Path $env:PASEO_LOCAL_MODELS_DIR | Out-Null
}

# SECURITY: wildcard CORS is dev-only and acceptable because the daemon binds to
# localhost. Never use this for production.
$env:PASEO_CORS_ORIGINS = "*"
$env:APP_VARIANT = "development"
$env:PASEO_LISTEN = "127.0.0.1:6768"

Write-Host "Paseo dev daemon -> http://127.0.0.1:6768  (home: $env:PASEO_HOME)"
npm run dev:server:watch
