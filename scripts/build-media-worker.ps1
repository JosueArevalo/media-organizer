$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$workerRoot = Join-Path $repoRoot 'scripts\media_tools'
$outputRoot = Join-Path $repoRoot 'build\worker\win-x64'
$workRoot = Join-Path $repoRoot 'build\pyinstaller'

python -m pip install --disable-pip-version-check -r (Join-Path $workerRoot 'requirements-build.txt')
python -m PyInstaller `
  --noconfirm `
  --clean `
  --onedir `
  --name media-organizer-worker `
  --distpath $outputRoot `
  --workpath $workRoot `
  --specpath $workRoot `
  --paths $workerRoot `
  (Join-Path $workerRoot 'media_organizer_worker.py')

$pythonRoot = python -c "import sys; print(sys.base_prefix)"
$pythonLicense = Join-Path $pythonRoot 'LICENSE.txt'
$workerOutput = Join-Path $outputRoot 'media-organizer-worker'
if (Test-Path $pythonLicense) {
  Copy-Item -LiteralPath $pythonLicense -Destination (Join-Path $workerOutput 'PYTHON_LICENSE.txt') -Force
}
Copy-Item -LiteralPath (Join-Path $repoRoot 'THIRD_PARTY_NOTICES.md') -Destination $workerOutput -Force
