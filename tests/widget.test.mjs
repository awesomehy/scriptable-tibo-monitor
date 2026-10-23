import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const source = await readFile(new URL('../TiboMonitor.js', import.meta.url), 'utf8');
const currentVersion = source.match(/^const VERSION = "([\d.]+)";/m)[1];
const nextVersion = currentVersion.split('.').map((part, index) => index === 2 ? Number(part) + 1 : part).join('.');
const START = Date.parse('2026-10-19T04:30:00Z');
const CACHE_PATH = '/documents/TiboMonitorWidget/snapshot.json';
const LEGACY_CACHE_PATH = '/library/TiboMonitorWidget/snapshot.json';
const tweet = (id = '2111990254408434095', overrides = {}) => ({ id, text: 'Original post',
  url: `https://x.com/thsottiaux/status/${id}`, publishedAt: '2026-10-19T01:18:10Z', isDemo: false,
  translation: { status: 'complete', text: '中文消息' }, resetClassification: { status: 'complete', isResetAnnouncement: false }, ...overrides });
const status = (overrides = {}) => ({ source: { state: 'healthy', lastSuccessAt: '2026-10-19T04:28:00Z', ...overrides }, intervalMinutes: 5, demo: false });

async function harness(options = {}) {
  const runningSource = options.source || source;
  const definitions = runningSource.replace('try { await main(); } finally { Script.complete(); }', '');
  const clock = { now: options.now || START };
  const files = options.files || new Map([['/documents/TiboMonitor.js', runningSource]]);
  const calls = [], nodes = [], messages = [], launches = [], previews = [], widgets = [], menus = [], fileOps = [], logs = [];
  const keys = options.keys || new Map();
  const choices = [...(options.choices || [])];
  let plan = {}, scriptWriteFailure = false, openFailure = false;
  const fileOperation = (operation, path, content) => {
    fileOps.push({ operation, path });
    options.onFileOperation?.({ operation, path, content, files });
  };
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  const fm = {
    libraryDirectory: () => '/library', documentsDirectory: () => '/documents', joinPath: (a, b) => `${a}/${b}`,
    fileExists: path => files.has(path),
    createDirectory(path) { fileOperation('createDirectory', path); files.set(path, null); },
    readString(path) { fileOperation('readString', path); if (!files.has(path)) throw Error('missing'); return files.get(path); },
    writeString(path, text) {
      fileOperation('writeString', path, text);
      if (scriptWriteFailure && path.endsWith('TiboMonitor.js')) throw Error('disk failure');
      files.set(path, options.transformWrite?.(path, text) ?? text);
    },
    remove(path) { fileOperation('remove', path); files.delete(path); },
    move(a, b) {
      fileOperation('move', b);
      if (options.rejectMove) throw Error('destination already exists');
      files.set(b, fm.readString(a)); files.delete(a);
    },
    isFileStoredIniCloud: () => options.cloud === true, async downloadFileFromiCloud() {},
  };
  class Element {
    constructor(type = 'stack', text = '') { this.type = type; this.text = text; this.children = []; nodes.push(this); }
    addStack() { const child = new Element(); this.children.push(child); return child; }
    addText(text) { const child = new Element('text', text); this.children.push(child); return child; }
    addSpacer() {} centerAlignContent() {} layoutVertically() {} setPadding() {}
    async presentSmall() { previews.push('small'); }
    async presentMedium() { previews.push('medium'); }
    async presentLarge() { previews.push('large'); }
  }
  class Request {
    constructor(url) { this.url = url; }
    async loadString() {
      calls.push({ url: this.url, headers: this.headers, redirects: this.onRedirect });
      const value = plan[this.url] ?? plan[new URL(this.url).pathname.split('/').at(-1)];
      if (!value || value.networkError) throw Error('offline');
      this.response = { statusCode: value.code ?? 200, headers: value.headers ?? {} };
      if (value.throwWithResponse) throw Error('HTTP error');
      return value.raw ?? JSON.stringify(value.body);
    }
  }
  const cloud = { ...fm };
  const context = { FileManager: { local: () => fm, iCloud: () => cloud }, Request, Date: FakeDate,
    Keychain: { contains: key => keys.has(key), get: key => keys.get(key), set(key, value) { if (options.keychainFails) throw Error('locked'); keys.set(key, value); } },
    console: { error: message => logs.push(String(message)) },
    ListWidget: Element, Font: { systemFont: size => size, semiboldSystemFont: size => size },
    Size: class { constructor(width, height) { this.width = width; this.height = height; } },
    Color: class { constructor(value) { this.value = value; } static dynamic(light) { return light; } },
    Script: { name: () => options.scriptName || 'TiboMonitor', setWidget(widget) { widgets.push(widget); }, complete() {} },
    Safari: { async open(url) { if (openFailure) throw Error('cannot launch'); launches.push(url); } },
    config: { runsInApp: true }, args: options.args || {}, module: { filename: '/documents/TiboMonitor.js' },
    Alert: class {
      addAction() {} addCancelAction() {}
      async presentAlert() { messages.push({ title: this.title, message: this.message }); }
      async presentSheet() { menus.push(this.title); return choices.length ? choices.shift() : options.choice ?? -1; }
    },
  };
  const names = ['settingsFor', 'validateTweets', 'validateStatus', 'loadSnapshot', 'textFor', 'resetLabel',
    'beijingTime', 'sourceBadge', 'renderWidget', 'sha256', 'newerVersion', 'validateUpdate', 'replaceScript', 'updateScript', 'restoreScript', 'main', 'readLocal', 'writeLocal', 'readLayout', 'saveLayout', 'configureLayout'];
  const api = await vm.runInNewContext(`(async () => { ${definitions}\nreturn {${names.join(',')}}; })()`, context);
  return { ...api, clock, files, calls, nodes, messages, launches, previews, widgets, menus, fileOps, logs, keys, context, settings: api.settingsFor(null, 'medium'),
    setPlan: value => { plan = value; }, failScriptWrite: () => { scriptWriteFailure = true; },
    failOpen: () => { openFailure = true; },
    ready: () => { plan = { tweets: { body: { tweets: [tweet()] } }, status: { body: status() } }; } };
}

