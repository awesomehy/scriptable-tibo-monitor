// Variables used by Scriptable.
// icon-color: deep-green; icon-glyph: rss;
// TIBO_MONITOR_WIDGET
// version: 1.0.3

// 在 Scriptable 中直接运行可预览、更新或恢复脚本。
// 小组件 Parameter 示例：{"count":2,"refreshMinutes":10,"theme":"auto"}
// 配置放在小组件 Parameter 中，更新代码不会覆盖配置。
const VERSION = "1.0.3";
const SITE = "https://tibo-monitor.hhyan.me";
const REPOSITORY = "awesomehy/scriptable-tibo-monitor";
const BRANCH = "main";
const DEFAULTS = { counts: { small: 1, medium: 3, large: 6 }, refreshMinutes: 10, language: "zh", theme: "auto" };
const LIMITS = { small: 2, medium: 3, large: 7 };
const localFiles = FileManager.local();
const dataDirectory = localFiles.joinPath(localFiles.documentsDirectory(), "TiboMonitorWidget");
const legacyDataDirectory = localFiles.joinPath(localFiles.libraryDirectory(), "TiboMonitorWidget");

function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function validDate(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function failure(message, retryAt) { const error = new Error(message); error.retryAt = retryAt || 0; return error; }
function errorText(error) { return String(error?.message || error); }
function ensureDirectory() { if (!localFiles.fileExists(dataDirectory)) localFiles.createDirectory(dataDirectory, true); }
function readLocal(name, fallback) {
  // 优先读取本地 Documents，兼容旧版 Library 中的消息缓存和更新备份。
  for (const directory of [dataDirectory, legacyDataDirectory]) {
    try { return JSON.parse(localFiles.readString(localFiles.joinPath(directory, name))); } catch (_) {}
  }
  return fallback;
}
function writeLocal(name, value) {
  const path = localFiles.joinPath(dataDirectory, name);
  // writeString 明确支持覆盖写入，避免依赖 move 替换和共享同名临时文件。
  let previous = null, attempted = false;
  try {
    const content = JSON.stringify(value);
    if (typeof content !== "string") throw failure("内容无法序列化");
    ensureDirectory();
    if (localFiles.fileExists(path)) {
      previous = localFiles.readString(path);
      if (typeof previous !== "string") throw failure("无法读取原文件");
    }
    attempted = true;
    localFiles.writeString(path, content);
    if (localFiles.readString(path) !== content) throw failure("写入回读校验失败");
  } catch (error) {
    let recovery = "";
    if (attempted) {
      try {
        if (previous === null) { if (localFiles.fileExists(path)) localFiles.remove(path); }
        else {
          let current = null;
          try { current = localFiles.readString(path); } catch (_) {}
          if (current !== previous) {
            localFiles.writeString(path, previous);
            if (localFiles.readString(path) !== previous) throw failure("恢复回读校验失败");
          }
        }
      } catch (restoreError) { recovery = "；恢复原文件失败：" + errorText(restoreError); }
    }
    throw failure("保存 " + name + " 失败：" + errorText(error) + recovery);
  }
}

function settingsFor(parameter, family) {
  let input = {};
  if (parameter !== null && parameter !== undefined && parameter !== "") {
    try { input = typeof parameter === "string" ? JSON.parse(parameter) : parameter; }
    catch (_) { throw failure('Parameter 需为数字或 JSON，例如 {"count":2}'); }
    if (typeof input === "number") input = { count: input };
    if (!isObject(input)) throw failure("Parameter 需为数字或 JSON 对象");
  }
  const settings = { ...DEFAULTS, counts: { ...DEFAULTS.counts } };
  const integer = (value, minimum, maximum, name) => {
    if (!Number.isInteger(value) || value < minimum || value > maximum) throw failure(name + " 需为 " + minimum + "–" + maximum + " 的整数");
    return value;
  };
  if (input.counts !== undefined) {
    if (!isObject(input.counts)) throw failure("counts 需为 JSON 对象");
    for (const key of Object.keys(input.counts)) {
      if (!LIMITS[key]) throw failure("不支持的组件尺寸：" + key);
      settings.counts[key] = integer(input.counts[key], 1, LIMITS[key], key);
    }
  }
  if (input.count !== undefined) settings.counts[family] = integer(input.count, 1, LIMITS[family], "count");
  if (input.refreshMinutes !== undefined) settings.refreshMinutes = integer(input.refreshMinutes, 1, 1440, "refreshMinutes");
  for (const [key, values] of [["language", ["zh", "en"]], ["theme", ["auto", "light", "dark"]]]) {
    if (input[key] !== undefined) {
      if (!values.includes(input[key])) throw failure(key + " 可选：" + values.join(" / "));
      settings[key] = input[key];
    }
  }
  settings.count = settings.counts[family];
  return settings;
}

function comparePosts(a, b) {
  const dateOrder = Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
  if (dateOrder) return dateOrder;
  if (a.id.length !== b.id.length) return b.id.length - a.id.length;
  return a.id === b.id ? 0 : a.id > b.id ? -1 : 1;
}

function validateTweets(payload) {
  if (!isObject(payload) || !Array.isArray(payload.tweets) || payload.tweets.length > 50) throw failure("消息接口格式发生变化");
  const ids = new Set();
  const tweets = payload.tweets.map(tweet => {
    if (!isObject(tweet) || typeof tweet.id !== "string" || !/^[1-9]\d{0,24}$/.test(tweet.id) ||
        typeof tweet.text !== "string" || !tweet.text.trim() || !validDate(tweet.publishedAt) ||
        typeof tweet.url !== "string" || typeof tweet.isDemo !== "boolean" || ids.has(tweet.id)) throw failure("消息接口包含无效记录");
    ids.add(tweet.id);
    return { id: tweet.id, text: tweet.text, url: tweet.url, publishedAt: tweet.publishedAt,
      isDemo: tweet.isDemo, translation: tweet.translation || null, resetClassification: tweet.resetClassification || null };
  });
  return tweets.sort(comparePosts);
}

function validateStatus(payload) {
  const states = ["unconfigured", "healthy", "degraded", "unavailable", "demo", "paused"];
  if (!isObject(payload) || !isObject(payload.source) || !states.includes(payload.source.state) ||
      !(payload.source.lastSuccessAt === null || validDate(payload.source.lastSuccessAt))) throw failure("采集状态接口格式发生变化");
  return { source: { state: payload.source.state, lastSuccessAt: payload.source.lastSuccessAt,
    backoffActive: payload.source.backoffActive === true, requiresAttention: payload.source.requiresAttention === true },
    intervalMinutes: Number.isFinite(payload.intervalMinutes) ? payload.intervalMinutes : 5, demo: payload.demo === true };
}

function retryDeadline(headers, now) {
  const key = Object.keys(headers || {}).find(key => key.toLowerCase() === "retry-after");
  const value = key ? String(headers[key]).trim() : "";
  if (/^\d+$/.test(value)) return now + Math.max(1, Number(value)) * 1000;
  const deadline = Date.parse(value);
  return Number.isFinite(deadline) && deadline > now ? deadline : now + 15 * 60000;
}

async function downloadText(url, timeout, headers) {
  const request = new Request(url);
  request.timeoutInterval = timeout || 12;
  request.headers = { Accept: "application/json, text/plain;q=0.9", "Cache-Control": "no-cache", "User-Agent": "Scriptable-TiboMonitor/" + VERSION, ...(headers || {}) };
  request.onRedirect = () => null;
  let content, transportFailed = false;
  try { content = await request.loadString(); } catch (_) { transportFailed = true; }
  const status = request.response && request.response.statusCode;
  if (status === 429) throw failure("请求限流，等待后重试", retryDeadline(request.response.headers, Date.now()));
  if (!status) throw failure("网络连接失败");
  if (status < 200 || status >= 300) throw failure("接口请求失败（HTTP " + status + "）");
  if (transportFailed) throw failure("网络连接失败");
  if (typeof content !== "string" || content.length > 1024 * 1024) throw failure("下载内容过大或无效");
  return content;
}

function parseJSON(text) {
  try { return JSON.parse(text); } catch (_) { throw failure("接口未返回有效 JSON"); }
}

async function loadSnapshot(settings, force) {
  const cached = readLocal("snapshot.json", null);
  const state = { version: 1, tweets: null, status: null, tweetsAt: null, statusAt: null,
    attempts: {}, errors: {}, retryAt: {} };
  if (cached && cached.version === 1) {
    try {
      if (cached.tweets !== null) state.tweets = validateTweets({ tweets: cached.tweets });
      if (cached.status !== null) state.status = validateStatus(cached.status);
      state.tweetsAt = state.tweets && validDate(cached.tweetsAt) ? cached.tweetsAt : null;
      state.statusAt = state.status && validDate(cached.statusAt) ? cached.statusAt : null;
      for (const key of ["tweets", "status"]) {
        if (typeof cached.errors?.[key] === "string") state.errors[key] = cached.errors[key];
        if (Number.isFinite(cached.attempts?.[key])) state.attempts[key] = cached.attempts[key];
        if (Number.isFinite(cached.retryAt?.[key])) state.retryAt[key] = cached.retryAt[key];
      }
    } catch (_) { /* 损坏缓存不作为成功数据使用。 */ }
  }
  const now = Date.now();
  let changed = false;
  await Promise.all(["tweets", "status"].map(async key => {
    if (now < (state.retryAt[key] || 0)) return;
    if (!force && now < (state.attempts[key] || 0) + settings.refreshMinutes * 60000) return;
    changed = true;
    state.attempts[key] = now;
    try {
      const payload = parseJSON(await downloadText(SITE + "/api/" + key));
      state[key] = key === "tweets" ? validateTweets(payload) : validateStatus(payload);
      state[key + "At"] = new Date().toISOString();
      delete state.errors[key];
      delete state.retryAt[key];
    } catch (error) {
      state.errors[key] = error.message;
      if (error.retryAt) state.retryAt[key] = error.retryAt;
    }
  }));
  // 只读缓存时不重复写盘；请求结果（包括限流和失败）发生变化才保存。
  if (changed) {
    try { writeLocal("snapshot.json", state); }
    catch (error) {
      state.storageError = errorText(error);
      console.error("[TiboMonitor] 缓存未保存：" + state.storageError);
    }
  }
  const deadlines = ["tweets", "status"].map(key => Math.max((state.attempts[key] || now) + settings.refreshMinutes * 60000, state.retryAt[key] || 0));
  state.nextRefresh = new Date(Math.max(Date.now() + 60000, Math.min(...deadlines)));
  return state;
}

// 固定北京时间，不依赖手机所在时区，也不把失败检查时间当作采集时间。
function beijingTime(value) {
  if (!validDate(value)) return "暂无记录";
  const d = new Date(Date.parse(value) + 8 * 3600000);
  const pad = n => String(n).padStart(2, "0");
  return pad(d.getUTCMonth() + 1) + "/" + pad(d.getUTCDate()) + " " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
}

function textFor(tweet, language) {
  const translation = tweet.translation;
  let text = tweet.text;
  if (language === "zh") {
    if (translation?.status === "complete" && typeof translation.text === "string" && translation.text.trim()) text = translation.text;
    else {
      const labels = { pending: "待翻译", processing: "翻译中", failed: "翻译失败", unconfigured: "未配置翻译" };
      text = "【" + (labels[translation?.status] || "未翻译") + "】" + text;
    }
  }
  return (tweet.isDemo ? "【演示】" : "") + text.replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
}

function resetLabel(tweet) {
  const result = tweet.resetClassification;
  if (result?.status === "complete" && typeof result.isResetAnnouncement === "boolean") return result.isResetAnnouncement ? "重置：是" : "重置：否";
  const labels = { failed: "判定失败", unconfigured: "未配置判定", processing: "判定中" };
  return labels[result?.status] || "重置待判";
}

function sourceBadge(state, settings) {
  if (!state.tweets) return { text: "加载失败", warning: true };
  if (state.errors.tweets) return { text: "缓存·失败", warning: true };
  if (state.errors.status || !state.status) return { text: "状态未知", warning: true };
  if (state.status.demo || state.tweets.some(tweet => tweet.isDemo)) return { text: "演示数据", warning: true };
  if (state.storageError) return { text: "缓存未保存", warning: true };
  if (Date.now() - Date.parse(state.tweetsAt) > Math.max(30, settings.refreshMinutes * 3) * 60000) return { text: "旧快照", warning: true };
  const source = state.status.source;
  if (source.requiresAttention || source.state === "paused") return { text: "采集暂停", warning: true };
  if (source.backoffActive) return { text: "采集等待", warning: true };
  const labels = { healthy: "采集正常", degraded: "采集降级", unavailable: "采集异常", unconfigured: "未采集", demo: "演示数据" };
  if (source.state === "healthy" && validDate(source.lastSuccessAt) && Date.now() - Date.parse(source.lastSuccessAt) > Math.max(30, state.status.intervalMinutes * 3) * 60000) return { text: "采集延迟", warning: true };
  return { text: labels[source.state] || "状态未知", warning: source.state !== "healthy" };
}

function palette(theme) {
  const color = (light, dark) => theme === "light" ? new Color(light) : theme === "dark" ? new Color(dark) : Color.dynamic(new Color(light), new Color(dark));
  return { background: color("F4F5F0", "171C23"), text: color("20291F", "EFF3E9"), muted: color("626D61", "9CA89C"),
    accent: color("416B30", "BEDD8B"), warning: color("9B591D", "E8B26E"), rule: color("DDE3D6", "303A35") };
}

function addText(container, value, size, color, bold, lines) {
  const text = container.addText(value);
  text.font = bold ? Font.semiboldSystemFont(size) : Font.systemFont(size);
  text.textColor = color;
  text.lineLimit = lines || 1;
  text.minimumScaleFactor = 1;
  return text;
}

function scriptURL(action, family, parameter) {
  let url = "scriptable:///run?scriptName=" + encodeURIComponent(Script.name());
  if (action) url += "&action=" + encodeURIComponent(action);
  if (LIMITS[family]) url += "&family=" + encodeURIComponent(family);
  if (typeof parameter === "string" && parameter) url += "&parameter=" + encodeURIComponent(parameter);
  return url;
}
function postURL(tweet) { return /^https:\/\/(?:x\.com|twitter\.com)\/thsottiaux\/status\/[1-9]\d{0,24}$/.test(tweet.url) ? tweet.url : SITE; }

function renderWidget(state, settings, family) {
  const widget = new ListWidget();
  const colors = palette(settings.theme);
  const small = family === "small";
  const short = small || family === "medium";
  const parameter = JSON.stringify({ counts: settings.counts, refreshMinutes: settings.refreshMinutes, language: settings.language, theme: settings.theme });
  widget.backgroundColor = colors.background;
  widget.setPadding(short ? 10 : 14, short ? 12 : 16, short ? 10 : 14, short ? 12 : 16);
  widget.url = SITE;
  widget.refreshAfterDate = state.nextRefresh;
  const header = widget.addStack();
  header.centerAlignContent();
  addText(header, "Tibo 动态", short ? 14 : 17, colors.text, true);
  header.addSpacer();
  const badge = sourceBadge(state, settings);
  if (small) addText(header, badge.text, 8, badge.warning ? colors.warning : colors.accent, false);
  else {
    addText(header, badge.text, 10, badge.warning ? colors.warning : colors.accent, false);
    header.addSpacer(8);
    const menu = addText(header, "•••", 12, colors.muted, true);
    menu.url = scriptURL(null, family, parameter);
  }
  widget.addSpacer(short ? 5 : 9);
  const tweets = (state.tweets || []).slice(0, settings.count);
  if (!tweets.length) {
    addText(widget, state.tweets ? "暂无消息" : "暂时无法加载消息", 13, colors.text, true, 2);
    widget.addSpacer(4);
    addText(widget, state.errors.tweets || "公开接口当前没有返回消息", 11, colors.muted, false, 2);
  }
  const bodyLines = small ? (settings.count === 1 ? 3 : 1) : family === "medium" ? (settings.count === 1 ? 3 : settings.count === 2 ? 2 : 1) : (settings.count <= 5 ? 2 : 1);
  tweets.forEach((tweet, index) => {
    const row = widget.addStack();
    row.layoutVertically();
    row.url = postURL(tweet);
    const meta = row.addStack();
    const reset = resetLabel(tweet);
    addText(meta, reset, short ? 9 : 10, reset === "重置：是" ? colors.accent : colors.muted, reset === "重置：是");
    meta.addSpacer();
    addText(meta, beijingTime(tweet.publishedAt), short ? 9 : 10, colors.muted, false);
    row.addSpacer(1);
    // 正文固定字号；长消息按行数截断，不随长度缩小。
    addText(row, textFor(tweet, settings.language), 12, colors.text, false, bodyLines);
    if (index < tweets.length - 1) {
      if (small) widget.addSpacer(3);
      else {
        widget.addSpacer(short ? 1 : 2);
        const divider = widget.addStack();
        divider.size = new Size(0, 1);
        divider.backgroundColor = colors.rule;
        divider.addSpacer();
        widget.addSpacer(short ? 1 : 2);
      }
    }
  });
  widget.addSpacer();
  widget.addSpacer(4);
  const footer = widget.addStack();
  footer.layoutVertically();
  // 同步时间只在消息成功读取并通过校验后推进；采集时间只取 lastSuccessAt。
  const syncLabel = small ? "同步 " : "上次同步 ";
  const syncState = state.errors.tweets ? (small ? " · 缓存" : " · 失败，显示缓存") : "";
  addText(footer, syncLabel + beijingTime(state.tweetsAt) + syncState, 9, state.errors.tweets ? colors.warning : colors.muted, false);
  footer.addSpacer(1);
  const sourceLabel = state.errors.status ? (small ? "采集(旧) " : "网站采集(旧) ") : small ? "采集 " : "网站采集 ";
  const lastRow = footer.addStack();
  addText(lastRow, sourceLabel + beijingTime(state.status?.source.lastSuccessAt), 9, badge.warning ? colors.warning : colors.muted, false);
  if (!small) {
    lastRow.addSpacer();
    const update = addText(lastRow, "更新脚本 ↗", 9, colors.accent, false);
    update.url = scriptURL("update", family, parameter);
  }
  return widget;
}

// SHA-256 对照仓库清单验证下载完整性；不依赖浏览器、Node.js 或第三方模块。
function sha256(text) {
  const bytes = [];
  for (const char of text) {
    const c = char.codePointAt(0);
    if (c < 128) bytes.push(c);
    else if (c < 2048) bytes.push(192 | (c >> 6), 128 | (c & 63));
    else if (c < 65536) bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
    else bytes.push(240 | (c >> 18), 128 | ((c >> 12) & 63), 128 | ((c >> 6) & 63), 128 | (c & 63));
  }
  const byteLength = bytes.length;
  bytes.push(128);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const bitLength = byteLength * 8;
  for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bitLength >>> (i * 8)) & 255);
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const rotate = (n, b) => (n >>> b) | (n << (32 - b));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const w = [];
    for (let i = 0; i < 16; i++) w[i] = (bytes[offset + i * 4] << 24) | (bytes[offset + i * 4 + 1] << 16) | (bytes[offset + i * 4 + 2] << 8) | bytes[offset + i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = rotate(w[i - 15], 7) ^ rotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotate(w[i - 2], 17) ^ rotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a,b,c,d,e,f,g,j] = h;
    for (let i = 0; i < 64; i++) {
      const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const t1 = (j + sum1 + choice + k[i] + w[i]) | 0;
      const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      j = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + sum0 + majority) | 0;
    }
    [a,b,c,d,e,f,g,j].forEach((value, i) => { h[i] = (h[i] + value) | 0; });
  }
  return h.map(value => (value >>> 0).toString(16).padStart(8, "0")).join("");
}

