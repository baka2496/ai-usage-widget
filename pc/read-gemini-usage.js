// 讀取 Gemini App 的用量頁（gemini.google.com/usage），輸出一行 JSON。
// 用法：node read-gemini-usage.js <Edge 路徑> <專用設定檔資料夾> [--text]
//   --text：只印出頁面文字（除錯用）
// 做法：用專用的 Edge 設定檔（已登入 Google），在背景（不開視窗）開啟用量頁，
//       透過本機除錯埠讀出頁面上的文字，再找出「目前用量」「每週上限」。
// 這不是 Google 官方介面：Google 改版時，可能要更新 parseUsage()。
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const URL_USAGE = "https://gemini.google.com/usage";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 解析（純函式，有自動測試） ----------

// 「重設時間：下午11:28」「重設時間：11月24日下午8:28」「Resets Nov 24, 8:28 PM」→ ISO（UTC）
// 只有時間沒有日期時，取「現在之後最近的那個時間」。now 是電腦的本地時間。
function parseReset(text, now = new Date()) {
  if (!text) return null;
  let mon = null, day = null, h, min;
  // 英文（有 AM/PM）要先判斷，否則「11:28 PM」會被當成中文格式的 11 點
  const isEn = /\d{1,2}:\d{2}\s*[AaPp]\.?[Mm]/.test(text);
  let m = isEn ? null : text.match(/(?:(\d{1,2})\s*月\s*(\d{1,2})\s*日)?\s*(上午|下午|中午|晚上|凌晨|早上)?\s*(\d{1,2})[:：](\d{2})/);
  if (m) {
    if (m[1]) { mon = +m[1]; day = +m[2]; }
    h = +m[4]; min = +m[5];
    const ap = m[3];
    if ((ap === "下午" || ap === "晚上") && h < 12) h += 12;
    if ((ap === "上午" || ap === "凌晨" || ap === "早上") && h === 12) h = 0;
  } else {
    const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    m = text.match(/(?:\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s*(?:at\s+)?)?(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]/);
    if (!m) return null;
    if (m[1]) { mon = MON[m[1].toLowerCase()]; day = +m[2]; if (!mon) return null; }
    h = +m[3] % 12; min = +m[4];
    if (/p/i.test(m[5])) h += 12;
  }
  if (h > 23 || min > 59) return null;
  let d;
  if (mon) {
    d = new Date(now.getFullYear(), mon - 1, day, h, min, 0);
    if (d.getTime() < now.getTime() - 2 * 86400e3) d.setFullYear(d.getFullYear() + 1);
  } else {
    d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, min, 0);
    if (d.getTime() < now.getTime() - 60e3) d.setDate(d.getDate() + 1);
  }
  return d.toISOString().replace(/\.\d+Z$/, "Z");
}

// 從頁面文字找出「目前用量」和「每週上限」。中英文介面都支援。
function parseUsage(text, now = new Date()) {
  if (!text) return null;
  const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const starts = [
    ["current", /^(目前用量|目前使用量|Current usage|Current)$/i],
    ["weekly", /^(每週上限|每週用量|每週使用量|Weekly( usage| limit)?)$/i],
  ];
  const idx = starts.map(([k, re]) => [k, lines.findIndex((l) => re.test(l))]);
  const out = {};
  for (const [k, i] of idx) {
    if (i < 0) continue;
    // 這一段只看到下一個標題為止，避免抓到別段的數字
    const next = idx.map(([, j]) => j).filter((j) => j > i).sort((a, b) => a - b)[0];
    const seg = lines.slice(i + 1, Math.min(next ?? i + 6, i + 6));
    const pctLine = seg.find((l) => /(已使用|used)?\s*\d+(\.\d+)?\s*%/i.test(l));
    if (!pctLine) continue;
    const resetLine = seg.find((l) => /重設|重置|reset/i.test(l)) || null;
    out[k] = { used: Number(pctLine.match(/(\d+(?:\.\d+)?)\s*%/)[1]), reset: parseReset(resetLine, now), reset_text: resetLine };
  }
  return out.current || out.weekly ? out : null;
}

// ---------- 讀頁面 ----------

async function waitPort(profile, ms) {
  const f = path.join(profile, "DevToolsActivePort");
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const port = fs.readFileSync(f, "utf8").split(/\r?\n/)[0].trim(); if (port) return port; } catch {}
    await sleep(300);
  }
  throw new Error("專用 Edge 沒有啟動（登入用的視窗還開著的話，關掉就好）");
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("連不上 Edge 除錯埠")); });
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  return { ready, send, close: () => ws.close() };
}

async function pageText(edge, profile, timeoutMs = 45000) {
  try { fs.unlinkSync(path.join(profile, "DevToolsActivePort")); } catch {}
  const proc = spawn(edge, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  try {
    const port = await waitPort(profile, 20000);
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === "page");
    if (!page) throw new Error("找不到 Edge 分頁");
    const c = cdp(page.webSocketDebuggerUrl);
    await c.ready;
    await c.send("Page.navigate", { url: URL_USAGE });
    const end = Date.now() + timeoutMs;
    let text = "", href = "";
    while (Date.now() < end) {
      await sleep(1500);
      const r = await c.send("Runtime.evaluate", { expression: "JSON.stringify([location.href, document.body ? document.body.innerText : ''])", returnByValue: true });
      try { [href, text] = JSON.parse(r.result.result.value); } catch { continue; }
      if (/accounts\.google\.com/.test(href)) break; // 被導去登入頁
      const u = parseUsage(text);
      if (u && u.current && u.weekly) break;
    }
    c.close();
    return { href, text };
  } finally {
    try { proc.kill(); } catch {}
  }
}

module.exports = { parseUsage, parseReset };

if (require.main === module) {
  const [, , edge, profile, flag] = process.argv;
  (async () => {
    const { href, text } = await pageText(edge, profile);
    if (flag === "--text") { console.log(href + "\n----\n" + text); return; }
    const u = parseUsage(text);
    if (u) { console.log(JSON.stringify({ ok: true, current: u.current || null, weekly: u.weekly || null })); return; }
    const needLogin = /accounts\.google\.com/.test(href) || /(^|\n)(登入|Sign in)(\n|$)/.test(text);
    console.log(JSON.stringify({ ok: false, error: needLogin ? "login" : "parse" }));
  })().catch((e) => { console.log(JSON.stringify({ ok: false, error: e.message })); process.exitCode = 0; });
}
