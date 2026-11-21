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

function sampleFeed({ fetchedAgo = 0, expiresIn = 20 * D } = {}) {
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
  ["正常讀取：顯示 Claude 和 Antigravity 的數字，右上角是「剛剛」", async () => {
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
  ["標題寫 Antigravity，不寫 Gemini（Gemini App 是另一個額度，2026-11-22 的誤會）", async () => {
    for (const f of ["small", "medium", "large", "accessoryRectangular", "accessoryInline", "accessoryCircular"]) {
      const r = await run({ family: f, param: "antigravity", routes: { api: apiOk(sampleFeed()) } });
      if (r.texts.some((t) => /Gemini|\bG \d|^G /.test(t))) return false;
      const want = f === "accessoryInline" ? /· A / : f === "accessoryCircular" ? /^A / : /^Antigravity/;
      if (!r.texts.some((t) => want.test(t))) return false;
    }
    return true;
  }],
  ["停用的額度（disabled）不顯示，不能變成 0%", async () => {
    const feed = sampleFeed();
    feed.agy.groups.push({ name: "Claude and GPT models", buckets: [
      { id: "3p-5h", window: "5h", remaining: 1, reset: "", disabled: true },
      { id: "3p-weekly", window: "weekly", remaining: 0.6, reset: iso(5 * D), disabled: false } ] });
    const r = await run({ family: "large", routes: { api: apiOk(feed) } });
    return !r.texts.includes("Claude/GPT 5h") && r.texts.includes("Claude/GPT 週") && r.texts.includes("40%");
  }],
  ["鎖定畫面圓形的舊參數 gemini 仍然顯示 Antigravity 額度", async () => {
    const r = await run({ family: "accessoryCircular", param: "gemini", routes: { api: apiOk(sampleFeed()) } });
    return r.texts.includes("A 0");
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
