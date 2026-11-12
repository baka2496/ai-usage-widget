# 讀取 Antigravity CLI (agy) 和 Claude Code CLI 的額度，上傳到私密 Gist 給 iPhone 小工具讀取。
# 由「工作排程器」每 15 分鐘執行一次（透過 run-hidden.vbs，不會跳出視窗）。
# `agy -p /usage` 和 `claude -p /usage` 都是內建指令，不會呼叫模型、不花 token。

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$logFile = Join-Path $here 'push.log'

function Write-Log($msg) {
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Add-Content -Path $logFile -Value $line -Encoding UTF8
    $all = @(Get-Content $logFile -Encoding UTF8)
    if ($all.Count -gt 300) { $all[-300..-1] | Set-Content $logFile -Encoding UTF8 }
}

# 在背景工作中執行 CLI 的 /usage，最多等 90 秒，回傳解析後的 JSON
function Invoke-Usage($exe, $dir) {
    $job = Start-Job -ScriptBlock {
        param($dir, $exe)
        [Console]::OutputEncoding = [Text.Encoding]::UTF8
        Set-Location $dir
        $env:AGY_CLI_DISABLE_AUTO_UPDATE = 'true'
        $env:DISABLE_AUTOUPDATER = '1'
        & $exe -p '/usage' --output-format json 2>$null | Out-String
    } -ArgumentList $dir, $exe
    if (-not (Wait-Job $job -Timeout 90)) {
        Stop-Job $job; Remove-Job $job -Force
        throw "$([IO.Path]::GetFileName($exe)) 超過 90 秒沒有回應"
    }
    $raw = Receive-Job $job
    Remove-Job $job -Force
    try { return ($raw | ConvertFrom-Json) } catch { throw ('輸出不是 JSON：' + $raw.Substring(0, [Math]::Min(200, $raw.Length))) }
}

# ---------- Antigravity ----------
function Get-AgyUsage($cfg, $dir) {
    $j = Invoke-Usage $cfg.agy_path $dir
    if ($j.status -ne 'SUCCESS' -or $j.command.name -ne 'usage' -or -not $j.command.data.groups) {
        throw 'agy 回傳格式不對（在終端機執行 agy 重新登入）'
    }
    $groups = @()
    foreach ($g in $j.command.data.groups) {
        $buckets = @()
        foreach ($b in $g.buckets) {
            $buckets += [ordered]@{
                id        = [string]$b.id
                window    = [string]$b.window
                remaining = [double]$b.remaining_fraction
                reset     = [string]$b.reset_time
            }
        }
        $groups += [ordered]@{ name = [string]$g.name; buckets = $buckets }
    }
    return , $groups
}

# ---------- Claude ----------
$months = @{ Jan=1; Feb=2; Mar=3; Apr=4; May=5; Jun=6; Jul=7; Aug=8; Sep=9; Oct=10; Nov=11; Dec=12 }

# "Nov 10, 10:30pm" + "Etc/GMT-8" → ISO UTC 字串
function Convert-ClaudeReset($text, $tz) {
    if ($text -notmatch '^([A-Z][a-z]{2}) (\d{1,2}),? (\d{1,2})(?::(\d{2}))?\s*(am|pm)$') { return $null }
    $mon = $months[$Matches[1]]; if (-not $mon) { return $null }
    $day = [int]$Matches[2]; $h = [int]$Matches[3] % 12; if ($Matches[5] -eq 'pm') { $h += 12 }
    $min = if ($Matches[4]) { [int]$Matches[4] } else { 0 }
    if ($tz -match '^Etc/GMT([+-])(\d{1,2})$') {
        # Etc/GMT-8 代表 UTC+8（符號相反）
        $offset = [TimeSpan]::FromHours([int]$Matches[2] * $(if ($Matches[1] -eq '-') { 1 } else { -1 }))
    } else {
        $offset = [TimeZoneInfo]::Local.BaseUtcOffset
    }
    $now = [DateTimeOffset]::UtcNow
    $dt = New-Object DateTimeOffset ($now.Year, $mon, $day, $h, $min, 0, $offset)
    if ($dt -lt $now.AddDays(-2)) { $dt = $dt.AddYears(1) }
    return $dt.UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ssZ')
}

