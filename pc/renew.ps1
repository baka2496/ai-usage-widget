# 點通知上的「現在續期」時執行：重新登入 Claude Code CLI，然後立刻上傳一次額度。
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$host.UI.RawUI.WindowTitle = 'Claude 登入續期'
$cfg = Get-Content (Join-Path $here 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json

Write-Host '=== Claude 登入續期 ===' -ForegroundColor Cyan
Write-Host '會打開瀏覽器，請在 claude.ai 頁面按「授權」。'
Write-Host ''
& $cfg.claude_path auth login
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '登入沒有完成。可以關掉這個視窗，之後再點一次通知重試。' -ForegroundColor Yellow
    Read-Host '按 Enter 關閉'
    exit 1
}

Write-Host ''
Write-Host '登入完成，正在更新小工具資料…'
Remove-Item (Join-Path $here 'notify-state.txt') -ErrorAction SilentlyContinue
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'push-agy-usage.ps1')
$last = Get-Content (Join-Path $here 'push.log') -Encoding UTF8 -Tail 1
Write-Host $last
Write-Host ''
Write-Host '完成！這個視窗 15 秒後自動關閉。' -ForegroundColor Green
Start-Sleep 15
