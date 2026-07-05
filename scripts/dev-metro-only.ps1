$ErrorActionPreference = "Stop"

# Metro/Expo web only on :8081, pointed at the standalone daemon (:6768).
# Preview manages this process; the daemon runs separately via dev-daemon-only.ps1.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PATH = "$ScriptDir\..\node_modules\.bin;$env:PATH"

$env:APP_VARIANT = "development"
$env:EXPO_PUBLIC_LOCAL_DAEMON = "localhost:6768"
$env:BROWSER = "none"

Set-Location "$ScriptDir\..\packages\app"
npx expo start
