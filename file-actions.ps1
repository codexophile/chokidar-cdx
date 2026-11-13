[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InputFile,
  [Parameter(Mandatory = $true)]
  [Alias('Action')]
  [ValidateSet('Rename', 'Delete')]
  [string]$Operation,
  [ValidateSet('Self', 'Siblings')]
  [string]$ActOnWhom 
)
  
. C:\mega\IDEs\powershell\#lib\functions.ps1
Write-Host "Processing file: $InputFile"

if (!(Test-Path (Split-Path -Parent $InputFile) -PathType Container)) {
  Write-Host "Input file directory does not exist: $(Split-Path -Parent $InputFile)"
  exit 1
}

if ($ActOnWhom -eq 'Self') {
  $FilesToProcess = @($InputFile)
}
elseif ($ActOnWhom -eq 'Siblings') {
  $FilesToProcess = Get-SiblingFiles -Path $InputFile
  if ($FilesToProcess.Count -eq 0) {
    Write-Host "No sibling files found for: $InputFile"
    exit 1
  }
}

foreach ($File in $FilesToProcess) {
  Write-Host "Processing file: $File"
  if ($Operation -eq 'Rename') {
    $NewFileName = Rename-File -FilePath $File
    Write-Host "Renamed $File to $NewFileName"
  }
  elseif ($Operation -eq 'Delete') {
    Move-ToRecycleBin -Path $File -ErrorAction Stop
    if ($?) {
      Write-Host "Moved file to Recycle Bin: $File"
    }
    else {
      Write-Host "Failed to move file to Recycle Bin: $File"
    }
  }
}