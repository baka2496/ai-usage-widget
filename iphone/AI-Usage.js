// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-gray; icon-glyph: tachometer-alt;

// ============================================================
//  AI 額度小工具：Claude + Gemini App + Antigravity CLI + Codex
//  注意：Gemini App（gemini.google.com）和 Antigravity CLI 的額度是分開計算的。
//  電腦每 15 分鐘把 `claude /usage`、`agy /usage` 和 Gemini 用量頁上傳到私密 Gist，
//  這裡只讀 Gist，手機不需要登入任何帳號。
//
//  小工具參數（長按小工具 → 編輯小工具 → Parameter）：c=Claude g=Gemini App a=Antigravity x=Codex
//    小尺寸：第二家要換成誰，例如 codex 或 x（預設 Gemini App）；也可以指定兩家，例如 gx
//    鎖定畫面長方形／單行：要顯示哪幾家、照順序，例如 cgx（預設 cga，長方形最多 3 家）
//    鎖定畫面圓形：顯示哪一家，例如 codex（預設 claude）
//    大尺寸：all → Antigravity 也顯示「Claude 和 GPT」那組
// ============================================================

// ★ 把電腦 install.ps1 最後印出來的 Gist 代號（或完整網址）貼在這裡
//   只看其中的 32 碼代號，GitHub 帳號改名也不用重貼。
const FEED_URL = "";

const STALE_MIN = 45;     // 資料超過這麼久沒更新 → 顯示「電腦離線」
const EXPIRY_WARN_DAYS = 3; // Claude 登入剩幾天內開始提醒

const C_CLAUDE = new Color("#D97757");
const C_GEMINI = new Color("#4C8DF6"); // Gemini App
const C_AGY = new Color("#2FB39A");    // Antigravity
const C_CODEX = new Color("#A78BFA");  // Codex
const C_WARN = new Color("#F5A623");
const C_DANGER = new Color("#E5484D");
const C_TRACK = Color.dynamic(new Color("#000000", 0.10), new Color("#FFFFFF", 0.16));
const C_TEXT = Color.dynamic(new Color("#1C1C1E"), new Color("#F2F2F7"));
const C_SUB = Color.dynamic(new Color("#6E6E73"), new Color("#98989F"));
const C_BG = Color.dynamic(new Color("#FFFFFF"), new Color("#1C1C1E"));

const fm = FileManager.local();
const CACHE_DIR = fm.joinPath(fm.documentsDirectory(), "ai-usage-widget");
if (!fm.fileExists(CACHE_DIR)) fm.createDirectory(CACHE_DIR, true);

// ------------------------------------------------------------
//  快取
// ------------------------------------------------------------
function readCache(name) {
  const p = fm.joinPath(CACHE_DIR, name + ".json");
  if (!fm.fileExists(p)) return null;
  try { return JSON.parse(fm.readString(p)); } catch { return null; }
}
function writeCache(name, obj) {
  fm.writeString(fm.joinPath(CACHE_DIR, name + ".json"), JSON.stringify(obj));
}

// ------------------------------------------------------------
//  讀 Gist（電腦每 15 分鐘上傳 Claude + Antigravity 的額度）
// ------------------------------------------------------------
const FEED_FILE = "agy-usage.json";

// 從 FEED_URL 取出 Gist 代號（32 碼英數）。貼代號或貼完整網址都可以。
function gistIdOf(s) {
  const m = String(s || "").match(/[0-9a-f]{32}/i);
  return m ? m[0].toLowerCase() : null;
}

async function fetchText(url) {
  const r = new Request(url);
  r.timeoutInterval = 15;
  r.headers = { Accept: "application/vnd.github+json", "User-Agent": "ai-usage-widget" };
  const text = await r.loadString();
  const code = r.response && r.response.statusCode;
  if (code && code !== 200) throw new Error("http" + code);
  return text;
}

function parseFeed(text) {
  const feed = JSON.parse(text);
  if (!feed || typeof feed !== "object" || !(feed.agy || feed.claude || feed.groups)) throw new Error("parse");
  return feed;
}

