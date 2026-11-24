// Codex 額度解析測試。用法：node tests/codex-parse.test.js
"use strict";
const { parseRateLimits, windowLabel } = require("../pc/read-codex-usage.js");

// 2026-11-24 實際從 `codex app-server` 的 account/rateLimits/read 讀到的結果（免費方案，帳號代號已移除）
const REAL = {
  rateLimits: { limitId: "codex", limitName: null,
    primary: { usedPercent: 2, windowDurationMins: 43200, resetsAt: 1797410307 },
    secondary: null, credits: { hasCredits: false, unlimited: false, balance: null },
    planType: "free", rateLimitReachedType: null },
};

const cases = [
  ["真實資料：免費方案、每月用了 2%", () => {
    const u = parseRateLimits(REAL);
    return u.plan === "free" && u.rows.length === 1 && u.rows[0].label === "每月" && u.rows[0].used === 2;
  }],
  ["真實資料：重設時間 2026-12-16 08:38:27 UTC", () => parseRateLimits(REAL).rows[0].reset === "2026-12-16T08:38:27Z"],
  ["付費方案：5 小時、每週兩筆，照時間長短排序", () => {
    const u = parseRateLimits({ rateLimits: { primary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: 1797410307 },
      secondary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 1795520000 }, planType: "plus" } });
    return u.rows.map((r) => `${r.label} ${r.used}`).join(",") === "5 小時 40,每週 12";
  }],
  ["視窗名稱：300→5 小時、10080→每週、43200→每月、1440→1 天", () =>
    windowLabel(300) === "5 小時" && windowLabel(10080) === "每週" && windowLabel(43200) === "每月" && windowLabel(1440) === "1 天"],
  ["沒有額度資料 → null，不會亂填 0%", () => parseRateLimits({}) === null],
];

let fail = 0;
for (const [name, fn] of cases) {
  let ok = false, err = "";
  try { ok = fn(); } catch (e) { err = " — " + e.message; }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${err}`);
  if (!ok) fail++;
}
console.log(fail ? `\n${fail} 項失敗` : `\n全部 ${cases.length} 項通過`);
process.exit(fail ? 1 : 0);
