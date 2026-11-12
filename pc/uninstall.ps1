# 移除排程。為了安全，不會自動刪除資料夾；Gist 也不會刪。
Unregister-ScheduledTask -TaskName 'AI Usage Widget - agy push' -Confirm:$false -ErrorAction SilentlyContinue
Write-Host '已移除排程。'
Write-Host ('如果不再需要，請自己刪除這個資料夾：' + (Join-Path $env:USERPROFILE 'ai-usage-widget'))
Write-Host 'Gist 需要的話到 gist.github.com 手動刪除。'
