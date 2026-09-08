# Configures one exact HTTPS host in a local extension manifest. No network or credentials are used.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Origin,
    [string]$ExtensionPath = (Join-Path $PSScriptRoot '..')
)

$ErrorActionPreference = 'Stop'
$parsedOrigin = $null
if (-not [Uri]::TryCreate($Origin, [UriKind]::Absolute, [ref]$parsedOrigin) -or
    $parsedOrigin.Scheme -ne 'https' -or
    -not $parsedOrigin.IsDefaultPort -or
    [string]::IsNullOrWhiteSpace($parsedOrigin.Host) -or
    $parsedOrigin.Host.Contains('*') -or
    $parsedOrigin.HostNameType -eq [UriHostNameType]::IPv6 -or
    $parsedOrigin.AbsolutePath -ne '/' -or
    $parsedOrigin.UserInfo -or $parsedOrigin.Query -or $parsedOrigin.Fragment -or
    $Origin.Contains('\')) {
    throw 'Origin must be a plain HTTPS origin using port 443, with no path, wildcard, credentials, query, or fragment.'
}

$extensionRoot = (Resolve-Path -LiteralPath $ExtensionPath).Path
$manifestPath = Join-Path $extensionRoot 'manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.manifest_version -ne 3 -or $manifest.background.service_worker -ne 'src/background/service-worker.js') {
    throw 'The selected directory is not a supported Halo Companion extension.'
}

$azurePermission = 'https://*.openai.azure.com/*'
$oldHosts = @($manifest.host_permissions)
$otherHosts = @($oldHosts | Where-Object { $_ -ne $azurePermission })
if ($oldHosts.Count -ne 2 -or $otherHosts.Count -ne 1 -or $azurePermission -notin $oldHosts) {
    throw 'Unexpected host permissions. Review manifest.json before configuring an Ornith host.'
}

$normalizedOrigin = $parsedOrigin.GetLeftPart([UriPartial]::Authority)
if ($normalizedOrigin -like '*.openai.azure.com') {
    throw 'Use the Azure provider for Azure OpenAI endpoints.'
}
$manifest.host_permissions = @($azurePermission, ($normalizedOrigin + '/*'))
$json = ($manifest | ConvertTo-Json -Depth 30) + [Environment]::NewLine
[IO.File]::WriteAllText($manifestPath, $json, (New-Object Text.UTF8Encoding($false)))
Write-Output 'Configured one Ornith host. Reload the extension, then enter this Base URL in its AI settings:'
Write-Output ($normalizedOrigin + '/v1')
Write-Output 'Browser settings and API keys were not changed.'
