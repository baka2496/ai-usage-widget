# 安裝：把腳本複製到 %USERPROFILE%\ai-usage-widget，建立私密 Gist，註冊每 15 分鐘的排程。
# 用法：powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$dst = Join-Path $env:USERPROFILE 'ai-usage-widget'
$taskName = 'AI Usage Widget - agy push'

$agy = (Get-Command agy -ErrorAction Stop).Source
$gh  = (Get-Command gh  -ErrorAction Stop).Source
$claude = (Get-Command claude -ErrorAction SilentlyContinue).Source
if (-not $claude -and (Test-Path "$env:USERPROFILE\.local\bin\claude.exe")) { $claude = "$env:USERPROFILE\.local\bin\claude.exe" }
if (-not $claude) { Write-Warning '找不到 claude 指令，小工具將只顯示 Antigravity' }

# Gemini App 用量：需要 Node.js 和 Edge（用專用設定檔在背景讀 gemini.google.com/usage）
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
        Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $node -or -not $edge) { Write-Warning '找不到 node 或 Edge，小工具不會顯示 Gemini App 用量' }
$geminiProfile = Join-Path $dst 'gemini-profile'

New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item (Join-Path $src 'push-agy-usage.ps1'), (Join-Path $src 'run-hidden.vbs'),
          (Join-Path $src 'notify-renew.ps1'), (Join-Path $src 'renew.ps1'),
          (Join-Path $src 'read-gemini-usage.js'), (Join-Path $src 'gemini-login.ps1') $dst -Force

$cfgPath = Join-Path $dst 'config.json'
$cfg = $null
if (Test-Path $cfgPath) { $cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json }

if (-not $cfg -or -not $cfg.gist_id) {
    # 先放一個佔位檔，建立私密 (secret) Gist
    $seed = Join-Path $dst 'agy-usage.json'
    [IO.File]::WriteAllText($seed, '{"v":1,"source":"agy","fetched_at":null,"groups":[]}', (New-Object Text.UTF8Encoding $false))
    $url = (& $gh gist create $seed --desc 'AI usage widget feed (agy quota)' | Select-Object -Last 1).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $url) { throw '建立 Gist 失敗（gh 需要 gist 權限：gh auth refresh -s gist）' }
    $gistId = ($url -split '/')[-1]
    $login = (& $gh api user --jq .login).Trim()
    $cfg = [pscustomobject]@{
        gist_id  = $gistId
        raw_url  = "https://gist.githubusercontent.com/$login/$gistId/raw/agy-usage.json"
        agy_path    = $agy
        claude_path = $claude
        gh_path     = $gh
        node_path   = $node
        edge_path   = $edge
        gemini_profile = $geminiProfile
    }
} else {
    $cfg = [pscustomobject]@{
        gist_id     = $cfg.gist_id
        raw_url     = $cfg.raw_url
        agy_path    = $agy
        claude_path = $claude
        gh_path     = $gh
        node_path   = $node
        edge_path   = $edge
        gemini_profile = $geminiProfile
    }
}
[IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))

# 排程：登入時 + 每 15 分鐘
$action   = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + (Join-Path $dst 'run-hidden.vbs') + '"')
$repeat   = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15)
$logon    = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
            -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $repeat, $logon -Settings $settings `
    -Description '每 15 分鐘把 Antigravity CLI 額度上傳到 Gist，給 iPhone 小工具用' -Force | Out-Null

# Gemini App 還沒登入過：打開專用 Edge 讓你登入一次（登入後關掉視窗，會自動上傳）
if ($node -and $edge -and -not (Test-Path (Join-Path $geminiProfile 'Default'))) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dst 'gemini-login.ps1')
}

# 立刻跑一次
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dst 'push-agy-usage.ps1')

Write-Host ''
Write-Host '安裝完成。把下面這個 Gist 代號貼到 iPhone 小工具腳本最上面的 FEED_URL 引號裡：'
Write-Host $cfg.gist_id
Write-Host '（只用代號、不含帳號名稱，GitHub 帳號改名也不用重貼）'
