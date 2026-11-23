// 產生填好 Gist 代號的手機版 iphone/AI-Usage.mine.js（這個檔案不會上傳到 GitHub）。
// 用法：node tests/make-mine.js            （代號從 %USERPROFILE%\ai-usage-widget\config.json 讀）
// 一律用 UTF-8 讀寫。2026-11-24 曾用 PowerShell 產生，中文變亂碼、程式壞掉（第 70 行 SyntaxError）。
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");

const root = path.join(__dirname, "..");
const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), "ai-usage-widget", "config.json"), "utf8").replace(/^﻿/, ""));
if (!/^[0-9a-f]{32}$/i.test(cfg.gist_id || "")) throw new Error("config.json 裡沒有 gist_id");
const src = fs.readFileSync(path.join(root, "iphone", "AI-Usage.js"), "utf8");
const out = src.replace(/^const FEED_URL = "";$/m, `const FEED_URL = "${cfg.gist_id}";`);
if (out === src) throw new Error("找不到 FEED_URL 那一行");
fs.writeFileSync(path.join(root, "iphone", "AI-Usage.mine.js"), out, "utf8");
console.log("已產生 iphone/AI-Usage.mine.js");
