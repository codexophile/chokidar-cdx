[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InputFile,
  [string]$MoveToFilePath,
  [switch]$ProcessJson = $false
)

. C:\mega\IDEs\powershell\#lib\functions.ps1

Write-Host "Processing file: $InputFile"
if (!(Test-Path $InputFile)) {
  Write-Host "Input file does not exist: $InputFile"
  exit 1
}

$TargetFileContent = $null
$WorkingFile = $null

# handle -u -nobanner $InputFile

if ($ProcessJson) {
  Write-Host 'Processing JSON data ...'
  $RawData = Get-Content $InputFile -Raw
  Write-Host "Raw data length: $($RawData.Length)"
  $JsonData = $RawData | ConvertFrom-Json -AsHashtable
  $TargetFileContent = $JsonData | ConvertTo-Json -Depth 100
}

if (!$TargetFileContent) {
  Write-Error 'No content to write to target file. Exiting.'
  exit 1
}

if ($MoveToFilePath) {
  Write-Host "Moving file to: $MoveToFilePath"
  try {
    Set-Content -Path $MoveToFilePath -Value $TargetFileContent -Encoding utf8
  }
  catch {
    Write-Error 'Failed to write to'
    Write-Error $MoveToFilePath
    Write-Error $_
    exit 1
  }
  $NextLocation = (Split-Path -Path $MoveToFilePath -Parent)
  $WorkingFile = $MoveToFilePath
}
else {
  $NextLocation = (Split-Path -Path $InputFile -Parent)
  $WorkingFile = $InputFile
}

Write-Host "Setting location to: $NextLocation"
Set-Location -Path $NextLocation

if (!(Test-Path $WorkingFile)) {
  Write-Error "Working file does not exist: $WorkingFile"
  exit 1
}

git add $WorkingFile
$diff = git diff --cached --quiet
$diff
$hasChanges = $LASTEXITCODE -ne 0
Write-Host "`nHas changes: $hasChanges`n"
if ($hasChanges) {
  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  $CommitMessage = "Auto backup: $timestamp"
  Write-Host "Committing with message: $CommitMessage" -ForegroundColor DarkGreen
  git commit -m $CommitMessage
  Invoke-Git-Sync
}
Pop-Location
