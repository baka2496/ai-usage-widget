// 小工具自動測試：在模擬的 Scriptable 環境執行 iphone/AI-Usage.js，檢查畫面上的文字。
// 用法：node tests/widget.test.js     （不需要安裝任何套件）
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = fs.readFileSync(path.join(__dirname, "..", "iphone", "AI-Usage.js"), "utf8");
const GIST = "0123456789abcdef0123456789abcdef";
const iso = (ms) => new Date(Date.now() + ms).toISOString().replace(/\.\d+Z$/, "Z");
const H = 3600e3, D = 86400e3;

function sampleFeed({ fetchedAgo = 0, expiresIn = 20 * D, gemini = true, geminiError = null, codex = true, codexRows } = {}) {
  const at = iso(-fetchedAgo);
  return {
    v: 2, fetched_at: at,
    agy: { fetched_at: at, error: null, groups: [
      { name: "Gemini Models", buckets: [
        { id: "gemini-weekly", window: "weekly", remaining: 0.98, reset: iso(6 * D) },
        { id: "gemini-5h", window: "5h", remaining: 1, reset: iso(2 * H) } ] },
      { name: "Gemini 4 Argon", buckets: [
        { id: "argon", window: "weekly", remaining: 1, reset: iso(6 * D) } ] } ] },
    claude: { fetched_at: at, error: null, login_expires_at: iso(expiresIn), rows: [
      { kind: "session", model: null, used: 30, reset: iso(1 * H) },
      { kind: "weekly_all", model: null, used: 76, reset: iso(3 * D) } ] },
    ...(gemini ? { gemini_app: { fetched_at: at, error: geminiError,
      current: { used: 26, reset: iso(3 * H) }, weekly: { used: 16, reset: iso(2 * D) } } } : {}),
    // 2026-11-24 實際讀到的 Codex 免費方案：只有一筆「每月」，PowerShell 存成單一物件（不是清單）
    ...(codex ? { codex: { fetched_at: at, error: null, plan: "free",
      rows: codexRows || { label: "每月", mins: 43200, used: 2, reset: iso(22 * D) } } } : {}),
  };
}

// routes: { "api": {code, body} , "raw:<owner>": {code, body} }
function run({ feedUrl = GIST, routes = {}, cache = null, family = "medium", param = "" }) {
  const store = {};
  if (cache) store["/d/ai-usage-widget/feed.json"] = JSON.stringify(cache);
  const requested = [];
  const texts = [];
  const mk = () => new Proxy({ children: [] }, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === "then") return undefined;
      if (k === "addStack") return () => { const s = mk(); t.children.push(s); return s; };
      if (k === "addText") return (x) => { texts.push(String(x)); return new Proxy({}, { get: () => () => {}, set: () => true }); };
      if (k === "addImage") return () => new Proxy({}, { get: () => () => {}, set: () => true });
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  function Request(url) {
    this.url = url; requested.push(url);
    this.loadString = async () => {
      let route;
      if (url.startsWith("https://api.github.com/gists/")) route = routes.api;
      else {
        const m = url.match(/^https:\/\/gist\.githubusercontent\.com\/([^/]+)\//);
        route = m && routes["raw:" + m[1]];
      }
      if (!route) throw new Error("network");
      this.response = { statusCode: route.code };
      return typeof route.body === "string" ? route.body : JSON.stringify(route.body);
    };
  }
  const ctx = {
    console, Date, Math, JSON, Number, String, Array, Object, Error, Promise,
    ListWidget: function () { return mk(); },
    Color: Object.assign(function () {}, { dynamic: (a) => a, white: () => ({}) }),
    Font: new Proxy({}, { get: () => () => ({}) }),
    Size: function () {}, Rect: function () {}, Point: function () {},
    Path: function () { this.addRoundedRect = () => {}; this.addLines = () => {}; },
    DrawContext: function () { return new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === "getImage" ? () => ({}) : () => {}), set: (t, k, v) => ((t[k] = v), true) }); },
    FileManager: { local: () => ({
      documentsDirectory: () => "/d", joinPath: (a, b) => a + "/" + b,
      fileExists: (p) => p in store || p === "/d/ai-usage-widget", createDirectory() {},
      readString: (p) => store[p], writeString: (p, s) => { store[p] = s; } }) },
    Request,
    config: { runsInWidget: true, widgetFamily: family },
    args: { widgetParameter: param },
    Script: { setWidget() {}, complete() {} },
  };
  vm.createContext(ctx);
  const code = SRC.replace(/const FEED_URL = ".*";/, `const FEED_URL = ${JSON.stringify(feedUrl)};`);
  return vm.runInContext("(async()=>{" + code + "\n})()", ctx).then(() => ({
    texts, requested, cache: store["/d/ai-usage-widget/feed.json"] && JSON.parse(store["/d/ai-usage-widget/feed.json"]),
  }));
}

