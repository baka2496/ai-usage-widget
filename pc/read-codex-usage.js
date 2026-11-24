// 讀取 Codex 的額度，輸出一行 JSON。
// 用法：node read-codex-usage.js <codex.js 路徑>
// 做法：啟動 `codex app-server`（Codex 官方的本機介面），送出 account/rateLimits/read。
//       這只是查詢帳號額度，不會呼叫模型、不花用量。
"use strict";
const { spawn } = require("child_process");

// 視窗長度（分鐘）→ 小工具上的名稱
function windowLabel(mins) {
  if (mins === 300) return "5 小時";
  if (mins === 10080) return "每週";
  if (mins >= 40320 && mins <= 44640) return "每月";
  if (mins % 1440 === 0) return `${mins / 1440} 天`;
  if (mins % 60 === 0) return `${mins / 60} 小時`;
  return `${mins} 分`;
}

// account/rateLimits/read 的結果 → { plan, rows:[{label, mins, used, reset}] }
function parseRateLimits(result) {
  const rl = result && (result.rateLimits || (result.rateLimitsByLimitId && result.rateLimitsByLimitId.codex));
  if (!rl) return null;
  const rows = [];
  for (const w of [rl.primary, rl.secondary]) {
    if (!w || typeof w.usedPercent !== "number") continue;
    const mins = Number(w.windowDurationMins) || null;
    rows.push({
      label: mins ? windowLabel(mins) : "額度",
      mins,
      used: w.usedPercent,
      reset: w.resetsAt ? new Date(w.resetsAt * 1000).toISOString().replace(/\.\d+Z$/, "Z") : null,
    });
  }
  rows.sort((a, b) => (a.mins || 0) - (b.mins || 0));
  return { plan: rl.planType || null, limit_reached: rl.rateLimitReachedType || null, rows };
}

function readLimits(codexJs, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [codexJs, "app-server"], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    let buf = "", done = false;
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(t); try { p.kill(); } catch {} err ? reject(err) : resolve(val); };
    const t = setTimeout(() => finish(new Error("Codex 超過 45 秒沒有回應")), timeoutMs);
    p.on("error", (e) => finish(new Error("無法啟動 Codex：" + e.message)));
    p.on("exit", () => finish(new Error("Codex 提早結束（可能沒登入，在終端機執行 codex login）")));
    p.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 0) {
          send({ method: "initialized" });
          send({ method: "account/rateLimits/read", id: 1 });
        } else if (m.id === 1) {
          if (m.error) finish(new Error(/auth|login|unauthor/i.test(JSON.stringify(m.error)) ? "login" : (m.error.message || "讀取失敗")));
          else finish(null, m.result);
        }
      }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ method: "initialize", id: 0, params: { clientInfo: { name: "ai-usage-widget", version: "1.0" } } });
  });
}

module.exports = { parseRateLimits, windowLabel };

if (require.main === module) {
  readLimits(process.argv[2])
    .then((r) => {
      const u = parseRateLimits(r);
      console.log(JSON.stringify(u && u.rows.length ? { ok: true, ...u } : { ok: false, error: "parse" }));
    })
    .catch((e) => console.log(JSON.stringify({ ok: false, error: e.message })));
}
