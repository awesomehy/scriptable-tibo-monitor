// Tibo Monitor for Widgy / Watchy 1.0.0
// Paste ALL of this file into Text > Data > JavaScript > Async + No main().
// One text layer = one public API request per execution. No Scriptable APIs.
// Read watchy/README.md for layout, sync and refresh limitations.
(function () {
  "use strict";
  var MODE = "compact"; // "compact": rectangular complication; "full": Watchy app.
  var MAX_BODY_CHARS = MODE === "full" ? 160 : 28;
  var URL = "https://tibo-monitor.hhyan.me/api/tweets";
  var TIMEOUT_MS = 8000;
  var done = false;
  var controller = typeof AbortController === "function" ? new AbortController() : null;
  var timer;

  function finish(text) {
    if (done) return;
    done = true;
    if (typeof clearTimeout === "function") clearTimeout(timer);
    sendToWidgy(String(text));
  }
  function clean(value) { return value.replace(/\s+/g, " ").trim(); }
  function time(value) {
    var date = new Date(Date.parse(value) + 8 * 3600000);
    function pad(n) { return String(n).padStart(2, "0"); }
    return pad(date.getUTCMonth() + 1) + "/" + pad(date.getUTCDate()) + " " +
      pad(date.getUTCHours()) + ":" + pad(date.getUTCMinutes());
  }
  function validDate(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
  function fail(message) { throw new Error(message); }
  function latest(payload) {
    if (!payload || !Array.isArray(payload.tweets) || payload.tweets.length > 50) fail("接口格式变化");
    var ids = {};
    var tweets = payload.tweets.slice();
    tweets.forEach(function (tweet) {
      if (!tweet || typeof tweet.id !== "string" || !/^[1-9]\d{0,24}$/.test(tweet.id) ||
          ids[tweet.id] || typeof tweet.text !== "string" || !clean(tweet.text) ||
          typeof tweet.isDemo !== "boolean" || !validDate(tweet.publishedAt)) fail("消息记录无效");
      ids[tweet.id] = true;
    });
    tweets.sort(function (a, b) {
      var byDate = Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
      if (byDate) return byDate;
      if (a.id.length !== b.id.length) return b.id.length - a.id.length;
      return a.id === b.id ? 0 : a.id > b.id ? -1 : 1;
    });
    return tweets[0] || null;
  }
  function display(tweet, receivedAt) {
    // Time and content come from the same successful, validated request.
    var header = "Tibo · 刷新 " + time(receivedAt);
    if (!tweet) return header + "\n暂无公开消息";
    var tr = tweet.translation;
    var body = tweet.text;
    var labels = { pending: "待译", processing: "翻译中", failed: "翻译失败", unconfigured: "未配置翻译" };
    if (tr && tr.status === "complete" && typeof tr.text === "string" && clean(tr.text)) body = tr.text;
    else body = "【" + (labels[tr && tr.status] || "未翻译") + "】" + body;
    if (tweet.isDemo) header = "【演示】" + header;
    var chars = Array.from(clean(body));
    if (chars.length > MAX_BODY_CHARS) body = chars.slice(0, MAX_BODY_CHARS - 1).join("") + "…";
    else body = chars.join("");
    var classification = tweet.resetClassification;
    var reset = "待判定";
    if (classification && classification.status === "complete" && typeof classification.isResetAnnouncement === "boolean") {
      reset = classification.isResetAnnouncement ? "是" : "否";
    }
    return header + "\n" + body + "\n帖 " + time(tweet.publishedAt) + " · 重置：" + reset;
  }

  timer = setTimeout(function () {
    finish("Tibo · 刷新失败\n请求超时，未取得新消息\n请打开 Watchy 重试");
    if (controller) controller.abort();
  }, TIMEOUT_MS);
  try {
    if (typeof fetch !== "function") fail("此 Watchy 环境不支持 fetch，请更新 Widgy");
    var options = { credentials: "omit", cache: "no-store", redirect: "error" };
    if (controller) options.signal = controller.signal;
    fetch(URL, options).then(function (response) {
      if (!response.ok) {
        if (response.status === 429) fail("请求限流，请稍后手动重试");
        fail("接口 HTTP " + response.status);
      }
      return response.json();
    }).then(function (payload) {
      var tweet = latest(payload);
      finish(display(tweet, new Date().toISOString()));
    }).catch(function (error) {
      finish("Tibo · 刷新失败\n" + String(error && error.message || "网络或 Watchy 运行错误") + "\n未取得新消息，请稍后重试");
    });
  } catch (error) {
    finish("Tibo · 刷新失败\n" + String(error && error.message || error));
  }
}());
