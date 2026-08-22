[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InputFile
)

Write-Host "Processing file: $InputFile"
if (!(Test-Path $InputFile)) {
  Write-Host "Input file does not exist: $InputFile"
  exit 1
}

$parentPath = Split-Path -Path $InputFile

Push-Location $parentPath
git add $InputFile
$diff = git diff --cached --quiet;
$diff
$hasChanges = $LASTEXITCODE -ne 0
Write-Host "Has changes: $hasChanges"
if ($hasChanges) {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  git commit -m "Auto backup: $timestamp"
}
Pop-Location
