[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InputFile,
  [Parameter(Mandatory = $true)]
  [Alias("Action")]
  [ValidateSet("Rename", "Delete")]
  [string]$Operation
)
  
. C:\mega\IDEs\powershell\#lib\functions.ps1
Write-Host "Processing file: $InputFile"

if (!(Test-Path (Split-Path -Parent $InputFile) -PathType Container)) {
  Write-Host "Input file directory does not exist: $(Split-Path -Parent $InputFile)"
  exit 1
}

$SiblingFiles = Get-SiblingFiles -Path $InputFile
foreach ($SiblingFile in $SiblingFiles) {
  Write-Host "Processing sibling file: $SiblingFile"
  if ($Operation -eq "Rename") {
    $NewFileName = Rename-File -FilePath $SiblingFile
    Write-Host "Renamed $SiblingFile to $NewFileName"
  }
  elseif ($Operation -eq "Delete") {
    Move-ToRecycleBin -Path $SiblingFile
    Write-Host "Moved sibling file to Recycle Bin: $SiblingFile"
  }
}