param(
  [string]$Python = 'python'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$requirements = Join-Path $repoRoot 'resources/local-monitor/python/requirements.txt'
$detectorScript = Join-Path $repoRoot 'resources/local-monitor/python/detector.py'
$buildRoot = Join-Path $repoRoot 'build/local-monitor'
$venvPython = Join-Path $buildRoot 'venv/Scripts/python.exe'
$runtimeDir = Join-Path $repoRoot 'resources/local-monitor/runtime'

if (-not (Test-Path $requirements)) { throw "Missing Python requirements: $requirements" }
if (-not (Test-Path $detectorScript)) { throw "Missing detector script: $detectorScript" }

New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
if (-not (Test-Path $venvPython)) {
  & $Python -m venv (Join-Path $buildRoot 'venv')
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the Local Monitor build virtual environment' }
}

& $venvPython -m pip install --disable-pip-version-check --upgrade -r $requirements pyinstaller
if ($LASTEXITCODE -ne 0) { throw 'Could not install Local Monitor build dependencies' }

if (Test-Path $runtimeDir) {
  Remove-Item -LiteralPath $runtimeDir -Recurse -Force
}
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

& $venvPython -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --console `
  --name detector `
  --distpath $runtimeDir `
  --workpath (Join-Path $buildRoot 'work') `
  --specpath $buildRoot `
  --collect-all cv2 `
  $detectorScript
if ($LASTEXITCODE -ne 0) { throw 'Could not package the Local Monitor detector' }

$bundledDetector = Join-Path $runtimeDir 'detector.exe'
if (-not (Test-Path $bundledDetector)) { throw 'PyInstaller did not produce detector.exe' }
Write-Output "Bundled Local Monitor runtime: $bundledDetector"