function newerVersion(candidate, current) {
  if (!/^\d+\.\d+\.\d+$/.test(candidate)) throw failure("更新版本号无效");
  const a = candidate.split(".").map(Number), b = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}

function validateUpdate(manifest, source) {
  if (!isObject(manifest) || manifest.id !== "tibo-monitor-widget" || manifest.script !== "TiboMonitor.js" ||
      !/^\d+\.\d+\.\d+$/.test(manifest.version || "") || !/^[a-f0-9]{64}$/.test(manifest.sha256 || "")) throw failure("更新清单无效");
  if (!source.startsWith("// Variables used by Scriptable.") || !source.includes("// TIBO_MONITOR_WIDGET\n") ||
      !source.includes('// version: ' + manifest.version + '\n') || !source.includes('const VERSION = "' + manifest.version + '";')) throw failure("下载内容不是对应版本的小组件脚本");
  if (sha256(source) !== manifest.sha256) throw failure("代码完整性校验失败，未替换脚本");
  try { new Function("return async function() {\n" + source + "\n};"); }
  catch (_) { throw failure("新版本语法校验失败，未替换脚本"); }
}

async function scriptFile() {
  const path = module.filename;
  const cloud = FileManager.iCloud();
  const files = cloud.isFileStoredIniCloud(path) ? cloud : localFiles;
  if (files === cloud) await files.downloadFileFromiCloud(path);
  if (!files.fileExists(path)) throw failure("找不到当前脚本文件，请先将脚本保存到 Scriptable");
  return { path, files };
}

