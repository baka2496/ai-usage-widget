// Gemini App 用量頁解析測試。用法：node tests/gemini-parse.test.js
"use strict";
const { parseUsage, parseReset } = require("../pc/read-gemini-usage.js");

// 2026-11-23 晚上 7 點（電腦本地時間）
const NOW = new Date(2026, 10, 23, 19, 0, 0);
const local = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; };

// 2026-11-23 實際從 gemini.google.com/usage 讀到的頁面文字（中文介面）
const PAGE_ZH = `Gemini
用量限制
PRO

方案限制決定了你在一段時間內可使用的 Gemini 額度。進階模型和功能可能需要更高的用量。瞭解詳情

剛才更新

目前用量
info
已使用 5%
重設時間：下午11:28
每週上限
重設時間：11月24日下午8:28
已使用 21%
訂閱 AI Ultra 即享 5 倍用量
每月 $3,300
升級`;

const cases = [
  ["真實頁面：目前用量 5%、每週 21%（跟網頁一樣）", () => {
    const u = parseUsage(PAGE_ZH, NOW);
    return u.current.used === 5 && u.weekly.used === 21;
  }],
  ["真實頁面：重設時間 今天 23:28、11/24 20:28", () => {
    const u = parseUsage(PAGE_ZH, NOW);
    return local(u.current.reset) === "11/23 23:28" && local(u.weekly.reset) === "11/24 20:28";
  }],
  ["每週的數字不會抓到下面的「5 倍用量」或「$3,300」", () => parseUsage(PAGE_ZH, NOW).weekly.used === 21],
  ["只有時間、已經過了 → 算明天", () => local(parseReset("重設時間：上午9:05", NOW)) === "11/24 9:05"],
  ["上午 12 點是凌晨 0 點", () => local(parseReset("重設時間：上午12:10", NOW)) === "11/24 0:10"],
  ["跨年：1月2日 → 明年", () => new Date(parseReset("重設時間：1月2日下午8:28", NOW)).getFullYear() === 2027],
  ["英文介面也看得懂", () => {
    const u = parseUsage("Current usage\n12% used\nResets 11:28 PM\nWeekly limit\nResets Nov 24, 8:28 PM\n40% used", NOW);
    return u.current.used === 12 && u.weekly.used === 40 && local(u.weekly.reset) === "11/24 20:28" && local(u.current.reset) === "11/23 23:28";
  }],
  ["不是用量頁（例如登入頁）→ 回傳 null，不會亂填 0%", () => parseUsage("Gemini\n登入\n與 Gemini 對話", NOW) === null],
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
