<#
.SYNOPSIS
  Builds TimeTrial and gathers everything you would want to copy to another PC into ./dist.

.DESCRIPTION
  1. runs the tests,
  2. builds the release app (and the installer),
  3. copies the results into ./dist with clear names: the installer, the standalone exe,
     a zip of the standalone exe + README, a README and SHA256 checksums.

.PARAMETER SkipInstaller
  Build only the standalone exe (much quicker; no installer tooling needed).

.PARAMETER SkipTests
  Don't run the tests first.

.EXAMPLE
  .\scripts\build.ps1
  .\scripts\build.ps1 -SkipInstaller
#>
param(
    [switch]$SkipInstaller,
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($message) { Write-Host "`n==> $message" -ForegroundColor Cyan }
# Runs a command-line tool and fails the script if it fails. Windows PowerShell 5.1 treats a tool's normal
# progress output on stderr as an error when output is redirected, so errors are only judged by exit code.
function Run($what, [scriptblock]$command) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $command } finally { $ErrorActionPreference = $previous }
    if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)." }
}

foreach ($tool in 'node', 'npm', 'cargo') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool isn't installed or isn't on PATH." }
}

# The version comes from one place: [workspace.package] in Cargo.toml.
$version = (Select-String -Path (Join-Path $root 'Cargo.toml') -Pattern '^version\s*=\s*"([^"]+)"').Matches[0].Groups[1].Value
Write-Host "Packaging TimeTrial $version" -ForegroundColor Green

$app = Join-Path $root 'app'
if (-not (Test-Path (Join-Path $app 'node_modules'))) {
    Step 'Installing web dependencies'
    Push-Location $app
    try { Run 'npm ci' { npm ci } } finally { Pop-Location }
}

if (-not $SkipTests) {
    Step 'Running tests'
    Run 'The tests' { cargo test --workspace --quiet }
}

Step ($(if ($SkipInstaller) { 'Building the standalone exe' } else { 'Building the app and installer (the first installer build downloads the NSIS tooling)' }))
$started = Get-Date
Push-Location $app
try {
    if ($SkipInstaller) { Run 'The build' { npm run tauri build -- --no-bundle } } else { Run 'The build' { npm run tauri build } }
} finally { Pop-Location }

# The build number the exe was just compiled with (app/src-tauri/build.rs keeps the counter).
$buildFile = Join-Path $root '.build-number'
if (-not (Test-Path $buildFile)) { throw "$buildFile is missing, so the build number is unknown." }
$build = (Get-Content $buildFile -Raw).Trim()
# Files are named version + build, so two copies of the app can be told apart at a glance.
$tag = "$version-b$build"
Write-Host "Build number: $build" -ForegroundColor Green

Step 'Collecting files into dist'
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
# Start clean so old versions don't pile up next to the new one.
Get-ChildItem $dist -Force | Remove-Item -Recurse -Force

$exe = Join-Path $root 'target\release\timetrial.exe'
if (-not (Test-Path $exe)) { throw "The build didn't produce $exe" }
if ((Get-Item $exe).LastWriteTime -lt $started) { throw "$exe wasn't rebuilt, so it isn't from this run." }

$portable = Join-Path $dist "TimeTrial-$tag-portable.exe"
Copy-Item $exe $portable

$installer = $null
if (-not $SkipInstaller) {
    $found = Get-ChildItem (Join-Path $root 'target\release\bundle\nsis') -Filter '*-setup.exe' -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -ge $started } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $found) { throw "The build didn't produce an installer. Re-run with -SkipInstaller to get just the standalone exe." }
    $installer = Join-Path $dist "TimeTrial-$tag-setup.exe"
    Copy-Item $found.FullName $installer
}

# README, with this build's version filled in.
$readme = (Get-Content (Join-Path $PSScriptRoot 'dist-readme.txt') -Raw -Encoding UTF8).
    Replace('{{VERSION}}', $tag).
    Replace('{{DATE}}', (Get-Date -Format 'd MMMM yyyy')).
    Replace('{{INSTALLER}}', $(if ($installer) { "TimeTrial-$tag-setup.exe" } else { '(not built this time)' }))
Set-Content -Path (Join-Path $dist 'README.txt') -Value $readme -Encoding UTF8

# One folder with the exe and the README, zipped: the easiest thing to carry on a USB stick or send.
$stage = Join-Path $dist "TimeTrial-$tag"
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item $exe (Join-Path $stage 'TimeTrial.exe')
Copy-Item (Join-Path $dist 'README.txt') (Join-Path $stage 'README.txt')
Compress-Archive -Path $stage -DestinationPath (Join-Path $dist "TimeTrial-$tag-portable.zip") -Force
Remove-Item $stage -Recurse -Force

# Checksums, so a copy can be verified at the other end.
$lines = Get-ChildItem $dist -File | Where-Object { $_.Name -ne 'SHA256SUMS.txt' } | ForEach-Object {
    '{0}  {1}' -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower(), $_.Name
}
Set-Content -Path (Join-Path $dist 'SHA256SUMS.txt') -Value $lines -Encoding ASCII

Step 'Done'
Get-ChildItem $dist -File | ForEach-Object { '{0,-40} {1,8:N1} MB' -f $_.Name, ($_.Length / 1MB) }
Write-Host "`nEverything is in: $dist" -ForegroundColor Green
