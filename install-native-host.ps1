<#
.SYNOPSIS
  Connects the ScamShield browser extension to the ScamShield desktop dashboard (Chrome and Edge).

.DESCRIPTION
  Registers native-host\scamshield-host.bat as a Chrome/Edge "native messaging host" for the current
  Windows user only (HKCU, no administrator rights needed). Only the ScamShield extension may start it.
  Run it once after building the JAR. Run it again if you move the project folder.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install-native-host.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install-native-host.ps1 -Uninstall
.EXAMPLE
  # After publishing to the Chrome Web Store, allow the store's extension ID as well:
  powershell -ExecutionPolicy Bypass -File scripts\install-native-host.ps1 -ExtensionId abcdefghijklmnopabcdefghijklmnop
#>
param(
    # ID of the unpacked extension, fixed by the "key" in chrome-extension\manifest.json.
    [string[]]$ExtensionId = @('bokllmmcjdifohieaphakkifcbmlpope'),
    [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$hostName = 'com.scamshield.dashboard'
$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $root 'native-host\scamshield-host.bat'
$manifest = Join-Path $root "native-host\$hostName.json"
$registryKeys = @(
    "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName",
    "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName"
)

if ($Uninstall) {
    foreach ($key in $registryKeys) {
        if (Test-Path $key) { Remove-Item $key -Recurse -Force; Write-Host "Removed $key" }
    }
    if (Test-Path $manifest) { Remove-Item $manifest -Force }
    Write-Host 'The browser extension is no longer connected to the desktop dashboard.'
    exit 0
}

if (-not (Test-Path (Join-Path $root 'target\scamshield-1.1.0.jar'))) {
    Write-Error 'target\scamshield-1.1.0.jar is missing. Build the desktop app first (mvn package).'
}
foreach ($id in $ExtensionId) {
    if ($id -notmatch '^[a-p]{32}$') { Write-Error "'$id' is not a valid extension ID (32 letters a-p)." }
}

# Chrome rejects a host manifest that starts with a byte-order mark, so write UTF-8 without one.
$json = [ordered]@{
    name            = $hostName
    description     = 'ScamShield desktop dashboard'
    path            = $launcher
    type            = 'stdio'
    allowed_origins = @($ExtensionId | ForEach-Object { "chrome-extension://$_/" })
} | ConvertTo-Json
[System.IO.File]::WriteAllText($manifest, $json, (New-Object System.Text.UTF8Encoding($false)))

foreach ($key in $registryKeys) {
    New-Item -Path $key -Force | Out-Null
    Set-Item -Path $key -Value $manifest
    Write-Host "Registered $key"
}
Write-Host ''
Write-Host 'Done. In the extension, open Settings > Desktop dashboard and switch it on.'
Write-Host "Browser activity will be stored in $env:LOCALAPPDATA\ScamShield (summaries only, never message text)."