function Get-ClaudeUsage($cfg, $dir) {
    $j = Invoke-Usage $cfg.claude_path $dir
    # 登入到期時間（/usage 的輸出裡就有，不用另外查）
    if ($j.credential_expires_at) { $script:claudeExpires = [string]$j.credential_expires_at }
    if ($j.is_error -or $j.local_command -ne 'usage' -or -not $j.result) {
        throw 'claude 回傳格式不對（在終端機執行 claude auth login 重新登入）'
    }
    $rows = @()
    foreach ($line in ($j.result -split "`r?`n")) {
        if ($line -notmatch '^Current (session|week \((.+?)\)):\s*(\d+(?:\.\d+)?)% used(?:.*?resets (.+?) \((.+?)\))?\s*$') { continue }
        $scope = if ($Matches[1] -eq 'session') { 'session' } elseif ($Matches[2] -eq 'all models') { 'weekly_all' } else { 'weekly_model' }
        $rows += [ordered]@{
            kind  = $scope
            model = $(if ($scope -eq 'weekly_model') { [string]$Matches[2] } else { $null })
            used  = [double]$Matches[3]
            reset = $(if ($Matches[4]) { Convert-ClaudeReset $Matches[4] $Matches[5] } else { $null })
        }
    }
    if ($rows.Count -eq 0) { throw '讀不到 Claude 額度（/usage 輸出格式可能改了）' }
    return , $rows
}

# ---------- 主程式 ----------
try {
    $cfg = Get-Content (Join-Path $here 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $probeDir = Join-Path $here 'probe'
    New-Item -ItemType Directory -Force $probeDir | Out-Null
    $now = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

    $agy = $null; $agyErr = $null
    try { $agy = Get-AgyUsage $cfg $probeDir } catch { $agyErr = $_.Exception.Message }

    $claude = $null; $claudeErr = $null; $script:claudeExpires = $null
    if ($cfg.claude_path) {
        try { $claude = Get-ClaudeUsage $cfg $probeDir } catch { $claudeErr = $_.Exception.Message }
    } else { $claudeErr = '沒有設定 claude_path' }

    if (-not $agy -and -not $claude) { throw "兩邊都失敗 — agy: $agyErr / claude: $claudeErr" }

    # 某一邊失敗時，沿用上一次成功的資料，並標記錯誤
    $outFile = Join-Path $here 'agy-usage.json'
    $prev = $null
    if (Test-Path $outFile) { try { $prev = Get-Content $outFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch {} }

    $prevExpires = if ($prev -and $prev.claude) { [string]$prev.claude.login_expires_at } else { '' }
    $expires = if ($script:claudeExpires) { $script:claudeExpires } elseif ($prevExpires) { $prevExpires } else { $null }

    $payload = [ordered]@{
        v          = 2
        fetched_at = $now
        agy        = [ordered]@{
            fetched_at = $(if ($agy) { $now } elseif ($prev -and $prev.agy) { $prev.agy.fetched_at } else { $null })
            error      = $agyErr
            groups     = $(if ($agy) { $agy } elseif ($prev -and $prev.agy) { $prev.agy.groups } else { @() })
        }
        claude     = [ordered]@{
            fetched_at = $(if ($claude) { $now } elseif ($prev -and $prev.claude) { $prev.claude.fetched_at } else { $null })
            error      = $claudeErr
            login_expires_at = $expires
            rows       =$(if ($claude) { $claude } elseif ($prev -and $prev.claude) { $prev.claude.rows } else { @() })
        }
    }
    $json = $payload | ConvertTo-Json -Depth 8 -Compress
    [IO.File]::WriteAllText($outFile, $json, (New-Object Text.UTF8Encoding $false))

    & $cfg.gh_path gist edit $cfg.gist_id --filename 'agy-usage.json' $outFile
    if ($LASTEXITCODE -ne 0) { throw "gh gist edit 失敗 (exit $LASTEXITCODE)" }

    $status = 'OK'
    if ($expires) {
        $status += " claude 登入到期 $expires"
        if ($prevExpires -and $expires -ne $prevExpires) {
            # 只差幾秒的變動是憑證更新時的誤差，不算延長
            $diffHours = ([DateTimeOffset]::Parse($expires) - [DateTimeOffset]::Parse($prevExpires)).TotalHours
            if ($diffHours -ge 1) { $status += " (已延長，原本 $prevExpires)" }
            elseif ($diffHours -le -1) { $status += " (提前了，原本 $prevExpires)" }
        }
    }
    if ($agyErr) { $status += " (agy 失敗: $agyErr)" }
    if ($claudeErr) { $status += " (claude 失敗: $claudeErr)" }
    Write-Log $status

    # Claude 登入剩 3 天內（或已過期）：另開一個程序跳出續期視窗，不卡住這次排程
    if ($expires -and ([DateTimeOffset]::Parse($expires) - [DateTimeOffset]::UtcNow).TotalDays -le 3) {
        Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $here 'notify-renew.ps1') + '"'),
            '-Expires', $expires)
    }
} catch {
    Write-Log ('ERROR ' + $_.Exception.Message)
    exit 1
}
