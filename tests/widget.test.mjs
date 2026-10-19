import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const source = await readFile(new URL('../TiboMonitor.js', import.meta.url), 'utf8');
const definitions = source.replace('try { await main(); } finally { Script.complete(); }', '');
const START = Date.parse('2026-10-19T04:30:00Z');
const tweet = (id = '2111990254408434095', overrides = {}) => ({ id, text: 'Original post',
  url: `https://x.com/thsottiaux/status/${id}`, publishedAt: '2026-10-19T01:18:10Z', isDemo: false,
  translation: { status: 'complete', text: '中文消息' }, resetClassification: { status: 'complete', isResetAnnouncement: false }, ...overrides });
const status = (overrides = {}) => ({ source: { state: 'healthy', lastSuccessAt: '2026-10-19T04:28:00Z', ...overrides }, intervalMinutes: 5, demo: false });

async function harness(options = {}) {
  const clock = { now: START };
  const files = new Map([['/documents/TiboMonitor.js', source]]);
  const calls = [], nodes = [], messages = [];
  let plan = {}, moveFailure = false;
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  const fm = {
    libraryDirectory: () => '/library', documentsDirectory: () => '/documents', joinPath: (a, b) => `${a}/${b}`,
    fileExists: path => files.has(path), createDirectory: path => files.set(path, null),
    readString(path) { if (!files.has(path)) throw Error('missing'); return files.get(path); },
    writeString: (path, text) => files.set(path, text), remove: path => files.delete(path),
    move(a, b) { if (moveFailure && b.endsWith('TiboMonitor.js')) throw Error('disk failure'); files.set(b, fm.readString(a)); files.delete(a); },
    isFileStoredIniCloud: () => options.cloud === true, async downloadFileFromiCloud() {},
  };
  class Element {
    constructor(type = 'stack', text = '') { this.type = type; this.text = text; this.children = []; nodes.push(this); }
    addStack() { const child = new Element(); this.children.push(child); return child; }
    addText(text) { const child = new Element('text', text); this.children.push(child); return child; }
    addSpacer() {} centerAlignContent() {} layoutVertically() {} setPadding() {}
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
  const context = { FileManager: { local: () => fm, iCloud: () => fm }, Request, Date: FakeDate,
    ListWidget: Element, Font: { systemFont: size => size, semiboldSystemFont: size => size },
    Color: class { constructor(value) { this.value = value; } static dynamic(light) { return light; } },
    Script: { name: () => 'TiboMonitor', setWidget() {}, complete() {} },
    config: { runsInApp: true }, args: {}, module: { filename: '/documents/TiboMonitor.js' },
    Alert: class { addAction() {} async presentAlert() { messages.push({ title: this.title, message: this.message }); } },
  };
  const names = ['settingsFor', 'validateTweets', 'validateStatus', 'loadSnapshot', 'textFor', 'resetLabel',
    'beijingTime', 'sourceBadge', 'renderWidget', 'sha256', 'newerVersion', 'validateUpdate', 'replaceScript', 'updateScript', 'restoreScript'];
  const api = await vm.runInNewContext(`(async () => { ${definitions}\nreturn {${names.join(',')}}; })()`, context);
  return { ...api, clock, files, calls, nodes, messages, context, settings: api.settingsFor(null, 'medium'),
    setPlan: value => { plan = value; }, failMove: () => { moveFailure = true; },
    ready: () => { plan = { tweets: { body: { tweets: [tweet()] } }, status: { body: status() } }; } };
}

test('默认尺寸为 1/3/6，参数有边界且更新不依赖源码配置', async () => {
  const h = await harness();
  for (const [family, count] of [['small', 1], ['medium', 3], ['large', 6]]) assert.equal(h.settingsFor(null, family).count, count);
  assert.equal(h.settingsFor('2', 'medium').count, 2);
  assert.equal(h.settingsFor('{"counts":{"large":5},"theme":"dark"}', 'large').count, 5);
  for (const parameter of ['oops', '-1', '4', '{"refreshMinutes":0}', '{"theme":"unknown"}']) assert.throws(() => h.settingsFor(parameter, 'medium'));
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

test('多组件共享缓存，成功读取才推进同步时间，网络失败保留旧消息', async () => {
  const h = await harness(); h.ready();
  const first = await h.loadSnapshot(h.settings, false);
  assert.equal(h.calls.length, 2);
  h.clock.now += 60000;
  const cached = await h.loadSnapshot(h.settings, false);
  assert.equal(h.calls.length, 2);
  assert.equal(cached.tweetsAt, first.tweetsAt);
  h.clock.now += 15 * 60000; h.setPlan({});
  const failed = await h.loadSnapshot(h.settings, false);
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

function release(version = '1.0.1') {
  const next = source.replaceAll('1.0.0', version);
  return { next, manifest: { id: 'tibo-monitor-widget', script: 'TiboMonitor.js', version, sha256: createHash('sha256').update(next).digest('hex') } };
}

test('更新校验拒绝截断代码、错误校验和、版本不匹配及语法错误', async () => {
  const h = await harness(); const { next, manifest } = release();
  assert.doesNotThrow(() => h.validateUpdate(manifest, next));
  assert.throws(() => h.validateUpdate(manifest, next.slice(0, -20)));
  assert.throws(() => h.validateUpdate({ ...manifest, version: '1.0.2' }, next));
  const broken = next + '\nconst = ;';
  assert.throws(() => h.validateUpdate({ ...manifest, sha256: h.sha256(broken) }, broken));
  assert.equal(h.newerVersion('1.10.0', '1.9.9'), true);
  assert.equal(h.newerVersion('1.0.0', '1.0.0'), false);
  assert.equal(h.newerVersion('0.9.9', '1.0.0'), false);
});

test('一键更新固定同一提交，成功备份，可恢复更新前代码', async () => {
  const h = await harness(); const { next, manifest } = release(); const sha = 'a'.repeat(40);
  h.setPlan({ main: { body: { sha } }, 'update.json': { body: manifest }, 'TiboMonitor.js': { raw: next } });
  await h.updateScript();
  assert.equal(h.files.get('/documents/TiboMonitor.js'), next);
  assert.match(h.messages.at(-1).title, /更新完成/);
  assert.ok(h.calls.slice(1).every(call => call.url.includes(`/${sha}/`)));
  assert.ok(h.calls.every(call => call.redirects() === null));
  await h.restoreScript();
  assert.equal(h.files.get('/documents/TiboMonitor.js'), source);
});

test('更新下载或写入失败保留原脚本，桌面后台禁止更新', async () => {
  const h = await harness(); const { next, manifest } = release();
  await h.updateScript();
  assert.equal(h.files.get('/documents/TiboMonitor.js'), source);
  h.setPlan({ main: { body: { sha: 'b'.repeat(40) } }, 'update.json': { body: manifest }, 'TiboMonitor.js': { raw: next } });
  h.failMove(); await h.updateScript();
  assert.equal(h.files.get('/documents/TiboMonitor.js'), source);
  assert.match(h.messages.at(-1).title, /更新失败/);
  h.context.config.runsInApp = false;
  await assert.rejects(h.updateScript(), /Scriptable 内/);
});

test('失败更新保留上次成功备份；损坏备份不能替换当前代码', async () => {
  const h = await harness(); const first = release('1.0.1');
  await h.replaceScript(first.next, true);
  const backupPath = Array.from(h.files.keys()).find(path => /backup-.*\.json$/.test(path));
  const backup = h.files.get(backupPath);
  h.failMove(); await assert.rejects(h.replaceScript(release('1.0.2').next, true));
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

test('发布清单和待发布代码完全匹配', async () => {
  const h = await harness();
  const manifest = JSON.parse(await readFile(new URL('../update.json', import.meta.url), 'utf8'));
  assert.doesNotThrow(() => h.validateUpdate(manifest, source));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.version, pkg.version);
});