test('默认尺寸为 1/3/6，参数有边界且更新不依赖源码配置', async () => {
  const h = await harness();
  for (const [family, count] of [['small', 1], ['medium', 3], ['large', 6]]) assert.equal(h.settingsFor(null, family).count, count);
  assert.equal(h.settingsFor(null, 'medium').refreshMinutes, 10);
  assert.equal(h.settingsFor('{"refreshMinutes":15}', 'medium').refreshMinutes, 15);
  assert.equal(h.settingsFor('2', 'medium').count, 2);
  assert.equal(h.settingsFor('{"counts":{"large":5},"theme":"dark"}', 'large').count, 5);
  for (const parameter of ['oops', '-1', '4', '{"refreshMinutes":0}', '{"theme":"unknown"}']) assert.throws(() => h.settingsFor(parameter, 'medium'));
});

test('布局保存在本机，参数可单独覆盖，更新链接只保留显式布局', async () => {
  const h = await harness();
  assert.equal(h.readLayout(), 'original');
  h.saveLayout('night');
  assert.equal(h.settingsFor(null, 'small').layout, 'night');
  assert.equal((await harness({ keys: h.keys })).readLayout(), 'night');
  assert.equal(h.settingsFor('{"layout":"news"}', 'medium').layout, 'news');
  for (const layout of ['unknown', '__proto__', null, ['night'], {}]) assert.throws(() => h.settingsFor(JSON.stringify({ layout }), 'medium'));
  for (const [parameter, expected] of [[null, undefined], ['{"layout":"timeline"}', 'timeline']]) {
    h.nodes.length = 0;
    h.renderWidget({ tweets: [tweet()], status: status(), tweetsAt: new Date(START).toISOString(), errors: {} }, h.settingsFor(parameter, 'medium'), 'medium');
    const link = new URL(h.nodes.find(node => node.text === '更新脚本 ↗').url);
    assert.equal(JSON.parse(link.searchParams.get('parameter')).layout, expected);
  }
});

test('四种布局保留条数、固定字号、消息链接、缓存状态与两个成功时间', async () => {
  const h = await harness();
  const posts = Array.from({ length: 7 }, (_, i) => tweet(String(100 + i), { translation: { status: 'complete', text: i ? '长消息'.repeat(100) : '短消息' } }));
  for (const layout of ['original', 'night', 'news', 'timeline']) for (const family of ['small', 'medium', 'large']) {
    h.nodes.length = 0;
    const settings = h.settingsFor(JSON.stringify({ layout }), family);
    h.renderWidget({ tweets: posts, status: status(), tweetsAt: new Date(START).toISOString(), errors: { tweets: 'offline' } }, settings, family);
    const bodies = h.nodes.filter(node => node.type === 'text' && /^(长消息|短消息)/.test(node.text));
    assert.equal(bodies.length, settings.count);
    assert.ok(bodies.every(node => node.font === 12 && node.minimumScaleFactor === 1));
    assert.equal(h.nodes.filter(node => node.url?.startsWith('https://x.com')).length, settings.count);
    assert.ok(h.nodes.some(node => /同步 10\/19 12:30.*缓存/.test(node.text)));
    assert.ok(h.nodes.some(node => /采集 10\/19 12:28/.test(node.text)));
  }
});

