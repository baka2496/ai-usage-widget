# AI 額度小工具（Claude + Gemini App + Antigravity CLI + Codex）

iPhone 主畫面／鎖定畫面小工具，顯示：

- **Claude**：5 小時、每週、各模型的每週額度（跟 Claude Code 的 `/usage` 一樣）
- **Gemini App**：gemini.google.com/usage 上的「目前用量」和「每週上限」
- **Antigravity CLI**：5 小時／每週、Argon 每週、Claude/GPT 那組（停用中的限制不顯示）
- **Codex**：方案的額度視窗（免費版是「每月」；付費版通常是 5 小時＋每週），透過 Codex 官方的 `codex app-server` 讀取（`pc/read-codex-usage.js`），不呼叫模型、不花用量。需要 npm 安裝的 `codex` 並已登入（`codex login`）。

> **Gemini App 和 Antigravity 的額度是分開算的**：重置時間和數字都不同，所以小工具分成兩欄。

```
Windows 電腦（每 15 分鐘）                       GitHub               iPhone（Scriptable）
claude -p /usage --output-format json ─┐
agy    -p /usage --output-format json ─┤
codex app-server（account/rateLimits）─┼──►  私密 Gist  ◄── 讀取 ──  AI-Usage.js
Edge（背景）讀 gemini.google.com/usage ─┘
```

### Gemini App 用量怎麼讀（非官方）

Google 沒有提供讀取 Gemini App 用量的官方介面。電腦用一個**專用的 Edge 設定檔**（`%USERPROFILE%\ai-usage-widget\gemini-profile`，跟你平常的 Edge 分開）在背景打開用量頁、讀出頁面上的文字（`pc/read-gemini-usage.js`）。

- 第一次安裝會跳出這個專用 Edge 視窗，登入 Google、看到用量頁後關掉視窗即可。
- Google 登入過期時，小工具會顯示紅字「Google 需重新登入」，執行 `%USERPROFILE%\ai-usage-widget\gemini-login.ps1` 重新登入。
- 登入狀態只存在這台電腦，不會上傳；Gist 裡只有百分比和重設時間。
- Google 改版時可能讀不到（push.log 會寫「看不懂 Gemini 用量頁」），需要更新 `parseUsage()`。
- 需要 Node.js（`node` 指令）和 Microsoft Edge。

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
   - 立刻上傳一次，最後**印出 Gist 代號**（32 碼英數）
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
3. （自己的電腦上也可以執行 `node tests/make-mine.js`，直接產生填好代號的 `iphone/AI-Usage.mine.js`，整份貼上即可。）把電腦安裝時印出的 Gist 代號貼到最上面的 `FEED_URL = ""` 引號裡（貼完整的 Gist 網址也可以，小工具只取裡面的代號）。小工具透過 GitHub API 用代號讀取，所以 GitHub 帳號改名也不會壞；API 每小時 60 次的免登入額度用完時，會自動改用 raw 網址。
4. 按 ▶ 執行一次，會出現中尺寸預覽。
5. 回主畫面長按 → 加入小工具 → Scriptable → 選尺寸 → 長按小工具「編輯」→ Script 選 `AI Usage`。

### 尺寸與參數

| 位置 | 內容 | Parameter |
|---|---|---|
參數用字母或名稱指定要顯示哪幾家：`c`＝Claude、`g`＝Gemini App、`a`＝Antigravity、`x`＝Codex（例如 `cgx`，或 `codex`）。

| 位置 | 內容 | Parameter |
|---|---|---|
| 小 | Claude 和 Gemini App | 第二家換人：`codex`、`antigravity`；或指定兩家：`gx` |
| 中（推薦） | 2×2：左 Claude／Codex，右 Gemini App／Antigravity（不含重置倒數） | — |
| 大 | 四家全部；Claude 和 Gemini App 含重置倒數 | `all`：Antigravity 也顯示 Claude/GPT 那組 |
| 鎖定畫面・長方形 | `Claude 5h 30% 週 5%` / `Gemini 目前 26% 週 16%` / `Antigravity 5h 0% 週 0%`（最多 3 家；Claude 登入快到期時，第三行改成提醒） | 例如 `cgx` 把第三行換成 Codex |
| 鎖定畫面・圓形 | 一家的額度圓環 | `claude`（預設）、`gemini`、`antigravity`、`codex` |
| 鎖定畫面・單行 | `C 30% · G 26% · A 0%`（Codex 顯示為 `Cx`） | 例如 `cgax` 顯示四家 |

數字都是**已使用 %**，70% 以上變黃、90% 以上變紅。

## 疑難排解

- **顯示「讀取失敗」**：手機讀不到 Gist（網路斷了、代號貼錯、GitHub 暫時限制）。電腦那邊可能是正常的。
- **顯示「電腦離線」**：手機讀得到 Gist，但電腦超過 45 分鐘沒上傳：電腦關機、睡眠，或排程失敗。看 `push.log`。

## 自動測試

```bash
node tests/widget.test.js                                   # 小工具：讀取方式、錯誤顯示、各尺寸
node tests/gemini-parse.test.js                             # Gemini 用量頁的解析（用真實頁面文字）
node tests/codex-parse.test.js                              # Codex 額度的解析（用真實回應）
node tests/phone-script.test.js                             # 要貼到手機的檔案：語法、編碼、是不是最新版
powershell -ExecutionPolicy Bypass -File pc\test-notify.ps1  # 續期視窗的安全設定
```
- **push.log 出現「claude 失敗」**：在終端機執行 `claude auth login` 重新登入。
- **push.log 出現「agy 失敗」**：在終端機執行 `agy` 重新登入。
- **push.log 出現「codex 失敗」**：在終端機執行 `codex login` 重新登入。
- **push.log 出現「Google 登入過期」**：執行 `gemini-login.ps1`。
- **push.log 出現「專用 Edge 沒有啟動」**：登入用的那個 Edge 視窗還開著，關掉就好。
- **iOS 小工具更新頻率**由系統決定（通常 15～30 分鐘一次）。
