[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InputFile
)
  
. C:\mega\IDEs\powershell\#lib\functions.ps1

Write-Host "Processing file: $InputFile"
if (!(Test-Path $InputFile)) {
  Write-Host "Input file does not exist: $InputFile"
  exit 1
}

$FileExtension = Split-Path -Path $InputFile -Extension
if ($FileExtension -eq ".json") {
  Write-Host "Processing JSON data ..."
  $RawData = Get-Content $InputFile -Raw
  $JsonData = $RawData | ConvertFrom-Json -AsHashtable
  $JsonDataText = $JsonData | ConvertTo-Json -Depth 100
  $JsonDataText | Set-Content $InputFile -Encoding utf8
}

$parentPath = Split-Path -Path $InputFile
Push-Location $parentPath
git add $InputFile
$diff = git diff --cached --quiet
$diff
$hasChanges = $LASTEXITCODE -ne 0
Write-Host "`nHas changes: $hasChanges`n"
if ($hasChanges) {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $CommitMessage = "Auto backup: $timestamp"
  Write-Host "Committing with message: $CommitMessage" -ForegroundColor DarkGreen
  git commit -m $CommitMessage
  Invoke-Git-Sync
}
Pop-Location
