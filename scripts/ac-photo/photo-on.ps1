# Switches Assetto Corsa to the photo preset. Backs up what it replaces; photo-off.ps1 undoes it.
$ErrorActionPreference = 'Stop'
if (Get-Process acs, AssettoCorsa -ErrorAction SilentlyContinue) { throw 'Close Assetto Corsa first.' }
$cfg  = Join-Path $env:USERPROFILE 'Documents\Assetto Corsa\cfg'
$ext  = Join-Path $cfg 'extension'
$back = Join-Path $cfg '_photo-backup'
if (Test-Path $back) { throw "Already on (backup exists at $back). Run photo-off.ps1 first." }
New-Item -ItemType Directory -Force $back | Out-Null
$missing = @()
foreach ($f in Get-ChildItem (Join-Path $PSScriptRoot 'preset') -Filter *.ini) {
  $dest = Join-Path $ext $f.Name
  if (Test-Path $dest) { Copy-Item $dest (Join-Path $back $f.Name) } else { $missing += $f.Name }
  Copy-Item $f.FullName $dest -Force
}
$missing | Set-Content (Join-Path $back '_new-files.txt')
$v = Join-Path $cfg 'video.ini'
Copy-Item $v (Join-Path $back 'video.ini')
$t = Get-Content $v -Raw
$t = $t -replace '(?m)^FILTER=.*$', 'FILTER=EXQUISITE - SOL' -replace '(?m)^AASAMPLES=.*$', 'AASAMPLES=8'
Set-Content $v $t -NoNewline
Write-Host 'Photo preset on. In Content Manager pick the Sol weather controller. Run photo-off.ps1 when done.'
