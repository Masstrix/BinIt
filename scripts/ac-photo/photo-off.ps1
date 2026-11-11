# Restores the settings saved by photo-on.ps1.
$ErrorActionPreference = 'Stop'
if (Get-Process acs, AssettoCorsa -ErrorAction SilentlyContinue) { throw 'Close Assetto Corsa first.' }
$cfg  = Join-Path $env:USERPROFILE 'Documents\Assetto Corsa\cfg'
$ext  = Join-Path $cfg 'extension'
$back = Join-Path $cfg '_photo-backup'
if (-not (Test-Path $back)) { throw 'Nothing to restore (no backup found).' }
foreach ($n in Get-Content (Join-Path $back '_new-files.txt') -ErrorAction SilentlyContinue) { if ($n) { Remove-Item (Join-Path $ext $n) -ErrorAction SilentlyContinue } }
foreach ($f in Get-ChildItem $back -Filter *.ini) {
  $dest = if ($f.Name -eq 'video.ini') { Join-Path $cfg 'video.ini' } else { Join-Path $ext $f.Name }
  Copy-Item $f.FullName $dest -Force
}
Remove-Item $back -Recurse -Force
Write-Host 'Back to your normal settings.'