test('外观菜单选择并预览，取消或保存失败不发请求', async () => {
  const h = await harness({ choices: [7, 2] }); h.ready();
  await h.main();
  assert.equal(h.readLayout(), 'news');
  assert.deepEqual(h.previews, ['medium']);
  const cancelled = await harness({ choices: [7, -1] });
  await cancelled.main();
  assert.equal(cancelled.calls.length, 0);
  assert.equal(cancelled.readLayout(), 'original');
  const locked = await harness({ choices: [7, 1], keychainFails: true });
  await locked.main();
  assert.equal(locked.calls.length, 0);
  assert.match(locked.messages[0].message, /未能保存/);
});

test('最新消息按发布时间排序，同一时间的大整数 ID 保持精度', async () => {
  const h = await harness();
  const posts = h.validateTweets({ tweets: [tweet('2111990254408434094'), tweet('2111990254408434095'), tweet('2111990254408434093', { publishedAt: '2026-10-20T00:00:00Z' })] });
  assert.deepEqual(Array.from(posts, row => row.id), ['2111990254408434093', '2111990254408434095', '2111990254408434094']);
  assert.throws(() => h.validateTweets({ tweets: [tweet(), tweet()] }));
  assert.throws(() => h.validateTweets({ tweets: [tweet('1', { publishedAt: 'bad date' })] }));
});

test('翻译未完成时显示原文和状态，未完成判定不显示为否', async () => {
  const h = await harness();
  assert.equal(h.textFor(tweet(), 'zh'), '中文消息');
  assert.equal(h.textFor(tweet(), 'en'), 'Original post');
  assert.match(h.textFor(tweet('1', { translation: { status: 'pending', text: '未完成的翻译' } }), 'zh'), /【待翻译】Original post/);
  assert.equal(h.resetLabel(tweet('1', { resetClassification: { status: 'pending', isResetAnnouncement: false } })), '重置待判');
  assert.equal(h.resetLabel(tweet('1', { resetClassification: { status: 'complete', isResetAnnouncement: true } })), '重置：是');
  assert.equal(h.beijingTime('2026-10-18T16:02:00Z'), '10/19 00:02');
});

test('尺寸渲染数量正确，每种尺寸都保留两个成功时间', async () => {
  const h = await harness();
  const posts = Array.from({ length: 8 }, (_, i) => tweet(String(100 + i)));
  for (const [family, count] of [['small', 1], ['medium', 3], ['large', 6]]) {
    h.nodes.length = 0;
    h.renderWidget({ tweets: posts, status: status(), tweetsAt: '2026-10-19T04:30:00Z', errors: {}, nextRefresh: new Date(START + 900000) }, h.settingsFor(null, family), family);
    assert.equal(h.nodes.filter(node => node.text === '中文消息').length, count);
    assert.ok(h.nodes.some(node => /同步 10\/19 12:30/.test(node.text)));
    assert.ok(h.nodes.some(node => /采集 10\/19 12:28/.test(node.text)));
    const links = h.nodes.filter(node => node.url?.startsWith('https://x.com'));
    assert.equal(links.length, count);
  }
});

test('中、大组件长短推文使用相同固定字号，逐条分隔，更新入口保留显示设置', async () => {
  const h = await harness();
  const texts = ['短推文', '很长的推文内容'.repeat(150), 'OneVeryLongWord'.repeat(150)];
  const posts = Array.from({ length: 7 }, (_, i) => tweet(String(100 + i), { translation: { status: 'complete', text: texts[i % texts.length] } }));
  for (const family of ['medium', 'large']) for (const count of family === 'medium' ? [1, 2, 3] : [1, 2, 5, 6, 7]) {
    for (const theme of ['light', 'dark']) {
      h.nodes.length = 0;
      const settings = h.settingsFor(JSON.stringify({ count, theme }), family);
      h.renderWidget({ tweets: posts, status: status(), tweetsAt: new Date(START).toISOString(), errors: {} }, settings, family);
      const body = h.nodes.filter(node => node.type === 'text' && texts.includes(node.text));
      assert.equal(body.length, count);
      assert.ok(body.every(node => node.font === 12 && node.minimumScaleFactor === 1));
      assert.ok(body.every(node => node.lineLimit === body[0].lineLimit));
      const dividers = h.nodes.filter(node => node.size?.height === 1);
      assert.equal(dividers.length, count - 1);
      assert.ok(dividers.every(node => node.size.width === 0 && node.backgroundColor.value === (theme === 'light' ? 'DDE3D6' : '303A35')));
      const update = new URL(h.nodes.find(node => node.text === '更新脚本 ↗').url);
      assert.equal(update.searchParams.get('family'), family);
      const saved = h.settingsFor(update.searchParams.get('parameter'), family);
      assert.equal(saved.count, count); assert.equal(saved.theme, theme);
    }
  }
});