// 讀 Gist：先用 GitHub API（只靠 Gist 代號，帳號改名也不受影響）；
// API 失敗（例如每小時次數用完）時，改用上次記下的擁有者拼出 raw 網址再試一次。
async function getFeed() {
  const cache = readCache("feed");
  const id = gistIdOf(FEED_URL);
  if (!id) return { feed: cache ? cache.feed : null, error: "nourl" };
  let firstErr = null;
  try {
    const g = JSON.parse(await fetchText(`https://api.github.com/gists/${id}`));
    const f = g.files && g.files[FEED_FILE];
    if (!f) throw new Error("nofile");
    const feed = parseFeed(f.truncated ? await fetchText(f.raw_url) : f.content);
    writeCache("feed", { feed, owner: g.owner && g.owner.login });
    return { feed, error: null };
  } catch (e) {
    firstErr = e.message || "network";
  }
  const owner = cache && cache.owner;
  if (owner) {
    try {
      const feed = parseFeed(await fetchText(`https://gist.githubusercontent.com/${owner}/${id}/raw/${FEED_FILE}?t=${Date.now()}`));
      writeCache("feed", { feed, owner });
      return { feed, error: null };
    } catch (e) { /* 兩種都失敗，回報第一個錯誤 */ }
  }
  return { feed: cache ? cache.feed : null, error: firstErr };
}

function parseClaude(feed) {
  const c = feed && feed.claude;
  if (!c || !c.rows) return { rows: [], at: null, error: "noclaude" };
  const rows = toArr(c.rows).map((r) => {
    if (r.kind === "session") return { label: "5 小時", used: clamp(r.used), reset: r.reset, order: 0 };
    if (r.kind === "weekly_all") return { label: "每週", used: clamp(r.used), reset: r.reset, order: 1 };
    return { label: `${r.model || "模型"} 週`, used: clamp(r.used), reset: r.reset, order: 2 };
  });
  rows.sort((a, b) => a.order - b.order);
  return {
    rows,
    at: c.fetched_at ? Date.parse(c.fetched_at) : null,
    error: c.error ? "pc" : null,
    expires: c.login_expires_at ? Date.parse(c.login_expires_at) : null,
  };
}

// Gemini App（gemini.google.com/usage）：「目前用量」和「每週上限」
function parseGeminiApp(feed) {
  const g = feed && feed.gemini_app;
  if (!g) return { rows: [], at: null, error: "nogemini" };
  const rows = [];
  // 用量頁寫「目前用量」，實際每 5 小時重設（2026-11-23→24 兩次重設時間差 20 小時＝4 個 5 小時）
  if (g.current) rows.push({ label: "5 小時", used: clamp(g.current.used), reset: g.current.reset || null });
  if (g.weekly) rows.push({ label: "每週", used: clamp(g.weekly.used), reset: g.weekly.reset || null });
  return { rows, at: g.fetched_at ? Date.parse(g.fetched_at) : null, error: g.error || null };
}

// Codex（codex app-server 的 account/rateLimits/read）：視窗長度依方案不同（免費版是每月）
function parseCodex(feed) {
  const c = feed && feed.codex;
  if (!c) return { rows: [], at: null, error: "nocodex" };
  const rows = toArr(c.rows).map((r) => ({ label: r.label || "額度", used: clamp(r.used), reset: r.reset || null }));
  return { rows, at: c.fetched_at ? Date.parse(c.fetched_at) : null, error: c.error || null, plan: c.plan || null };
}

// 參數 → 要顯示哪幾家：c=Claude、g=Gemini App、a=Antigravity、x=Codex
//   可以寫字母（"cgx"）或名稱（"codex"、"claude,codex"）
function paramLetters(param) {
  const p = String(param || "").toLowerCase().replace(/\ball\b/g, "").trim();
  if (!p) return [];
  const NAMES = { claude: "c", gemini: "g", antigravity: "a", agy: "a", codex: "x" };
  const words = p.split(/[\s,，、]+/).filter(Boolean);
  if (words.every((w) => NAMES[w])) return [...new Set(words.map((w) => NAMES[w]))];
  if (/^[cgax]{1,4}$/.test(p)) return [...new Set(p.split(""))];
  return [];
}

