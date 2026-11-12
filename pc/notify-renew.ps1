# 跳出「Claude 登入快到期」的對話視窗（不受勿擾模式影響）。按「是」就執行 renew.ps1。
# 用法：notify-renew.ps1 -Expires 2026-12-08T19:00:49Z [-Force]
#   沒有 -Force 時，同一天只會跳一次。
param(
    [Parameter(Mandatory = $true)][string]$Expires,
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$stateFile = Join-Path $here 'notify-state.txt'
$today = (Get-Date).ToString('yyyy-MM-dd')
if (-not $Force -and (Test-Path $stateFile) -and ((Get-Content $stateFile -Raw).Trim() -eq $today)) { return }
# 先記下今天已提醒，避免視窗還開著時又跳第二個
Set-Content -Path $stateFile -Value $today -Encoding ASCII

$exp = [DateTimeOffset]::Parse($Expires)
$local = $exp.ToLocalTime().ToString('M/d HH:mm')
$mins = [int][Math]::Floor(($exp - [DateTimeOffset]::UtcNow).TotalMinutes)
if ($mins -gt 0) {
    $d = [int][Math]::Floor($mins / 1440); $h = [int][Math]::Floor(($mins % 1440) / 60)
    $left = if ($d -gt 0) { "${d}天${h}時" } elseif ($h -gt 0) { "${h}時$($mins % 60)分" } else { "${mins}分" }
    $title = 'Claude 登入快到期'
    $text = "還剩 $left（$local 到期）。`n`n要現在續期嗎？`n（會打開瀏覽器，按一次「授權」就好）"
} else {
    $title = 'Claude 登入已過期'
    $text = "已在 $local 過期，iPhone 小工具的 Claude 額度停止更新。`n`n要現在重新登入嗎？`n（會打開瀏覽器，按一次「授權」就好）"
}

$logFile = Join-Path $here 'notify.log'
function Write-NotifyLog($msg) { Add-Content -Path $logFile -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $msg) -Encoding UTF8 }

Write-NotifyLog "顯示續期視窗：$title"
try {
    # Win32 MessageBox：MB_YESNO(0x4) | MB_ICONWARNING(0x30) | MB_DEFBUTTON2(0x100) | MB_TOPMOST(0x40000)
    # 預設按鈕是「否」、也不搶焦點：避免你正在打字時按到 Enter 就意外開始登入。
    # （test-notify.ps1 會檢查這兩點，不要拿掉）
    Add-Type -Namespace AiUsage -Name Native -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode)]
public static extern int MessageBoxW(System.IntPtr hWnd, string text, string caption, uint type);
'@
    $MB_FLAGS = 0x4 -bor 0x30 -bor 0x100 -bor 0x40000
    $ret = [AiUsage.Native]::MessageBoxW([IntPtr]::Zero, $text, $title, $MB_FLAGS)
} catch {
    Write-NotifyLog ('ERROR ' + $_.Exception.Message)
    throw
}
# IDYES = 6, IDNO = 7
Write-NotifyLog ('使用者選擇：' + $(switch ($ret) { 6 { '是' } 7 { '否' } default { "其他($ret)" } }))

if ($ret -eq 6) {
    Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $here 'renew.ps1') + '"'))
}
