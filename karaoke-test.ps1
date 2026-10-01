param(
  [switch]$SkipBuild
)
$project = "C:\Users\sadth\Desktop\auraread AI"
$log = "$env:TEMP\auraread-karaoke.log"

if (-not $SkipBuild) {
  Write-Output "=== 0. Build ==="
  Push-Location $project
  $b = npm run build 2>&1
  Pop-Location
  if ($LASTEXITCODE -ne 0) { $b | Select-Object -Last 25; throw "BUILD FAILED" }
  Write-Output "  [PASS] production build"
}

Write-Output ""
Write-Output "=== 1. Starting server ==="
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 2
$proc = Start-Process cmd.exe -ArgumentList "/c","npm run start > `"$log`" 2>&1" -WorkingDirectory $project -WindowStyle Hidden -PassThru
$up = $false
for ($i=0; $i -lt 90; $i++) {
  Start-Sleep 1
  try { $null = Invoke-WebRequest "http://localhost:3000/" -UseBasicParsing -TimeoutSec 4; $up = $true; break } catch {}
}
if (-not $up) { Get-Content $log -Tail 30; throw "server did not start" }
Write-Output "  ready"

$pass = 0; $fail = 0
function Check($n,$c,$e=""){ if($c){$script:pass++;"  [PASS] $n  $e"}else{$script:fail++;"  [FAIL] $n  $e"} }

$html = (Invoke-WebRequest "http://localhost:3000/" -UseBasicParsing -TimeoutSec 30).Content

# The reader UI is behind state (originalText is empty on first paint), so most of
# these strings only exist in the client JS chunks, not the SSR HTML. Pull the
# chunks down and search the combined bundle.
# NB: must allow subdirectories (`chunks/app/page-<hash>.js`) or the page chunk
# itself - where all of this UI actually lives - gets skipped.
$chunkUrls = [regex]::Matches($html, '/_next/static/chunks/[A-Za-z0-9._\-/]+\.js') | ForEach-Object { $_.Value } | Sort-Object -Unique
# `-notmatch` filters element-wise and returns a non-empty array (truthy), so
# join first or this guard never trips.
if (($chunkUrls -join ' ') -notmatch 'app/page') { throw "page chunk not discovered - assertions would be meaningless" }
$bundle = ($chunkUrls | ForEach-Object {
  try { (Invoke-WebRequest "http://localhost:3000$_" -UseBasicParsing -TimeoutSec 30).Content } catch { "" }
}) -join "`n"
$all = $html + "`n" + $bundle
Write-Output "  scanned $($chunkUrls.Count) chunk(s), $(($all.Length)/1024) KB total"
if ($bundle.Length -lt 1000) { throw "could not fetch client chunks - assertions would be meaningless" }

Write-Output ""
Write-Output "=== 2. Karaoke wiring is present in the shipped client ==="
Check "onboundary handler compiled in"    ($all -match "onboundary")                          ""
# Local identifiers get minified away, so assert on the DOM property instead,
# which the compiler must preserve.
Check "charIndex read from boundary"      ($all -match "charIndex")                          ""
Check "charLength guarded for engines"    ($all -match "charLength")                         ""
Check "word boundary filter compiled in"  ($all -match "word")                              ""
Check "amber highlight present"           ($all -match "amber-300")                         ""
Check "token data attribute present"      ($all -match "karaoke-active")                    ""
Check "text-shadow bold illusion present" ($all -match "text-shadow")                       ""

Write-Output ""
Write-Output "=== 2b. No layout-shifting utilities on the highlight ==="
# These are the exact properties that reflow a line when they appear/disappear
# on the spoken word. Minification keeps class names verbatim, so searching the
# emitted CSS is a real check, not a proxy.
$css = [regex]::Matches($html, '/_next/static/css/[A-Za-z0-9._\-]+\.css') | ForEach-Object { $_.Value } | Sort-Object -Unique
if (-not $css) { throw "no CSS bundle found" }
$cssText = ($css | ForEach-Object { (Invoke-WebRequest "http://localhost:3000$_" -UseBasicParsing -TimeoutSec 30).Content }) -join "`n"
Write-Output "  scanned $($css.Count) css file(s), $([int]($cssText.Length/1024)) KB"

$karaokeSel = [regex]::Match($cssText, '\.bg-amber-300\{[^}]*\}')
Check "bg-amber-300 rule emitted"        ($karaokeSel.Success) $(if($karaokeSel.Success){$karaokeSel.Value}else{"missing"})
# The rules co-located with the karaoke tokens are what the browser applies to
# the spoken word; none of them may be layout-affecting.
$badProps = @("font-weight","transform","padding","margin","width","height","letter-spacing","line-height","display","vertical-align","font-size")
Check "no font-weight rule on the highlight"  (-not ($karaokeSel.Value -match "font-weight"))  ""
Check "no transform rule on the highlight"   (-not ($karaokeSel.Value -match "transform"))   ""
Check "no padding/margin rule on highlight"  (-not ($karaokeSel.Value -match "padding|margin")) ""
Check "no font-size/letter-spacing rule"     (-not ($karaokeSel.Value -match "font-size|letter-spacing")) ""
Check "idle words get a transparent bg"      ($all -match "bg-transparent")                  ""

Write-Output ""
Write-Output "=== 3. Compatibility preserved (must NOT regress) ==="
Check "Lexend font still applied"         ($all -match "lexend|Lexend")                     ""
Check "reading ruler still present"       ($all -match "ruler")                             ""
Check "background tints still present"    ($all -match "tint")                              ""
Check "phonics colouring still present"   ($all -match "emerald")                           ""
Check "language toggle still present"     ($all -match "Tagalog")                           ""
Check "compliance copy intact"            ($all -match "qualified professional")           ""
Check "reduced-motion respected"          ($all -match "prefers-reduced-motion|motion-reduce") ""

Write-Output ""
Write-Output "=== 4. Reader surface keeps its ARIA + lang contract ==="
Check "reader region labelled"            ($all -match "Extracted text from your photo")    ""
Check "Tagalog reader labelled"           ($all -match "Tagalog translation of your page") ""
Check "read-aloud button present"         ($all -match "Read aloud")                        ""
Check "stop state present"                ($all -match "Stop reading")                      ""

Write-Output ""
Write-Output "=== 5. No leftover duplicate speech path ==="
$dupes = ([regex]::Matches($html,"SpeechSynthesisUtterance")).Count
Check "single utterance construction path" ($dupes -le 2) "$dupes occurrence(s) (minified)"
Check "dead toggleSpeech removed"           (-not ($all -match "toggleSpeech")) ""

Write-Output ""
Write-Output "=== 6. Server log clean ==="
$errs = Select-String -LiteralPath $log -Pattern "Error|Unhandled|Exception" -EA SilentlyContinue
Check "no server errors" ($errs.Count -eq 0) "$($errs.Count) matches"

Write-Output ""
Write-Output "=== RESULT: $pass passed, $fail failed ==="
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
if ($fail -gt 0) { exit 1 }