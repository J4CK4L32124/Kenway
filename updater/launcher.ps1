# Kenway launcher + auto-updater
# ------------------------------------------------------------------
# The desktop shortcut points here, not at kenway.exe directly. On each
# start this:
#   1. asks GitHub for the latest release of the configured repo,
#   2. if it is newer than what's installed (or nothing is installed yet),
#      downloads the new kenway.exe + plugins and swaps them in,
#   3. launches kenway.exe.
# It never touches config/, data/ or auth_cache/, so a user's settings and
# Microsoft login survive every update. Any network/download failure is
# non-fatal: it just launches whatever is already installed.
# ------------------------------------------------------------------

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

$exePath = Join-Path $here 'kenway.exe'
$verPath = Join-Path $here 'version.json'
$cfgPath = Join-Path $here 'update.config.json'

function Read-Json($path) {
    try { return (Get-Content -Raw -Path $path | ConvertFrom-Json) } catch { return $null }
}

function Get-LocalVersion {
    $v = Read-Json $verPath
    if ($v -and $v.version) { return [string]$v.version }
    return '0.0.0'
}

# Returns 1 if a>b, -1 if a<b, 0 if equal. Numeric, dot-separated.
function Compare-Version($a, $b) {
    $pa = ($a -replace '^v', '').Split('.')
    $pb = ($b -replace '^v', '').Split('.')
    $n = [Math]::Max($pa.Count, $pb.Count)
    for ($i = 0; $i -lt $n; $i++) {
        $x = 0; $y = 0
        if ($i -lt $pa.Count) { [void][int]::TryParse($pa[$i], [ref]$x) }
        if ($i -lt $pb.Count) { [void][int]::TryParse($pb[$i], [ref]$y) }
        if ($x -gt $y) { return 1 }
        if ($x -lt $y) { return -1 }
    }
    return 0
}

function Download-File($url, $dest) {
    # Prefer BITS (shows progress, resilient for the big exe); fall back to WebClient.
    try {
        Import-Module BitsTransfer -ErrorAction Stop
        Start-BitsTransfer -Source $url -Destination $dest -ErrorAction Stop
        return
    } catch {
        $wc = New-Object System.Net.WebClient
        $wc.Headers.Add('User-Agent', 'Kenway-Launcher')
        $wc.DownloadFile($url, $dest)
    }
}

function Try-Update {
    $cfg = Read-Json $cfgPath
    if (-not $cfg -or -not $cfg.repo -or $cfg.repo -eq 'OWNER/REPO') {
        Write-Host 'Updater not configured (update.config.json repo), skipping update check.'
        return
    }
    $repo = $cfg.repo

    $latest = $null
    try {
        $headers = @{ 'User-Agent' = 'Kenway-Launcher'; 'Accept' = 'application/vnd.github+json' }
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $latest = Invoke-RestMethod -Headers $headers -TimeoutSec 15 `
            -Uri "https://api.github.com/repos/$repo/releases/latest"
    } catch {
        Write-Host 'Update check skipped (offline, or no release published yet).'
        return
    }

    $remote = [string]$latest.tag_name
    $local = Get-LocalVersion
    $haveExe = Test-Path $exePath
    if ($haveExe -and (Compare-Version $remote $local) -le 0) {
        Write-Host "Kenway is up to date (v$local)."
        return
    }

    # Map asset name -> download url.
    $assets = @{}
    foreach ($a in $latest.assets) { $assets[$a.name] = $a.browser_download_url }
    if (-not $assets.ContainsKey('kenway.exe') -or -not $assets.ContainsKey('plugins.zip')) {
        Write-Host 'Latest release is missing expected assets, skipping update.'
        return
    }

    Write-Host "Updating Kenway $local -> $($remote -replace '^v','') ..."
    $tmp = Join-Path $here ('.update-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp -Force | Out-Null
    try {
        $newExe = Join-Path $tmp 'kenway.exe'
        $newZip = Join-Path $tmp 'plugins.zip'
        Write-Host '  downloading core...'
        Download-File $assets['kenway.exe'] $newExe
        Write-Host '  downloading plugins...'
        Download-File $assets['plugins.zip'] $newZip

        if (-not (Test-Path $newExe) -or (Get-Item $newExe).Length -eq 0) { throw 'core download failed' }
        $newPlugins = Join-Path $tmp 'plugins'
        Expand-Archive -Path $newZip -DestinationPath $newPlugins -Force
        if (-not (Test-Path $newPlugins)) { throw 'plugins extract failed' }

        # Apply: swap exe (keeping a backup) and replace the plugins folder.
        if ($haveExe) {
            Copy-Item $exePath (Join-Path $here 'kenway-previous.exe') -Force
        }
        Move-Item $newExe $exePath -Force

        $pluginsDir = Join-Path $here 'plugins'
        if (Test-Path $pluginsDir) { Remove-Item $pluginsDir -Recurse -Force }
        Move-Item $newPlugins $pluginsDir -Force

        # Launcher can self-update (a script isn't file-locked while running);
        # takes effect next launch.
        if ($assets.ContainsKey('launcher.ps1')) {
            try { Download-File $assets['launcher.ps1'] (Join-Path $here 'launcher.ps1') } catch {}
        }

        @{ version = ($remote -replace '^v', '') } | ConvertTo-Json | Set-Content $verPath
        Write-Host 'Update complete.'
    } catch {
        Write-Host "Update failed ($($_.Exception.Message)); launching the current version."
    } finally {
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Try-Update

if (-not (Test-Path $exePath)) {
    Write-Host ''
    Write-Host 'Kenway is not installed and could not be downloaded.' -ForegroundColor Red
    Write-Host 'Check your internet connection and that a release has been published, then try again.'
    Read-Host 'Press Enter to exit'
    exit 1
}

# Hand over to the proxy (shares this console window).
& $exePath
exit $LASTEXITCODE
