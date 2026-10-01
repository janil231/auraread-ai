# AuraRead AI — pre-demo smoke test
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File smoke-test.ps1
#
# Exercises every failure path that has silently broken a live demo before.
# Reads GEMINI_API_KEY from .env.local, so it never needs a key pasted in.
# Pass -SkipBuild to test the existing build instead of rebuilding.

param([switch]$SkipBuild)

$ErrorActionPreference = "Continue"
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $env:TEMP "auraread-smoke.log"
$pass = 0
$fail = 0

function Result($name, $ok, $detail) {
  if ($ok) { $script:pass++; "  [PASS] $name  $detail" }
  else     { $script:fail++; "  [FAIL] $name  $detail" }
}

# The route returns 400/413 on bad input, and PowerShell throws on those, so we
# read the response body by hand instead of using Invoke-RestMethod.
function Post-Ocr($body, $timeout = 180) {
  try {
    return Invoke-RestMethod -Uri "http://localhost:3000/api/ocr" -Method POST `
      -ContentType "application/json" -Body $body -TimeoutSec $timeout
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      try {
        $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $raw = $sr.ReadToEnd()
        $sr.Close()
        if ($raw) { return ($raw | ConvertFrom-Json) }
      } catch { }
    }
    return $null
  }
}

Write-Host ""
Write-Host "=== 0. Preconditions ===" -ForegroundColor Cyan
if (-not $SkipBuild) {
  Write-Host "  building..."
  Push-Location $project
  npm run build 2>&1 | Out-Null
  $buildOk = $LASTEXITCODE -eq 0
  Pop-Location
  Result "production build" $buildOk ""
} else {
  Result "production build" (Test-Path (Join-Path $project ".next\BUILD_ID")) "(skipped, using existing .next)"
}

$envFile = Join-Path $project ".env.local"
if (-not (Test-Path $envFile)) { Write-Host "  no .env.local - app will run on sample text only" -ForegroundColor Yellow }

Write-Host ""
Write-Host "=== 1. Starting server ===" -ForegroundColor Cyan
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
$proc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c","npm run start > `"$log`" 2>&1" `
  -WorkingDirectory $project -WindowStyle Hidden -PassThru

$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 1
  try { $null = Invoke-WebRequest -Uri "http://localhost:3000/" -UseBasicParsing -TimeoutSec 4; $ready = $true; break } catch { }
}
if (-not $ready) {
  Write-Host "  SERVER DID NOT START:" -ForegroundColor Red
  Get-Content $log
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  exit 1
}
Write-Host "  ready in ${i}s"

try {
  Write-Host ""
  Write-Host "=== 2. Health check (GET /api/ocr) ===" -ForegroundColor Cyan
  $h = Invoke-RestMethod -Uri "http://localhost:3000/api/ocr" -TimeoutSec 30
  Result "API key detected by server" ([bool]$h.configured) "key=$($h.key)"
  Result "model list populated" ($h.models.Count -ge 2) ($h.models -join ", ")

  $png = [System.IO.File]::ReadAllBytes((Join-Path $project "public\sample-page.png"))
  $b64 = [System.Convert]::ToBase64String($png)

  Write-Host ""
  Write-Host "=== 3. Real OCR (the path that matters) ===" -ForegroundColor Cyan
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $r = Post-Ocr (@{ image = $b64; mimeType = "image/png" } | ConvertTo-Json -Compress)
  $sw.Stop()
  $first = (($r.text -split "`n")[0]).Trim()
  Result "extracted real text" ([bool]$r.ok -and $r.fallback -ne $true) "$($r.chars) chars via $($r.model) in $([math]::Round($sw.Elapsed.TotalSeconds,1))s"
  Result "did NOT return sample text" ($r.chars -ne 1362) "sample fallback is 1362 chars"
  Result "recognised page content" ($first -like "*SCIENCE*" -or $first -like "*Water Cycle*") "first line = '$first'"
  Result "latency under 20s" ($sw.Elapsed.TotalSeconds -lt 20) "$([math]::Round($sw.Elapsed.TotalSeconds,1))s"

  Write-Host ""
  Write-Host "=== 4. Failure paths must never break the app ===" -ForegroundColor Cyan

  $r = Post-Ocr "not-json"
  Result "malformed JSON returns fallback" ($r -and $r.fallback -eq $true -and $r.text.Length -gt 0) "reason=$($r.reason)"

  $r = Post-Ocr "{}"
  Result "missing image returns fallback" ($r -and $r.fallback -eq $true -and $r.text.Length -gt 0) "reason=$($r.reason)"

  $r = Post-Ocr (@{ image = "!!!not base64!!!" } | ConvertTo-Json -Compress)
  Result "garbage image returns fallback" ($r -and $r.fallback -eq $true -and $r.text.Length -gt 0) "reason=$($r.reason)"

  $r = Post-Ocr (@{ image = ($b64.Substring(0, 40)) } | ConvertTo-Json -Compress)
  Result "truncated base64 does not crash" ($null -ne $r) "reason=$($r.reason)"

  Add-Type -AssemblyName System.Drawing
  $blank = New-Object System.Drawing.Bitmap(700, 500)
  $bg = [System.Drawing.Graphics]::FromImage($blank)
  $bg.Clear([System.Drawing.Color]::White)
  $bg.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $blank.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $blankB64 = [System.Convert]::ToBase64String($ms.ToArray())
  $blank.Dispose(); $ms.Dispose()
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $r = Post-Ocr (@{ image = $blankB64; mimeType = "image/png" } | ConvertTo-Json -Compress)
  $sw.Stop()
  Result "blank photo says 'no text', not 'unavailable'" ($r -and $r.reason -eq "no_text_detected") "reason=$($r.reason) in $([math]::Round($sw.Elapsed.TotalSeconds,1))s"

  Write-Host ""
  Write-Host "=== 5. Static assets ===" -ForegroundColor Cyan
  $page = Invoke-WebRequest -Uri "http://localhost:3000/" -UseBasicParsing -TimeoutSec 30
  Result "home page loads" ($page.StatusCode -eq 200) "$($page.Content.Length) bytes"
  Result "compliance text present" ($page.Content -match "assistive document formatting tool") "required safety copy"
  $img = Invoke-WebRequest -Uri "http://localhost:3000/sample-page.png" -UseBasicParsing -TimeoutSec 30
  Result "sample failsafe image served" ($img.StatusCode -eq 200 -and $img.Headers["Content-Type"] -eq "image/png") "$($img.RawContentLength) bytes"

  Write-Host ""
  Write-Host "=== 6. Server-side log ===" -ForegroundColor Cyan
  $logLines = @(Get-Content $log | Select-String "auraread")
  Result "route emitted diagnostics" ($logLines.Count -ge 5) "$($logLines.Count) [auraread] lines"
  $errors = @(Get-Content $log | Select-String "unexpected failure")
  Result "no unhandled exceptions" ($errors.Count -eq 0) ""
}
finally {
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "=== RESULT: $pass passed, $fail failed ===" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Red" })
Write-Host ""
exit $(if ($fail -eq 0) { 0 } else { 1 })
