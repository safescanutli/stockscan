$ErrorActionPreference = "SilentlyContinue"

$port = 4173
$appUrl = "http://localhost:$port"
$healthUrl = "$appUrl/api/health"
$nodePath = "C:\Program Files\nodejs\node.exe"

Set-Location $PSScriptRoot

function Test-TradePlanner {
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-TradePlanner)) {
  if (-not (Test-Path $nodePath)) {
    $nodeCommand = Get-Command node
    if ($nodeCommand) {
      $nodePath = $nodeCommand.Source
    }
  }

  if (-not $nodePath -or -not (Test-Path $nodePath)) {
    Write-Host "Node.js was not found. Install Node.js, then run this launcher again."
    Read-Host "Press Enter to close"
    exit 1
  }

  Start-Process -FilePath $nodePath -ArgumentList "server.js" -WorkingDirectory $PSScriptRoot -WindowStyle Minimized
}

for ($attempt = 0; $attempt -lt 40; $attempt++) {
  if (Test-TradePlanner) {
    Start-Process $appUrl
    exit 0
  }
  Start-Sleep -Milliseconds 500
}

Write-Host "The app did not finish starting."
Write-Host "Try double-clicking start-server.bat so the error stays visible."
Read-Host "Press Enter to close"