test('多组件共享缓存，成功读取才推进同步时间，网络失败保留旧消息', async () => {
  const h = await harness(); h.ready();
  const first = await h.loadSnapshot(h.settings, false);
  assert.equal(h.calls.length, 2);
  assert.equal(first.nextRefresh.getTime(), START + 10 * 60000);
  h.clock.now += 60000;
  const cached = await h.loadSnapshot(h.settings, false);
  assert.equal(h.calls.length, 2);
  assert.equal(cached.tweetsAt, first.tweetsAt);
  h.clock.now = START + 10 * 60000 - 1;
  await h.loadSnapshot(h.settings, false);
  assert.equal(h.calls.length, 2);
  h.clock.now += 1; h.setPlan({});
  const failed = await h.loadSnapshot(h.settings, false);
  assert.equal(h.calls.length, 4);
  assert.equal(failed.tweetsAt, first.tweetsAt);
  assert.equal(failed.status.source.lastSuccessAt, '2026-10-19T04:28:00Z');
  assert.equal(failed.tweets[0].id, first.tweets[0].id);
  assert.match(h.sourceBadge(failed, h.settings).text, /缓存/);
});

test('消息、采集状态分别处理失败；格式错误不得冒充空消息成功', async () => {
  const h = await harness(); h.ready();
  const first = await h.loadSnapshot(h.settings, false);
  h.clock.now += 16 * 60000;
  h.setPlan({ tweets: { body: { tweets: [tweet('2')] } }, status: { code: 503, body: {} } });
  const partial = await h.loadSnapshot(h.settings, false);
  assert.notEqual(partial.tweetsAt, first.tweetsAt);
  assert.equal(partial.statusAt, first.statusAt);
  assert.equal(h.sourceBadge(partial, h.settings).text, '状态未知');
  h.clock.now += 16 * 60000;
  h.setPlan({ tweets: { body: { unexpected: [] } }, status: { body: status() } });
  const malformed = await h.loadSnapshot(h.settings, false);
  assert.equal(malformed.tweetsAt, partial.tweetsAt);
  assert.equal(malformed.tweets[0].id, '2');
});

test('Library 写入不可用及缓存移动失败时，仍能保存并跨运行复用本地消息', async () => {
  const h = await harness({ onFileOperation({ operation, path }) {
    if (path.startsWith('/library/') && ['createDirectory', 'writeString', 'move'].includes(operation)) throw Error('Library is not writable');
    if (operation === 'move' && path.endsWith('snapshot.json')) throw Error('cannot replace destination');
  } });
  h.ready(); const first = await h.loadSnapshot(h.settings, false);
  assert.equal(first.storageError, undefined);
  assert.equal(JSON.parse(h.files.get(CACHE_PATH)).tweets[0].id, tweet().id);
  h.clock.now += 10 * 60000;
  h.setPlan({ tweets: { body: { tweets: [tweet('2')] } }, status: { body: status() } });
  const second = await h.loadSnapshot(h.settings, false);
  assert.equal(second.storageError, undefined);
  const restarted = await harness({ files: h.files, now: h.clock.now + 60000 });
  const cached = await restarted.loadSnapshot(restarted.settings, false);
  assert.equal(restarted.calls.length, 0);
  assert.equal(cached.tweets[0].id, '2');
  assert.equal(cached.tweetsAt, second.tweetsAt);
  assert.equal(h.fileOps.filter(op => op.operation === 'move').length, 0);
});

