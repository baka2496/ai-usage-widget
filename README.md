# AI 額度小工具（Claude + Antigravity CLI）

iPhone 主畫面／鎖定畫面小工具，顯示：

- **Claude**：5 小時、每週、各模型的每週額度（跟 Claude Code 的 `/usage` 一樣）
- **Gemini（Antigravity CLI）**：Gemini 5 小時／每週、Argon 每週，選擇性顯示 Claude/GPT 那組

```
Windows 電腦（每 15 分鐘）                       GitHub               iPhone（Scriptable）
claude -p /usage --output-format json ─┐
agy    -p /usage --output-format json ─┴──►  私密 Gist  ◄── 讀取 ──  AI-Usage.js
```

- 兩個 `/usage` 都是內建指令，**不會呼叫模型、不花 token**。
- 手機不需要登入任何帳號。電腦關機或睡眠時數字不會更新，小工具會顯示「電腦離線 · X前」。
- 其中一邊讀取失敗時，會沿用上次成功的數字，右上角顯示 ⚠︎。
- Gist 只有百分比和重置時間，沒有帳號或 token。私密 Gist 不會出現在搜尋結果或你的公開頁面，但拿到網址的人就能看到。

## 一、電腦端（Windows）

需要：
- `agy` 已登入（在終端機跑過 `agy`）
- Claude Code CLI 已登入（`claude auth login`）
- `gh` 已登入

1. 在 PowerShell 執行：
   ```powershell
   powershell -ExecutionPolicy Bypass -File pc\install.ps1
   ```
   它會：
   - 把腳本複製到 `%USERPROFILE%\ai-usage-widget`
   - 建立私密 Gist（已經有的話沿用同一個）
   - 註冊工作排程「AI Usage Widget - agy push」（登入時，以及之後每 15 分鐘）
   - 立刻上傳一次，最後**印出 Gist 網址**
2. 如果建立 Gist 失敗，多半是 `gh` 沒有 gist 權限：先執行 `gh auth refresh -s gist`，再跑一次 install。
3. 執行紀錄在 `%USERPROFILE%\ai-usage-widget\push.log`。

> 不要裝到 `%LOCALAPPDATA%`：從 Claude 桌面 app 裡寫進那裡的檔案會被 Windows 導到 app 的私有空間，工作排程看不到。

移除：`powershell -ExecutionPolicy Bypass -File pc\uninstall.ps1`。它只會移除排程；`%USERPROFILE%\ai-usage-widget` 資料夾和 Gist 不會自動刪，需要的話自己刪。

## Claude 登入會不會自己延長？

**不會。** 實測（2026-11-10 登入，觀察到 11-12）：Claude Code 大約每 8 小時會自動換一次短期憑證，但登入的最終到期日固定不變（2026-12-08 19:00 UTC，台灣時間 12/9 凌晨 3 點），只會有一兩秒的誤差。到期前 3 天會同時：

- iPhone 小工具的 Claude 欄顯示紅字「登入剩 …」
- 電腦跳出對話視窗「Claude 登入快到期，要現在續期嗎？」（每天最多一次；用視窗而不是通知，勿擾模式也擋不住）。按「是」會自動執行 `claude auth login` 並打開瀏覽器，你只要按「授權」，接著立刻更新手機資料。按「否」就隔天再提醒。預設按鈕是「否」、視窗不搶鍵盤焦點，打字時誤按 Enter 不會開始登入（`pc\test-notify.ps1` 會檢查這些設定）。每次跳窗和你的選擇記在 `notify.log`。

也可以隨時手動執行 `%USERPROFILE%\ai-usage-widget\renew.ps1` 續期。

**為什麼不用一年期的 `claude setup-token`？** 它的權限只有 `user:inference`（只能呼叫模型），讀額度需要 `user:profile`，會被拒絕（HTTP 403）。官方文件寫它「只能發送模型請求」，相關問題 [anthropics/claude-code#11985](https://github.com/anthropics/claude-code/issues/11985) 至今仍未修正（2026-11 查證）。

## 二、iPhone 端

1. 從 App Store 安裝 **Scriptable**（免費）。
2. 在 Scriptable 新增一個腳本，把 `iphone/AI-Usage.js` 整份貼進去，命名為 `AI Usage`。
3. 把電腦安裝時印出的 Gist 網址貼到最上面的 `FEED_URL = ""` 引號裡。
4. 按 ▶ 執行一次，會出現中尺寸預覽。
5. 回主畫面長按 → 加入小工具 → Scriptable → 選尺寸 → 長按小工具「編輯」→ Script 選 `AI Usage`。

### 尺寸與參數

| 位置 | 內容 | Parameter |
|---|---|---|
| 小 | Claude、Gemini 各自的 5 小時和每週 | — |
| 中（推薦） | 左邊 Claude、右邊 Gemini，含重置倒數 | `all`：右欄改成也顯示 Claude/GPT 那組 |
| 大 | 全部項目 | — |
| 鎖定畫面・長方形 | `Claude 5h 30% 週 5%` / `Gemini 5h 0% 週 0%` | — |
| 鎖定畫面・圓形 | 5 小時額度圓環 | `claude`（預設）或 `gemini` |
| 鎖定畫面・單行 | `C 30% · G 0%` | — |

數字都是**已使用 %**，70% 以上變黃、90% 以上變紅。

## 疑難排解

- **顯示「電腦離線」**：電腦關機、睡眠，或排程失敗。看 `push.log`。
- **push.log 出現「claude 失敗」**：在終端機執行 `claude auth login` 重新登入。
- **push.log 出現「agy 失敗」**：在終端機執行 `agy` 重新登入。
- **iOS 小工具更新頻率**由系統決定（通常 15～30 分鐘一次）。
