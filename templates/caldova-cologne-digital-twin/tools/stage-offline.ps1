# Start the Caldova Cologne twin LOCALLY, with no network (a fallback for venues without good WiFi).
#
#   Double-click Start-Offline.cmd, or:  pwsh tools/stage-offline.ps1 [-Rebuild]
#
# Serves the production build at http://127.0.0.1:5196 and opens the default browser. Works with
# WiFi off once the geodata has been built: every geodata file, the mesh and the tours are in dist/.
# What needs Fabric (sign-in, model figures, reorders) is not available here; the twin itself is.
# After a code change run it with -Rebuild (it does not detect a stale dist/ on its own).
param([switch]$Rebuild, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$port = 5196
if ($Rebuild -or -not (Test-Path 'dist/precache.json')) {
  Write-Host 'building the twin (needs no network) ...'
  npx vite build
  if ($LASTEXITCODE -ne 0) { throw 'build failed' }
}
$want = (Get-Content 'dist/precache.json' -Raw | ConvertFrom-Json).version
$busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($busy) {
  # Something already listens: only reuse it if it IS this twin, in this build.
  try { $have = (Invoke-RestMethod "http://127.0.0.1:$port/precache.json" -TimeoutSec 5).version } catch { $have = $null }
  if ($have -ne $want) { throw "port $port is in use by something else (or an older build: $have). Close it and start again." }
} else {
  Start-Process -WindowStyle Minimized -FilePath 'node' -ArgumentList @('node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', "$port", '--strictPort')
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { break }
  }
}
if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
  throw "the local server did not start on port $port"
}
if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$port/" }
Write-Host "Caldova Cologne twin running locally: http://127.0.0.1:$port/  (close the 'node' window to stop)"
