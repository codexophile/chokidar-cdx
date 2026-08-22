[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InputFile
)

Write-Host "Processing file: $InputFile"