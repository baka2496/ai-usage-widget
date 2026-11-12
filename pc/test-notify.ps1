# 檢查續期視窗的安全設定（2026-11-12 曾因預設按鈕是「是」，打字按 Enter 就意外啟動登入）
# 用法：powershell -ExecutionPolicy Bypass -File pc\test-notify.ps1
$src = Get-Content (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'notify-renew.ps1') -Raw -Encoding UTF8
$fail = 0
function Check($name, $ok) { if ($ok) { Write-Host "PASS  $name" } else { Write-Host "FAIL  $name" -ForegroundColor Red; $script:fail++ } }

if ($src -notmatch '\$MB_FLAGS\s*=\s*(.+)') { Write-Host 'FAIL  找不到 $MB_FLAGS' -ForegroundColor Red; exit 1 }
$flags = Invoke-Expression $Matches[1]

Check '有「是/否」兩個按鈕 (MB_YESNO)'            (($flags -band 0xF) -eq 0x4)
Check '預設按鈕是「否」(MB_DEFBUTTON2)'          (($flags -band 0xF00) -eq 0x100)
Check '浮在最上層，勿擾模式也看得到 (MB_TOPMOST)' (($flags -band 0x40000) -ne 0)
Check '不搶鍵盤焦點 (沒有 MB_SETFOREGROUND)'      (($flags -band 0x10000) -eq 0)
Check '只有按「是」(IDYES=6) 才啟動續期'          ($src -match 'if \(\$ret -eq 6\)')
Check '同一天只跳一次'                            ($src -match 'notify-state\.txt')

if ($fail) { exit 1 } else { Write-Host '全部通過' -ForegroundColor Green }