const SHORT = { "5 小時": "5h", "每週": "週", "每月": "月" };
function shortLabel(l) { return SHORT[l] || l; }

const AGY_GROUP_LABEL = {
  "Gemini Models": "Gemini",
  "Claude and GPT models": "Claude/GPT",
};

function agySource(feed) {
  if (!feed) return { groups: [], at: null, error: null };
  if (feed.agy) {
    return {
      groups: feed.agy.groups || [],
      at: feed.agy.fetched_at ? Date.parse(feed.agy.fetched_at) : null,
      error: feed.agy.error ? "pc" : null,
    };
  }
  // 舊版 (v1) 格式
  return { groups: feed.groups || [], at: feed.fetched_at ? Date.parse(feed.fetched_at) : null, error: null };
}

function parseAgy(groups, showAll) {
  const rows = [];
  for (const g of groups || []) {
    const isMain = g.name === "Gemini Models";
    const isThird = g.name === "Claude and GPT models";
    if (isThird && !showAll) continue;
    const prefix = AGY_GROUP_LABEL[g.name] || g.name.replace(/^Gemini\s+(\d+(\.\d+)?\s+)?/, "");
    for (const b of g.buckets || []) {
      if (b.disabled) continue; // 暫不適用的限制（例如 Claude/GPT 的 5 小時），不要顯示成 0%
      const win = b.window === "5h" ? "5 小時" : b.window === "weekly" ? "每週" : b.window;
      const label = isMain ? win : `${prefix} ${b.window === "5h" ? "5h" : "週"}`;
      const order = (isMain ? 0 : isThird ? 20 : 10) + (b.window === "5h" ? 0 : 1);
      rows.push({ label, used: clamp((1 - Number(b.remaining)) * 100), reset: b.reset || null, order });
    }
  }
  rows.sort((a, b) => a.order - b.order);
  return rows;
}

// ------------------------------------------------------------
//  工具函式
// ------------------------------------------------------------
// PowerShell 只有一筆資料時會存成單一物件而不是清單，兩種都要能讀
function toArr(x) { return Array.isArray(x) ? x : x ? [x] : []; }

function clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }

function colorFor(used, base) {
  if (used >= 90) return C_DANGER;
  if (used >= 70) return C_WARN;
  return base;
}

function untilText(iso) {
  if (!iso) return "";
  let ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "已重置";
  const m = Math.floor(ms / 60e3);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d > 0) return `${d}天${h}時`;
  if (h > 0) return `${h}時${mm}分`;
  return `${mm}分`;
}

// 鎖定畫面用的短倒數：不到 1 小時寫分鐘，不到 1 天寫小時（無條件捨去），其餘寫天
function lockUntil(iso) {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "已重置";
  const m = Math.floor(ms / 60e3);
  if (m < 60) return `${m}分`;
  if (m < 1440) return `${Math.floor(m / 60)}時`;
  return `${Math.floor(m / 1440)}天`;
}

