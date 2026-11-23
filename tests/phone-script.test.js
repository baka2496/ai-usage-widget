// 檢查「要貼到手機的檔案」本身：語法正確（照 Scriptable 的方式，最外層不能 return）、
// 中文沒有變亂碼、手機版和公開版只差 FEED_URL 那一行。
// 用法：node tests/phone-script.test.js
// 2026-11-24：手機版被 PowerShell 存成亂碼，Scriptable 顯示「Error on line 70: SyntaxError」，
//             原本的測試只測公開版、而且包在函式裡執行，所以沒抓到。
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const dir = path.join(__dirname, "..", "iphone");
const files = ["AI-Usage.js", "AI-Usage.mine.js"].filter((f) => fs.existsSync(path.join(dir, f)));
const pub = fs.readFileSync(path.join(dir, "AI-Usage.js"), "utf8");
let fail = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : " — " + detail}`); if (!ok) fail++; };

for (const f of files) {
  const buf = fs.readFileSync(path.join(dir, f));
  const text = buf.toString("utf8");
  // 1. 語法：當成模組檢查（允許最外層 await，不允許最外層 return，跟 Scriptable 一樣）
  let err = "";
  try { execFileSync(process.execPath, ["--input-type=module", "--check"], { input: text, stdio: ["pipe", "pipe", "pipe"] }); }
  catch (e) { err = String(e.stderr || e.message).split("\n").find((l) => /Error/.test(l)) || "語法錯誤"; }
  check(`${f}：語法正確（Scriptable 能執行）`, !err, err);
  // 2. 編碼：UTF-8、沒有亂碼字元、中文註解還在
  check(`${f}：是 UTF-8，中文沒有變亂碼`, !text.includes("�") && text.includes("小工具參數") && text.includes("讀 Gist"), "找不到正常的中文");
}
if (files.includes("AI-Usage.mine.js")) {
  const mine = fs.readFileSync(path.join(dir, "AI-Usage.mine.js"), "utf8");
  const norm = (s) => s.replace(/^﻿/, "").replace(/^const FEED_URL = ".*";$/m, 'const FEED_URL = "";');
  check("手機版和公開版只差 FEED_URL（不是舊版）", norm(mine) === pub, "內容不同，請執行 node tests/make-mine.js 重新產生");
  check("手機版有填 Gist 代號", /^const FEED_URL = "[0-9a-f]{32}";$/m.test(mine), "FEED_URL 是空的");
}
console.log(fail ? `\n${fail} 項失敗` : "\n全部通過");
process.exit(fail ? 1 : 0);