test('有效缓存未到期时只读，不重复写盘；迁移旧缓存保留同步时间和 Retry-After', async () => {
  const h = await harness(); h.ready(); const first = await h.loadSnapshot(h.settings, false);
  const stored = h.files.get(CACHE_PATH);
  const legacy = JSON.parse(stored);
  legacy.retryAt = { tweets: START + 3600000, status: START + 3600000 };
  h.files.delete(CACHE_PATH); h.files.set(LEGACY_CACHE_PATH, JSON.stringify(legacy));
  h.fileOps.length = 0; h.clock.now += 60000;
  const cached = await h.loadSnapshot(h.settings, false);
  assert.equal(cached.tweetsAt, first.tweetsAt);
  assert.equal(cached.retryAt.tweets, START + 3600000);
  assert.equal(h.calls.length, 2);
  assert.equal(h.fileOps.filter(op => ['writeString', 'move', 'createDirectory'].includes(op.operation)).length, 0);
  h.clock.now += 3600000; h.ready();
  await h.loadSnapshot(h.settings, false);
  assert.equal(JSON.parse(h.files.get(CACHE_PATH)).tweetsAt, new Date(h.clock.now).toISOString());
  h.fileOps.length = 0;
  await h.loadSnapshot(h.settings, false);
  assert.equal(h.fileOps.filter(op => op.operation === 'writeString').length, 0);
});

test('缓存真实写入失败时记录具体错误，保留旧缓存与可显示消息，恢复后清除提示', async () => {
  let unavailable = false;
  const h = await harness({ onFileOperation({ operation, path }) {
    if (unavailable && operation === 'writeString' && path.endsWith('snapshot.json')) throw Error('No space left on device');
  } });
  h.ready(); const first = await h.loadSnapshot(h.settings, false);
  const stored = h.files.get(CACHE_PATH);
  unavailable = true; h.clock.now += 10 * 60000;
  h.setPlan({ tweets: { body: { tweets: [tweet('2')] } }, status: { body: status() } });
  const failed = await h.loadSnapshot(h.settings, false);
  assert.match(failed.storageError, /No space left on device/);
  assert.equal(h.sourceBadge(failed, h.settings).text, '缓存未保存');
  assert.equal(failed.tweets[0].id, '2');
  assert.notEqual(failed.tweetsAt, first.tweetsAt);
  assert.equal(h.files.get(CACHE_PATH), stored);
  assert.ok(h.logs.some(line => line.includes('No space left on device')));
  unavailable = false;
  const recovered = await h.loadSnapshot(h.settings, true);
  assert.equal(recovered.storageError, undefined);
  assert.equal(JSON.parse(h.files.get(CACHE_PATH)).tweets[0].id, '2');
});

test('写入回读不一致会报错并恢复上一次完整缓存，不覆盖已有更新备份', async () => {
  let corruptNext = false;
  const h = await harness({ transformWrite(path, text) {
    if (corruptNext && path === CACHE_PATH) { corruptNext = false; return text.slice(0, 20); }
    return text;
  } });
  h.ready(); await h.loadSnapshot(h.settings, false);
  const stored = h.files.get(CACHE_PATH);
  corruptNext = true; h.clock.now += 10 * 60000;
  const failed = await h.loadSnapshot(h.settings, false);
  assert.match(failed.storageError, /校验失败/);
  assert.equal(h.files.get(CACHE_PATH), stored);
  const { next } = release(); await h.replaceScript(next, true);
  const backupPath = Array.from(h.files.keys()).find(path => /backup-.*\.json$/.test(path));
  const backup = h.files.get(backupPath);
  assert.throws(() => h.writeLocal(backupPath.split('/').at(-1), { bad: undefined, self: 1n }));
  assert.equal(h.files.get(backupPath), backup);
});

test('应用预览显示具体缓存错误，桌面后台仅保留警示和日志', async () => {
  const options = { choice: 1, onFileOperation({ operation }) {
    if (operation === 'writeString') throw Error('Permission denied');
  } };
  const app = await harness(options); app.ready(); await app.main();
  assert.equal(app.messages.at(-1).title, '缓存未保存');
  assert.match(app.messages.at(-1).message, /Permission denied/);
  assert.deepEqual(app.previews, ['medium']);
  assert.ok(app.nodes.some(node => node.text === '缓存未保存'));
  const widget = await harness(options); widget.context.config.runsInApp = false;
  widget.ready(); await widget.main();
  assert.equal(widget.messages.length, 0);
  assert.ok(widget.nodes.some(node => node.text === '缓存未保存'));
  assert.ok(widget.logs.some(message => message.includes('Permission denied')));
});