async function replaceScript(source, keepBackup) {
  const { path, files } = await scriptFile();
  const original = files.readString(path);
  const backupName = "backup-" + sha256(path).slice(0, 16) + ".json";
  const backup = { source: original, sha256: sha256(original), savedAt: new Date().toISOString() };
  if (keepBackup) writeLocal(backupName + ".pending", backup);
  const temporary = path + ".update.tmp";
  try {
    files.writeString(temporary, source);
    if (files.readString(temporary) !== source) throw failure("新文件写入校验失败");
    files.move(temporary, path);
    if (files.readString(path) !== source) throw failure("替换文件校验失败");
    // 仅在替换成功后提交最新备份，失败的更新不覆盖上一次可恢复版本。
    if (keepBackup) writeLocal(backupName, backup);
  } catch (_) {
    try { files.writeString(path, original); }
    catch (_) { throw failure("更新写入失败，请从本地备份恢复脚本"); }
    throw failure("更新写入失败，已保留原脚本");
  } finally {
    try { if (files.fileExists(temporary)) files.remove(temporary); } catch (_) {}
  }
}

async function showMessage(title, message) {
  const alert = new Alert(); alert.title = title; alert.message = message; alert.addAction("好"); await alert.presentAlert();
}

async function diagnoseCache() {
  const name = "storage-check-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2) + ".json";
  const path = localFiles.joinPath(dataDirectory, name);
  const probe = { version: VERSION, checkedAt: new Date().toISOString() };
  let title = "缓存诊断通过";
  let message = "本地文件写入与回读正常。\n保存目录：" + dataDirectory + "\n请重新预览组件，刷新消息缓存。";
  try {
    writeLocal(name, probe);
    const saved = readLocal(name, null);
    if (saved?.version !== probe.version || saved?.checkedAt !== probe.checkedAt) throw failure("缓存读取校验失败");
  } catch (error) { title = "缓存诊断失败"; message = errorText(error) + "\n保存目录：" + dataDirectory; }
  finally {
    try { if (localFiles.fileExists(path)) localFiles.remove(path); }
    catch (error) { title = "缓存诊断失败"; message += "\n诊断文件清理失败：" + errorText(error); }
  }
  await showMessage(title, message);
}

