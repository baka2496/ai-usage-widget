# 打開專用的 Edge 視窗，讓你登入 Google（Gemini App 用量要用到）。
# 第一次安裝、或 push.log 出現「Google 登入過期」時執行：
#   powershell -ExecutionPolicy Bypass -File "%USERPROFILE%\ai-usage-widget\gemini-login.ps1"
# 這個 Edge 設定檔跟你平常用的 Edge 分開，登入狀態只存在這台電腦。

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfgPath = Join-Path $here 'config.json'
$cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$profileDir = if ($cfg.gemini_profile) { $cfg.gemini_profile } else { Join-Path $here 'gemini-profile' }
New-Item -ItemType Directory -Force $profileDir | Out-Null

Write-Host '已打開專用的 Edge 視窗。請登入 Google，看到「用量限制」頁面後，把那個視窗關掉。'
$p = Start-Process $cfg.edge_path -ArgumentList @("--user-data-dir=`"$profileDir`"", '--no-first-run', '--no-default-browser-check', 'https://gemini.google.com/usage') -PassThru
$p.WaitForExit()
# Edge 可能把視窗交給另一個程序：等到這個設定檔的 Edge 全部關掉
while (Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like "*$profileDir*" }) { Start-Sleep 2 }

Write-Host '視窗已關閉，正在更新手機資料…'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'push-agy-usage.ps1')
Write-Host ((Get-Content (Join-Path $here 'push.log') -Encoding UTF8 -Tail 1))
Start-Sleep 10
