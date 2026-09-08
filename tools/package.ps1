<#
.SYNOPSIS
  Build and validate a Chrome extension release ZIP from the current Git HEAD.

.DESCRIPTION
  The archive intentionally includes runtime files only: manifest.json, src/, assets/, pet/, docs/, README.md, and scripts/Configure-Ornith.ps1.
  It also verifies every manifest resource, including wildcard resource paths.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\package.ps1
#>
[CmdletBinding()]
param(
  [switch]$AllowDirty
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  $dirty = git status --porcelain
  if ($dirty -and -not $AllowDirty) {
    throw 'Working tree is not clean. Commit the release first, then run this script.'
  }

  $manifestPath = Join-Path $root 'manifest.json'
  $manifestText = [System.IO.File]::ReadAllText($manifestPath, [System.Text.Encoding]::UTF8)
  $manifest = $manifestText | ConvertFrom-Json
  $version = $manifest.version

  $distDir = Join-Path $root 'dist'
  $zipPath = Join-Path $distDir ("halo-psa-extension-" + $version + ".zip")
  if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }
  if (Test-Path $zipPath) { Remove-Item -LiteralPath $zipPath -Force }

  git archive --format=zip --output=$zipPath HEAD manifest.json src assets pet scripts/Configure-Ornith.ps1 README.md docs
  if ($LASTEXITCODE -ne 0) { throw 'git archive failed.' }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    $entries = @($zip.Entries |
      Where-Object { -not $_.FullName.EndsWith('/') } |
      ForEach-Object { $_.FullName })
  } finally {
    $zip.Dispose()
  }

  $unexpected = @($entries | Where-Object {
    $_ -ne 'manifest.json' -and
    $_ -ne 'scripts/Configure-Ornith.ps1' -and
    $_ -ne 'README.md' -and
    -not $_.StartsWith('docs/') -and
    -not $_.StartsWith('src/') -and
    -not $_.StartsWith('assets/') -and
    -not $_.StartsWith('pet/')
  })
  if ($unexpected.Count -gt 0) {
    Remove-Item -LiteralPath $zipPath -Force
    throw ('Release archive contains non-runtime files: ' + ($unexpected -join ', '))
  }

  $references = New-Object System.Collections.Generic.List[string]
  $references.Add($manifest.background.service_worker)
  $references.Add($manifest.options_ui.page)
  $manifest.icons.PSObject.Properties | ForEach-Object { $references.Add($_.Value) }
  if ($manifest.action.PSObject.Properties.Name -contains 'default_icon') {
    $manifest.action.default_icon.PSObject.Properties | ForEach-Object { $references.Add($_.Value) }
  }
  foreach ($contentScript in $manifest.content_scripts) {
    if ($contentScript.PSObject.Properties.Name -contains 'js') {
      $contentScript.js | ForEach-Object { $references.Add($_) }
    }
    if ($contentScript.PSObject.Properties.Name -contains 'css') {
      $contentScript.css | ForEach-Object { $references.Add($_) }
    }
  }
  foreach ($resourceSet in $manifest.web_accessible_resources) {
    $resourceSet.resources | ForEach-Object { $references.Add($_) }
  }

  $missing = @($references | Sort-Object -Unique | Where-Object {
    $reference = $_
    if ($reference.Contains('*')) {
      $prefix = $reference.Substring(0, $reference.IndexOf('*'))
      return (@($entries | Where-Object { $_.StartsWith($prefix) }).Count -eq 0)
    }
    return -not ($entries -contains $reference)
  })
  if ($missing.Count -gt 0) {
    Remove-Item -LiteralPath $zipPath -Force
    throw ('Manifest resources missing from archive: ' + ($missing -join ', '))
  }

  $sizeMb = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1MB, 2)
  $hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Host ('Built ' + $zipPath)
  Write-Host ('Version: ' + $version + '; files: ' + $entries.Count + '; size: ' + $sizeMb + ' MB')
  Write-Host ('SHA256: ' + $hash)
} finally {
  Pop-Location
}