const apiOk = (feed) => ({ code: 200, body: { owner: { login: "newname" }, files: { "agy-usage.json": { truncated: false, content: JSON.stringify(feed) } } } });

const cases = [
  ["正常讀取：顯示 Claude、Gemini、Antigravity、Codex 的數字，右上角是「剛剛」", async () => {
    const r = await run({ routes: { api: apiOk(sampleFeed()) } });
    return r.texts.includes("30%") && r.texts.includes("76%") && r.texts.includes("剛剛") && !r.texts.some((t) => /離線|失敗/.test(t));
  }],
  ["只靠 Gist 代號讀取，網址裡沒有帳號名稱", async () => {
    const r = await run({ routes: { api: apiOk(sampleFeed()) } });
    return r.requested[0] === `https://api.github.com/gists/${GIST}`;
  }],
  ["貼舊帳號的完整網址也能用（帳號改名後，2026-11-19 的情況）", async () => {
    const r = await run({ feedUrl: `https://gist.githubusercontent.com/oldname/${GIST}/raw/agy-usage.json`, routes: { api: apiOk(sampleFeed()), "raw:oldname": { code: 404, body: "404: Not Found" } } });
    return r.texts.includes("30%") && r.texts.includes("剛剛") && !r.requested.some((u) => u.includes("oldname"));
  }],
  ["記下新的擁有者名稱，供備用網址使用", async () => {
    const r = await run({ routes: { api: apiOk(sampleFeed()) } });
    return r.cache && r.cache.owner === "newname";
  }],
  ["API 次數用完（403）時，改用備用網址讀到資料", async () => {
    const r = await run({ routes: { api: { code: 403, body: "{}" }, "raw:newname": { code: 200, body: sampleFeed() } }, cache: { feed: sampleFeed({ fetchedAgo: 2 * H }), owner: "newname" } });
    return r.texts.includes("剛剛") && !r.texts.some((t) => /失敗|離線/.test(t));
  }],
  ["讀不到但有舊資料：顯示「讀取失敗」，不能誤顯示「電腦離線」", async () => {
    const r = await run({ routes: { api: { code: 404, body: "{}" } }, cache: { feed: sampleFeed({ fetchedAgo: 6 * H }) } });
    return r.texts.some((t) => t.startsWith("讀取失敗 · 6時前")) && !r.texts.some((t) => t.includes("電腦離線"));
  }],
  ["讀不到也沒有舊資料：顯示原因", async () => {
    const r = await run({ routes: { api: { code: 404, body: "{}" } } });
    return r.texts.includes("找不到 Gist（代號錯了？）");
  }],
  ["讀得到但電腦 2 小時沒上傳：才顯示「電腦離線」", async () => {
    const r = await run({ routes: { api: apiOk(sampleFeed({ fetchedAgo: 2 * H })) } });
    return r.texts.some((t) => t.startsWith("電腦離線 · 2時前")) && !r.texts.some((t) => t.includes("讀取失敗"));
  }],
  ["還沒設定 FEED_URL：提示要設定", async () => {
    const r = await run({ feedUrl: "", routes: {} });
    return r.texts.includes("尚未設定 FEED_URL");
  }],
  ["Claude 登入剩 2 天：顯示紅字提醒", async () => {
    const r = await run({ routes: { api: apiOk(sampleFeed({ expiresIn: 2 * D + H })) } });
    return r.texts.some((t) => t.startsWith("登入剩 2天"));
  }],
  ["Antigravity 標成 Antigravity、Gemini 標成 Gemini，不會混在一起（2026-11-22 的誤會）", async () => {
    // Antigravity 的數字是 0%（剩 98%/100%），Gemini 是 26%/16%
    for (const f of ["medium", "large"]) {
      const r = await run({ family: f, routes: { api: apiOk(sampleFeed()) } });
      const ai = r.texts.indexOf("Antigravity"), gi = r.texts.indexOf("Gemini");
      if (ai < 0 || gi < 0 || ai < gi) return false;
      const gSeg = r.texts.slice(gi, ai);
      if (!gSeg.includes("26%") || !gSeg.includes("16%")) return false;
      if (r.texts.slice(ai).includes("26%")) return false;
    }
    return true;
  }],
  ["Gemini 的第一筆標成「5 小時」，不寫「目前」（2026-11-24 使用者要求）", async () => {
    const r = await run({ family: "large", routes: { api: apiOk(sampleFeed()) } });
    const i = r.texts.indexOf("Gemini");
    return r.texts[i + 2] === "5 小時" && !r.texts.includes("目前");
  }],
  ["中、小、大尺寸每一列都有重設倒數（2026-11-24 使用者要求）", async () => {
    // sampleFeed 的重設時間：Claude 1 小時／3 天、Gemini 3 小時／2 天、Antigravity 2 小時／6 天、Codex 22 天
    const want = { medium: ["59分", "2天23時", "21天23時", "2時59分", "1天23時", "1時59分", "5天23時"],
                   small: ["59分", "2天23時", "2時59分", "1天23時"] };
    for (const [f, list] of Object.entries(want)) {
      const r = await run({ family: f, routes: { api: apiOk(sampleFeed()) } });
      const texts = r.texts.map((t) => t.trim());
      if (!list.every((x) => texts.includes(x))) return false;
    }
    const lg = await run({ family: "large", routes: { api: apiOk(sampleFeed()) } });
    return lg.texts.map((t) => t.trim()).includes("21天23時"); // 大尺寸的 Codex 也有
  }],
  ["鎖定畫面長方形：不寫 5h／週，改顯示重設倒數（2026-11-24 使用者要求）", async () => {
    const r = await run({ family: "accessoryRectangular", routes: { api: apiOk(sampleFeed()) } });
    return r.texts.length === 3 && r.texts.every((t) => !/ 5h | 週 /.test(t) && /\d+(分|時|天)/.test(t));
  }],
  ["標題只寫「Gemini」，不寫「Gemini App」（2026-11-24 使用者要求）", async () => {
    for (const f of ["small", "medium", "large", "accessoryRectangular", "accessoryInline"]) {
      const r = await run({ family: f, routes: { api: apiOk(sampleFeed()) } });
      if (r.texts.some((t) => t.includes("Gemini App"))) return false;
    }
    return true;
  }],
  ["小尺寸：預設顯示 Gemini，參數 antigravity 改顯示 Antigravity", async () => {
    const a = await run({ family: "small", routes: { api: apiOk(sampleFeed()) } });
    const b = await run({ family: "small", param: "antigravity", routes: { api: apiOk(sampleFeed()) } });
    return a.texts.includes("Gemini") && a.texts.includes("26%") && !a.texts.includes("Antigravity")
      && b.texts.includes("Antigravity") && !b.texts.includes("Gemini");
  }],
  ["鎖定畫面：單行 C·G·A 三個數字、長方形三行", async () => {
    const i = await run({ family: "accessoryInline", routes: { api: apiOk(sampleFeed()) } });
    const r = await run({ family: "accessoryRectangular", routes: { api: apiOk(sampleFeed()) } });
    return i.texts[0] === "C 30% · G 26% · A 0%"
      && r.texts.includes("Claude 30% 59分 76% 2天") && r.texts.includes("Gemini 26% 2時 16% 1天") && r.texts.includes("Antigravity 0% 1時 2% 5天");
  }],
  ["鎖定畫面圓形：gemini → Gemini、antigravity → Antigravity、預設 Claude", async () => {
    const t = async (param) => (await run({ family: "accessoryCircular", param, routes: { api: apiOk(sampleFeed()) } })).texts.join("|");
    return (await t("gemini")) === "G 26" && (await t("antigravity")) === "A 0" && (await t("")) === "C 30";
  }],
  ["Google 登入過期：Gemini 顯示紅字「Google 需重新登入」", async () => {
    const r = await run({ routes: { api: apiOk(sampleFeed({ geminiError: "login" })) } });
    return r.texts.includes("Google 需重新登入");
  }],
  ["電腦還沒上傳 Gemini 資料（舊版 Gist）：顯示說明，不顯示假的 0%", async () => {
    const r = await run({ routes: { api: apiOk(sampleFeed({ gemini: false })) } });
    return r.texts.includes("電腦尚未上傳 Gemini 資料");
  }],
  ["Codex：只有一筆額度、而且被存成單一物件，也讀得到（2026-11-24 的情況）", async () => {
    const r = await run({ family: "medium", routes: { api: apiOk(sampleFeed()) } });
    const i = r.texts.indexOf("Codex");
    return i >= 0 && r.texts.slice(i).includes("每月") && r.texts.slice(i).includes("2%");
  }],
  ["中尺寸 2×2：Claude、Codex、Gemini、Antigravity 都有", async () => {
    const r = await run({ family: "medium", routes: { api: apiOk(sampleFeed()) } });
    return ["Claude", "Codex", "Gemini", "Antigravity"].every((n) => r.texts.includes(n));
  }],
  ["大尺寸：四家都有", async () => {
    const r = await run({ family: "large", routes: { api: apiOk(sampleFeed()) } });
    return ["Claude", "Codex", "Gemini", "Antigravity"].every((n) => r.texts.includes(n));
  }],
  ["Codex 有 5 小時和每週兩筆（付費方案）時兩筆都顯示", async () => {
    const rows = [{ label: "5 小時", used: 40, reset: iso(H) }, { label: "每週", used: 12, reset: iso(3 * D) }];
    const r = await run({ family: "accessoryRectangular", param: "cx", routes: { api: apiOk(sampleFeed({ codexRows: rows })) } });
    return r.texts.includes("Codex 40% 59分 12% 2天");
  }],
  ["參數：小尺寸 codex、單行 cgax、圓形 codex", async () => {
    const f = apiOk(sampleFeed());
    const sm = await run({ family: "small", param: "codex", routes: { api: f } });
    const il = await run({ family: "accessoryInline", param: "cgax", routes: { api: f } });
    const ci = await run({ family: "accessoryCircular", param: "codex", routes: { api: f } });
    return sm.texts.includes("Codex") && !sm.texts.includes("Gemini")
      && il.texts[0] === "C 30% · G 26% · A 0% · Cx 2%" && ci.texts.join("|") === "Cx 2";
  }],
  ["電腦還沒上傳 Codex 資料：顯示說明", async () => {
    const r = await run({ routes: { api: apiOk(sampleFeed({ codex: false })) } });
    return r.texts.includes("電腦尚未上傳 Codex 資料");
  }],
  ["停用的額度（disabled）不顯示，不能變成 0%", async () => {
    const feed = sampleFeed();
    feed.agy.groups.push({ name: "Claude and GPT models", buckets: [
      { id: "3p-5h", window: "5h", remaining: 1, reset: "", disabled: true },
      { id: "3p-weekly", window: "weekly", remaining: 0.6, reset: iso(5 * D), disabled: false } ] });
    const r = await run({ family: "large", param: "all", routes: { api: apiOk(feed) } });
    return !r.texts.includes("Claude/GPT 5h") && r.texts.includes("Claude/GPT 週") && r.texts.includes("40%");
  }],
  ["所有尺寸都畫得出來（小/中/大/鎖定畫面三種）", async () => {
    for (const f of ["small", "medium", "large", "accessoryRectangular", "accessoryCircular", "accessoryInline"]) {
      const r = await run({ family: f, routes: { api: apiOk(sampleFeed()) } });
      if (!r.texts.length) return false;
    }
    return true;
  }],
];

(async () => {
  let fail = 0;
  for (const [name, fn] of cases) {
    let ok = false, err = "";
    try { ok = await fn(); } catch (e) { err = " — " + e.message; }
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${err}`);
    if (!ok) fail++;
  }
  console.log(fail ? `\n${fail} 項失敗` : `\n全部 ${cases.length} 項通過`);
  process.exit(fail ? 1 : 0);
})();