test('缓存诊断检查读写并清理探测文件，不发网络请求、不改变已有缓存', async () => {
  const h = await harness({ choice: 6 }); h.ready(); await h.loadSnapshot(h.settings, false);
  const stored = h.files.get(CACHE_PATH);
  const requestCount = h.calls.length;
  await h.main();
  assert.equal(h.messages.at(-1).title, '缓存诊断通过');
  assert.match(h.messages.at(-1).message, /Documents|documents/);
  assert.equal(h.files.get(CACHE_PATH), stored);
  assert.equal(h.calls.length, requestCount);
  assert.equal(h.previews.length, 0);
  assert.ok(!Array.from(h.files.keys()).some(path => path.includes('storage-check-')));
  const broken = await harness({ choice: 6, onFileOperation({ operation }) {
    if (operation === 'createDirectory') throw Error('Directory is read-only');
  } });
  await broken.main();
  assert.equal(broken.messages.at(-1).title, '缓存诊断失败');
  assert.match(broken.messages.at(-1).message, /Directory is read-only/);
  assert.equal(broken.calls.length, 0);
});

test('旧版 Library 中的更新备份仍可恢复，之后写入使用本地 Documents', async () => {
  const h = await harness(); const { next } = release();
  await h.replaceScript(next, true);
  const backupPath = Array.from(h.files.keys()).find(path => /backup-.*\.json$/.test(path));
  const legacyPath = backupPath.replace('/documents/', '/library/');
  h.files.set(legacyPath, h.files.get(backupPath)); h.files.delete(backupPath);
  await h.restoreScript();
  assert.equal(h.files.get('/documents/TiboMonitor.js'), source);
  assert.equal(h.messages.at(-1).title, '已恢复');
  h.ready(); const state = await h.loadSnapshot(h.settings, false);
  assert.equal(state.storageError, undefined);
  assert.equal(JSON.parse(h.files.get(CACHE_PATH)).tweets[0].id, tweet().id);
});

test('429 的 Retry-After 跨运行保存，手动刷新也不提前重试', async () => {
  const h = await harness(); h.ready(); await h.loadSnapshot(h.settings, false);
  h.clock.now += 16 * 60000;
  h.setPlan({ tweets: { code: 429, body: {}, headers: { 'retry-after': '3600' } }, status: { body: status() } });
  const limited = await h.loadSnapshot(h.settings, false);
  assert.equal(limited.retryAt.tweets, h.clock.now + 3600000);
  const count = h.calls.filter(call => call.url.endsWith('/tweets')).length;
  h.clock.now += 20 * 60000;
  await h.loadSnapshot(h.settings, true);
  assert.equal(h.calls.filter(call => call.url.endsWith('/tweets')).length, count);
  h.clock.now += 41 * 60000; h.ready(); await h.loadSnapshot(h.settings, false);
  assert.equal(h.calls.filter(call => call.url.endsWith('/tweets')).length, count + 1);
});

test('HTTP 错误即使由原生请求抛出，仍读取限流响应头', async () => {
  const h = await harness();
  h.setPlan({ tweets: { code: 429, headers: { 'Retry-After': new Date(START + 3600000).toUTCString() }, throwWithResponse: true }, status: { body: status() } });
  const state = await h.loadSnapshot(h.settings, false);
  assert.equal(state.retryAt.tweets, START + 3600000);
  assert.equal(state.tweetsAt, null);
});

test('空结果是成功，首次断网不编造消息和刷新时间；历史失败不覆盖当前健康状态', async () => {
  const h = await harness();
  const offline = await h.loadSnapshot(h.settings, false);
  assert.equal(offline.tweets, null); assert.equal(offline.tweetsAt, null);
  h.setPlan({ tweets: { body: { tweets: [] } }, status: { body: { ...status(), lastError: { code: 'OLD_ERROR' } } } });
  const empty = await h.loadSnapshot(h.settings, true);
  assert.equal(empty.tweets.length, 0); assert.ok(empty.tweetsAt);
  assert.equal(h.sourceBadge(empty, h.settings).text, '采集正常');
});

test('SHA-256 与 Node 标准实现一致，覆盖中文、emoji 和分组边界', async () => {
  const h = await harness();
  for (const text of ['', 'abc', '中文 😀\n', 'a'.repeat(55), 'b'.repeat(56), 'c'.repeat(64), source]) {
    assert.equal(h.sha256(text), createHash('sha256').update(text).digest('hex'));
  }
});

function release(version = nextVersion) {
  const next = source.replaceAll(currentVersion, version);
  return { next, manifest: { id: 'tibo-monitor-widget', script: 'TiboMonitor.js', version, sha256: createHash('sha256').update(next).digest('hex') } };
}