function agoText(ts) {
  if (!ts) return "";
  const m = Math.floor((Date.now() - ts) / 60e3);
  if (m < 1) return "剛剛";
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時前`;
  return `${Math.floor(h / 24)}天前`;
}

function barImage(w, h, pct, color) {
  const ctx = new DrawContext();
  ctx.size = new Size(w, h);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const r = h / 2;
  const track = new Path();
  track.addRoundedRect(new Rect(0, 0, w, h), r, r);
  ctx.addPath(track);
  ctx.setFillColor(C_TRACK);
  ctx.fillPath();
  if (pct > 0) {
    const fw = Math.max(h, (w * pct) / 100);
    const fill = new Path();
    fill.addRoundedRect(new Rect(0, 0, fw, h), r, r);
    ctx.addPath(fill);
    ctx.setFillColor(color);
    ctx.fillPath();
  }
  return ctx.getImage();
}

function ringImage(size, pct, color) {
  const ctx = new DrawContext();
  ctx.size = new Size(size, size);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const lw = size * 0.12, c = size / 2, rad = c - lw / 2;
  const arc = (from, to, col) => {
    const pts = [];
    const steps = Math.max(2, Math.ceil((to - from) * 60));
    for (let i = 0; i <= steps; i++) {
      const a = -Math.PI / 2 + 2 * Math.PI * (from + ((to - from) * i) / steps);
      pts.push(new Point(c + rad * Math.cos(a), c + rad * Math.sin(a)));
    }
    const p = new Path();
    p.addLines(pts);
    ctx.addPath(p);
    ctx.setStrokeColor(col);
    ctx.setLineWidth(lw);
    ctx.strokePath();
  };
  arc(0, 1, new Color("#FFFFFF", 0.25));
  if (pct > 0) arc(0, pct / 100, color);
  return ctx.getImage();
}

const ERR_TEXT = {
  nourl: "尚未設定 FEED_URL",
  http404: "找不到 Gist（代號錯了？）",
  http403: "GitHub 暫時限制讀取",
  http429: "GitHub 暫時限制讀取",
  nofile: "Gist 裡沒有額度資料",
  noclaude: "電腦尚未上傳 Claude 資料",
  nogemini: "電腦尚未上傳 Gemini 資料",
  nocodex: "電腦尚未上傳 Codex 資料",
};

// ------------------------------------------------------------
//  畫面
// ------------------------------------------------------------
function addHeader(stack, title, color, note, noteColor) {
  const h = stack.addStack();
  h.centerAlignContent();
  const dot = h.addText("●");
  dot.font = Font.systemFont(8);
  dot.textColor = color;
  h.addSpacer(4);
  const t = h.addText(title);
  t.font = Font.boldSystemFont(12);
  t.textColor = C_TEXT;
  h.addSpacer();
  if (note) {
    const n = h.addText(note);
    n.font = Font.systemFont(9);
    n.textColor = noteColor || C_SUB;
    n.lineLimit = 1;
  }
}

function addRow(stack, row, base, width, compact) {
  const col = colorFor(row.used, base);
  const top = stack.addStack();
  top.centerAlignContent();
  const l = top.addText(row.label);
  l.font = Font.mediumSystemFont(compact ? 10 : 11);
  l.textColor = C_SUB;
  l.lineLimit = 1;
  top.addSpacer();
  // 重設倒數：所有尺寸都顯示（2026-11-24 使用者要求；精簡版字小一點）
  if (row.reset) {
    const r = top.addText(untilText(row.reset) + (compact ? " " : "  "));
    r.font = Font.systemFont(compact ? 8.5 : 9);
    r.textColor = C_SUB;
    r.lineLimit = 1;
  }
  const p = top.addText(row.used + "%");
  p.font = Font.boldMonospacedSystemFont(compact ? 11 : 12);
  p.textColor = col;
  stack.addSpacer(2);
  const img = stack.addImage(barImage(width, compact ? 4 : 5, row.used, col));
  img.imageSize = new Size(width, compact ? 4 : 5);
}

function addSection(stack, title, color, rows, note, noteColor, width, compact, errMsg) {
  addHeader(stack, title, color, note, noteColor);
  stack.addSpacer(compact ? 4 : 6);
  if (!rows || rows.length === 0) {
    const e = stack.addText(errMsg || "沒有資料");
    e.font = Font.systemFont(10);
    e.textColor = C_SUB;
    return;
  }
  rows.forEach((r, i) => {
    if (i > 0) stack.addSpacer(compact ? 4 : 6);
    addRow(stack, r, color, width, compact);
  });
}

// 右上角的小字：多久前更新、電腦離線、或電腦那邊讀取失敗
//   先判斷「手機讀不到 Gist」，再判斷「電腦太久沒上傳」，兩者不能混在一起
//   （2026-11-19 曾因帳號改名讀不到，卻誤顯示成電腦離線）
function sourceNote(at, srcError, netError) {
  if (netError) return { text: "讀取失敗" + (at ? " · " + agoText(at) : ""), color: C_WARN };
  if (!at) return { text: "", color: C_SUB };
  if (Date.now() - at > STALE_MIN * 60e3) return { text: "電腦離線 · " + agoText(at), color: C_WARN };
  if (srcError) return { text: "⚠︎ " + agoText(at), color: C_WARN };
  return { text: agoText(at), color: C_SUB };
}

// Claude 登入快到期（剩 EXPIRY_WARN_DAYS 天內）或已過期時的提醒文字，否則 null
function expiryText(expires) {
  if (!expires || !Number.isFinite(expires)) return null;
  const ms = expires - Date.now();
  if (ms <= 0) return "需重新登入";
  if (ms > EXPIRY_WARN_DAYS * 86400e3) return null;
  return "登入剩 " + untilText(new Date(expires).toISOString());
}

function pick(rows, labels) {
  return (rows || []).filter((r) => labels.includes(r.label));
}

async function buildWidget(family, param) {
  const showAll = /\ball\b/i.test(param);
  const { feed, error: netErr } = await getFeed();
  const claude = parseClaude(feed);
  const agy = agySource(feed);
  const app = parseGeminiApp(feed);
  const codex = parseCodex(feed);
  const noData = ERR_TEXT[netErr] || (netErr ? "讀取失敗" : null);
  const exp = expiryText(claude.expires);
  const loginNote = (src, who) => (src.error === "login" && !netErr ? { text: who + " 需重新登入", color: C_DANGER } : null);

  // 四家的資料整理成同一種格式
  const P = {
    c: { name: "Claude", lock: "Claude", short: "C", color: C_CLAUDE, rows: claude.rows, first: "5 小時",
         note: exp ? { text: exp, color: C_DANGER } : sourceNote(claude.at, claude.error === "pc", netErr),
         err: noData || ERR_TEXT[claude.error] || null },
    g: { name: "Gemini", lock: "Gemini", short: "G", color: C_GEMINI, rows: app.rows, first: "5 小時",
         note: loginNote(app, "Google") || sourceNote(app.at, app.error && app.error !== "nogemini", netErr),
         err: noData || (app.error === "nogemini" ? ERR_TEXT.nogemini : null) },
    a: { name: "Antigravity", lock: "Antigravity", short: "A", color: C_AGY, first: "5 小時",
         rows: pick(parseAgy(agy.groups, false), ["5 小時", "每週"]), allRows: parseAgy(agy.groups, true),
         note: sourceNote(agy.at, agy.error, netErr), err: noData },
    x: { name: "Codex", lock: "Codex", short: "Cx", color: C_CODEX, rows: codex.rows, first: null,
         note: loginNote(codex, "Codex") || sourceNote(codex.at, codex.error && codex.error !== "nocodex", netErr),
         err: noData || (codex.error === "nocodex" ? ERR_TEXT.nocodex : null) },
  };
  const firstRow = (k) => (P[k].first ? pick(P[k].rows, [P[k].first])[0] : null) || P[k].rows[0];
  const pct = (r) => (r ? r.used + "%" : "—");
  const letters = paramLetters(param);
  const section = (stack, k, rows, width, compact) =>
    addSection(stack, P[k].name, P[k].color, rows, P[k].note.text, P[k].note.color, width, compact, P[k].err);
  const two = (k) => P[k].rows.slice(0, 2);

  const w = new ListWidget();
  w.refreshAfterDate = new Date(Date.now() + 15 * 60e3);

  // ---------- 鎖定畫面 ----------
  if (family === "accessoryInline") {
    const ks = letters.length ? letters : ["c", "g", "a"];
    w.addText(ks.map((k) => `${P[k].short} ${pct(firstRow(k))}`).join(" · "));
    return w;
  }
  if (family === "accessoryCircular") {
    const k = letters[0] || "c";
    const r = firstRow(k);
    w.addAccessoryWidgetBackground = true;
    const s = w.addStack();
    s.layoutVertically();
    s.centerAlignContent();
    const img = s.addImage(ringImage(56, r ? r.used : 0, Color.white()));
    img.imageSize = new Size(44, 44);
    img.centerAlignImage();
    const t = s.addText(`${P[k].short} ${r ? r.used : "—"}`);
    t.font = Font.boldSystemFont(11);
    t.centerAlignText();
    return w;
  }
  if (family === "accessoryRectangular") {
    const ks = (letters.length ? letters : ["c", "g", "a"]).slice(0, exp ? 2 : 3); // 登入快到期的提醒比第三家重要
    for (const k of ks) {
      // 不寫「5h／週」，改放重設倒數（短的是 5 小時、長的是每週／每月）（2026-11-24 使用者要求）
      // 倒數只寫到小時或天：完整寫法（4時59分）最長要縮到 60%，超過 iPhone 的 70% 下限會被切掉
      const parts = two(k).map((r) => `${pct(r)} ${r.reset ? lockUntil(r.reset) : ""}`.trim());
      const t = w.addText(`${P[k].lock} ${parts.length ? parts.join(" ") : "—"}`);
      t.font = Font.semiboldSystemFont(13);
      t.lineLimit = 1;
      t.minimumScaleFactor = 0.7;
    }
    if (exp) {
      const t = w.addText("⚠︎ Claude " + exp);
      t.font = Font.semiboldSystemFont(11);
    }
    return w;
  }

  // ---------- 主畫面 ----------
  w.backgroundColor = C_BG;

  if (family === "small") {
    // 預設 Claude + Gemini App；參數可換第二家（例如 codex），或指定兩家（例如 gx）
    const ks = letters.length >= 2 ? letters.slice(0, 2)
      : letters.length === 1 && letters[0] !== "c" ? ["c", letters[0]] : ["c", "g"];
    w.setPadding(10, 12, 10, 12);
    section(w, ks[0], two(ks[0]), 128, true);
    w.addSpacer();
    section(w, ks[1], two(ks[1]), 128, true);
    return w;
  }

  if (family === "large") {
    w.setPadding(14, 16, 14, 16);
    const width = 290;
    section(w, "c", P.c.rows, width, false);
    w.addSpacer(10);
    section(w, "g", P.g.rows, width, false);
    w.addSpacer(10);
    section(w, "a", showAll ? P.a.allRows : P.a.allRows.filter((r) => !/^Claude\/GPT/.test(r.label)), width, true);
    w.addSpacer(10);
    section(w, "x", P.x.rows, width, true);
    w.addSpacer();
    return w;
  }

  // medium（預設）：2×2，左 Claude / Codex，右 Gemini / Antigravity（精簡版，字小一點，含重設倒數）
  // 間距依 2026-11-24 實機截圖調整：原本上下兩組只隔 4 點，底下空了 24.5 點
  const GROUP_GAP = 14;
  w.setPadding(14, 14, 10, 14);
  const row = w.addStack();
  row.topAlignContent();
  const width = 138;
  const left = row.addStack();
  left.layoutVertically();
  section(left, "c", pick(P.c.rows, ["5 小時", "每週"]), width, true);
  left.addSpacer(GROUP_GAP);
  section(left, "x", two("x"), width, true);
  row.addSpacer(16);
  const right = row.addStack();
  right.layoutVertically();
  section(right, "g", two("g"), width, true);
  right.addSpacer(GROUP_GAP);
  section(right, "a", P.a.rows, width, true);
  w.addSpacer();
  return w;
}

if (config.runsInWidget) {
  const w = await buildWidget(config.widgetFamily || "medium", args.widgetParameter || "");
  Script.setWidget(w);
} else {
  // 在 App 內執行：顯示中尺寸預覽
  const w = await buildWidget("medium", "");
  await w.presentMedium();
}
Script.complete();