async function updateScript() {
  if (!config.runsInApp) throw failure("请在 Scriptable 内更新脚本");
  let updatedVersion;
  try {
    // 先锁定提交，再从同一提交读取清单和代码，避免发布时文件版本不一致。
    const commit = parseJSON(await downloadText("https://api.github.com/repos/" + REPOSITORY + "/commits/" + BRANCH, 20));
    if (!/^[a-f0-9]{40}$/.test(commit.sha || "")) throw failure("无法确认仓库版本");
    const root = "https://api.github.com/repos/" + REPOSITORY + "/contents/";
    const headers = { Accept: "application/vnd.github.raw+json" };
    const ref = "?ref=" + commit.sha;
    const manifest = parseJSON(await downloadText(root + "update.json" + ref, 20, headers));
    if (!isObject(manifest) || manifest.id !== "tibo-monitor-widget") throw failure("更新清单无效");
    if (!newerVersion(manifest.version, VERSION)) { await showMessage("已是最新版本", "当前版本 v" + VERSION); return; }
    const source = await downloadText(root + "TiboMonitor.js" + ref, 20, headers);
    validateUpdate(manifest, source);
    await replaceScript(source, true);
    updatedVersion = manifest.version;
  } catch (error) { await showMessage("更新失败", error.message + "。可稍后再次点击更新。"); return; }
  try {
    // 重新运行已落盘的新版，跳过菜单刷新一次；不在旧运行环境中渲染新版。
    await Safari.open(scriptURL("refresh", args.queryParameters?.family, args.queryParameters?.parameter ?? args.widgetParameter));
  } catch (_) {
    await showMessage("更新完成", "已更新至 v" + updatedVersion + "，但无法启动自动刷新。请再次运行脚本并选择预览。更新前代码已备份，小组件 Parameter 保持不变。");
  }
}