test('更新校验拒绝截断代码、错误校验和、版本不匹配及语法错误', async () => {
  const h = await harness(); const { next, manifest } = release();
  assert.doesNotThrow(() => h.validateUpdate(manifest, next));
  assert.throws(() => h.validateUpdate(manifest, next.slice(0, -20)));
  assert.throws(() => h.validateUpdate({ ...manifest, version: '9.9.9' }, next));
  const broken = next + '\nconst = ;';
  assert.throws(() => h.validateUpdate({ ...manifest, sha256: h.sha256(broken) }, broken));
  assert.equal(h.newerVersion('1.10.0', '1.9.9'), true);
  assert.equal(h.newerVersion('1.0.0', '1.0.0'), false);
  assert.equal(h.newerVersion('0.9.9', '1.0.0'), false);
});

test('一键更新固定同一提交，成功备份，可恢复更新前代码', async () => {
  const h = await harness(); const { next, manifest } = release(); const sha = 'a'.repeat(40);
  h.saveLayout('timeline');
  h.setPlan({ main: { body: { sha } }, 'update.json': { body: manifest }, 'TiboMonitor.js': { raw: next } });
  await h.updateScript();
  assert.equal(h.files.get('/documents/TiboMonitor.js'), next);
  assert.equal(new URL(h.launches[0]).searchParams.get('action'), 'refresh');
  assert.ok(h.calls.slice(1).every(call => new URL(call.url).searchParams.get('ref') === sha));
  assert.ok(h.calls.slice(1).every(call => call.headers.Accept === 'application/vnd.github.raw+json'));
  assert.ok(h.calls.every(call => call.redirects() === null));
  await h.restoreScript();
  assert.equal(h.files.get('/documents/TiboMonitor.js'), source);
  assert.equal(h.readLayout(), 'timeline');
});

test('更新下载或写入失败保留原脚本，桌面后台禁止更新', async () => {
  const h = await harness(); const { next, manifest } = release();
  await h.updateScript();
  assert.equal(h.files.get('/documents/TiboMonitor.js'), source);
  h.setPlan({ main: { body: { sha: 'b'.repeat(40) } }, 'update.json': { body: manifest }, 'TiboMonitor.js': { raw: next } });
  h.failScriptWrite(); await h.updateScript();
  assert.equal(h.files.get('/documents/TiboMonitor.js'), source);
  assert.match(h.messages.at(-1).title, /更新失败/);
  assert.equal(h.launches.length, 0);
  assert.equal(h.calls.filter(call => call.url.includes('tibo-monitor.hhyan.me')).length, 0);
  h.context.config.runsInApp = false;
  await assert.rejects(h.updateScript(), /Scriptable 内/);
});

test('更新成功后仅重启一次新版，自动刷新绕过新鲜缓存并保留尺寸和参数', async () => {
  const parameter = '{"count":2,"theme":"dark","refreshMinutes":10}';
  const h = await harness({ scriptName: 'Tibo 动态 &更新', args: { queryParameters: { family: 'large', parameter } } });
  h.ready(); const before = await h.loadSnapshot(h.settings, false);
  h.clock.now += 60000;
  const { next, manifest } = release();
  h.setPlan({ main: { body: { sha: 'c'.repeat(40) } }, 'update.json': { body: manifest }, 'TiboMonitor.js': { raw: next } });
  await h.updateScript();
  assert.equal(h.launches.length, 1);
  const url = new URL(h.launches[0]);
  assert.equal(url.searchParams.get('scriptName'), 'Tibo 动态 &更新');
  assert.equal(url.searchParams.get('action'), 'refresh');
  const restarted = await harness({ source: h.files.get('/documents/TiboMonitor.js'), files: h.files,
    now: h.clock.now, args: { queryParameters: Object.fromEntries(url.searchParams) } });
  restarted.setPlan({ tweets: { body: { tweets: [tweet('2'), tweet('3')] } }, status: { body: status() } });
  await restarted.main();
  assert.equal(restarted.menus.length, 0);
  assert.deepEqual(restarted.previews, ['large']);
  assert.equal(restarted.calls.length, 2);
  assert.equal(restarted.launches.length, 0);
  const after = JSON.parse(h.files.get(CACHE_PATH));
  assert.notEqual(after.tweetsAt, before.tweetsAt);
  assert.equal(restarted.nodes.filter(node => node.text === '中文消息').length, 2);
  assert.equal(restarted.widgets[0].backgroundColor.value, '171C23');
});

test('应用菜单更新默认自动预览中组件；自动刷新仍遵守限流并保留成功时间', async () => {
  const h = await harness({ choice: 3 }); h.ready(); const before = await h.loadSnapshot(h.settings, false);
  h.clock.now += 60000;
  h.setPlan({ tweets: { code: 429, headers: { 'Retry-After': '3600' } }, status: { code: 429, headers: { 'Retry-After': '3600' } } });
  await h.loadSnapshot(h.settings, true);
  h.clock.now += 60000;
  const { next, manifest } = release();
  h.setPlan({ main: { body: { sha: 'f'.repeat(40) } }, 'update.json': { body: manifest }, 'TiboMonitor.js': { raw: next } });
  await h.main();
  assert.equal(h.menus.length, 1);
  assert.equal(h.launches.length, 1);
  const queryParameters = Object.fromEntries(new URL(h.launches[0]).searchParams);
  const restarted = await harness({ source: next, files: h.files, now: h.clock.now, args: { queryParameters } });
  restarted.ready(); await restarted.main();
  assert.equal(restarted.calls.length, 0);
  assert.equal(restarted.menus.length, 0);
  assert.deepEqual(restarted.previews, ['medium']);
  const after = JSON.parse(h.files.get(CACHE_PATH));
  assert.equal(after.tweetsAt, before.tweetsAt);
  assert.ok(restarted.nodes.some(node => /缓存/.test(node.text)));
});

test('自动刷新启动失败时保留已更新代码；已是最新版时不额外刷新', async () => {
  const h = await harness(); const { next, manifest } = release();
  h.setPlan({ main: { body: { sha: 'd'.repeat(40) } }, 'update.json': { body: manifest }, 'TiboMonitor.js': { raw: next } });
  h.failOpen(); await h.updateScript();
  assert.equal(h.files.get('/documents/TiboMonitor.js'), next);
  assert.equal(h.messages.at(-1).title, '更新完成');
  assert.match(h.messages.at(-1).message, /无法启动自动刷新/);
  const latest = await harness();
  latest.setPlan({ main: { body: { sha: 'e'.repeat(40) } }, 'update.json': { body: { ...manifest, version: currentVersion } } });
  await latest.updateScript();
  assert.equal(latest.messages.at(-1).title, '已是最新版本');
  assert.equal(latest.launches.length, 0);
  assert.equal(latest.calls.length, 2);
});

test('失败更新保留上次成功备份；损坏备份不能替换当前代码', async () => {
  const h = await harness(); const first = release();
  await h.replaceScript(first.next, true);
  const backupPath = Array.from(h.files.keys()).find(path => /backup-.*\.json$/.test(path));
  const backup = h.files.get(backupPath);
  h.failScriptWrite(); await assert.rejects(h.replaceScript(release('9.0.0').next, true));
  assert.equal(h.files.get('/documents/TiboMonitor.js'), first.next);
  assert.equal(h.files.get(backupPath), backup);
  h.files.set(backupPath, JSON.stringify({ ...JSON.parse(backup), source: source + '\ncorrupt' }));
  await h.restoreScript();
  assert.equal(h.files.get('/documents/TiboMonitor.js'), first.next);
  assert.match(h.messages.at(-1).message, /备份校验失败/);
});

test('iCloud 中的脚本使用同一备份和更新流程', async () => {
  const h = await harness({ cloud: true }); const { next } = release();
  await h.replaceScript(next, true); assert.equal(h.files.get('/documents/TiboMonitor.js'), next);
  await h.restoreScript(); assert.equal(h.files.get('/documents/TiboMonitor.js'), source);
});

test('目标文件存在且所有 move 都失败时，重复更新与恢复仍成功', async () => {
  for (const cloud of [false, true]) {
    const h = await harness({ cloud, rejectMove: true });
    const first = release(), second = release('9.0.0');
    await h.replaceScript(first.next, true);
    await h.replaceScript(second.next, true);
    assert.equal(h.files.get('/documents/TiboMonitor.js'), second.next);
    await h.restoreScript();
    assert.equal(h.files.get('/documents/TiboMonitor.js'), first.next);
    assert.equal(h.fileOps.filter(op => op.operation === 'move').length, 0);
  }
});

test('脚本覆盖写入不完整会恢复原文，并校验恢复结果', async () => {
  let corrupt = true;
  const h = await harness({ transformWrite(path, text) {
    if (corrupt && path === '/documents/TiboMonitor.js') { corrupt = false; return text.slice(0, 30); }
    return text;
  } });
  await assert.rejects(h.replaceScript(release().next, true), /已保留原脚本.*替换文件校验失败/);
  assert.equal(h.files.get('/documents/TiboMonitor.js'), source);
});

test('发布清单和待发布代码完全匹配', async () => {
  const h = await harness();
  const manifest = JSON.parse(await readFile(new URL('../update.json', import.meta.url), 'utf8'));
  assert.doesNotThrow(() => h.validateUpdate(manifest, source));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.version, pkg.version);
});