async function restoreScript() {
  try {
    const { path } = await scriptFile();
    const backup = readLocal("backup-" + sha256(path).slice(0, 16) + ".json", null);
    if (!backup || typeof backup.source !== "string" || !backup.source.includes("// TIBO_MONITOR_WIDGET")) throw failure("还没有可用的更新前备份");
    if (sha256(backup.source) !== backup.sha256) throw failure("备份校验失败，未替换当前脚本");
    await replaceScript(backup.source, false);
    await showMessage("已恢复", "已恢复更新前的代码，再次运行脚本即可。小组件 Parameter 保持不变。");
  } catch (error) { await showMessage("恢复失败", error.message); }
}

async function main() {
  let family = config.widgetFamily || "medium";
  let parameter = args.widgetParameter;
  if (config.runsInApp) {
    if (LIMITS[args.queryParameters?.family]) family = args.queryParameters.family;
    if (args.queryParameters?.parameter !== undefined) parameter = args.queryParameters.parameter;
    if (args.queryParameters?.action === "update") { await updateScript(); return; }
    if (args.queryParameters?.action !== "refresh") {
      const menu = new Alert(); menu.title = "Tibo 动态 · v" + VERSION;
      menu.message = "预览会重新读取公开消息。所有显示时间均为北京时间。";
      ["预览小组件", "预览中组件", "预览大组件", "一键更新脚本", "恢复更新前版本", "打开网站", "缓存诊断"].forEach(title => menu.addAction(title));
      menu.addCancelAction("取消");
      const choice = await menu.presentSheet();
      if (choice < 0) return;
      if (choice === 3) { await updateScript(); return; }
      if (choice === 4) { await restoreScript(); return; }
      if (choice === 5) { Safari.open(SITE); return; }
      if (choice === 6) { await diagnoseCache(); return; }
      family = ["small", "medium", "large"][choice];
    }
  }
  if (!LIMITS[family]) {
    const widget = new ListWidget(); widget.addText("请添加桌面小、中或大组件"); Script.setWidget(widget); return;
  }
  let widget, storageError;
  try {
    const settings = settingsFor(parameter, family);
    const state = await loadSnapshot(settings, config.runsInApp);
    storageError = state.storageError;
    widget = renderWidget(state, settings, family);
  } catch (error) {
    widget = new ListWidget(); widget.addText("小组件配置错误"); widget.addText(error.message); widget.url = scriptURL();
  }
  Script.setWidget(widget);
  if (config.runsInApp) {
    if (storageError) await showMessage("缓存未保存", storageError + "\n本次消息仍可查看。可返回菜单选择“缓存诊断”检查本地存储。");
    await widget[{ small: "presentSmall", medium: "presentMedium", large: "presentLarge" }[family]]();
  }
}

try { await main(); } finally { Script.complete(); }
