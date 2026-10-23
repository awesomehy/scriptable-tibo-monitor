// Approximate browser rendering of the actual Scriptable widget tree. No live requests.
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = (await readFile(new URL('../TiboMonitor.js', import.meta.url), 'utf8'))
  .replace('try { await main(); } finally { Script.complete(); }', '');
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const now = Date.parse('2026-10-24T15:58:00Z');
const fixtures = [
  '第 18 天 / Decisions API 正式发布，OpenResponses 加入支持。',
  '第 17 天 / 你本来以为我们忘了吧，但其实没有，今天就是更新的日子。',
  '点，点点，最点。',
  '新的工具与更快的响应速度，开发进展持续更新。',
  '继续打磨细节，让日常开发更顺畅。',
  '本周的更新回顾，看看最近有哪些变化。',
  '更多功能正在路上。',
];

function capture(family, layout, scenario = 'ready', count, dark = false) {
  const nodes = [];
  class Node {
    constructor(kind = 'stack', value) { Object.assign(this, { kind, value, direction: kind === 'widget' ? 'column' : 'row', children: [] }); nodes.push(this); }
    add(kind, value) { const node = new Node(kind, value); this.children.push(node); return node; }
    addStack() { return this.add('stack'); }
    addText(value) { return this.add('text', value); }
    addSpacer(value) { return this.add('spacer', value); }
    layoutVertically() { this.direction = 'column'; }
    centerAlignContent() { this.align = 'center'; }
    setPadding(...padding) { this.padding = padding; }
  }
  class Size { constructor(width, height) { Object.assign(this, { width, height }); } }
  class Color { constructor(hex) { this.hex = '#' + hex; } static dynamic(light, night) { return dark ? night : light; } }
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const api = vm.runInNewContext(`${source}\n;({settingsFor, renderWidget})`, {
    Date: Clock, ListWidget: class extends Node { constructor() { super('widget'); } }, Size, Color,
    Font: { systemFont: size => ({ size, weight: 400 }), semiboldSystemFont: size => ({ size, weight: 600 }) },
    FileManager: { local: () => ({ documentsDirectory: () => '/documents', libraryDirectory: () => '/library', joinPath: (a, b) => a + '/' + b }) },
    Keychain: { contains: () => false }, Script: { name: () => 'TiboMonitor' },
  });
  const posts = fixtures.map((text, i) => ({ id: String(100 + i), text, publishedAt: new Date(now - i * 86400000 - 600000).toISOString(), url: 'https://x.com/thsottiaux/status/' + (100 + i), isDemo: true,
    translation: { status: 'complete', text: scenario === 'long' ? '这是一条很长的推文，展示时使用固定字号并按行数截断。'.repeat(12) : text },
    resetClassification: { status: i === 2 ? 'pending' : 'complete', isResetAnnouncement: i < 2 },
  }));
  const state = { tweets: scenario === 'empty' ? [] : scenario === 'error' ? null : posts,
    status: { source: { state: 'healthy', lastSuccessAt: new Date(now - 120000).toISOString() }, intervalMinutes: 5 },
    tweetsAt: scenario === 'error' ? null : new Date(now).toISOString(), errors: scenario === 'stale' || scenario === 'error' ? { tweets: '网络连接失败' } : {}, nextRefresh: new Date(now + 600000) };
  const settings = api.settingsFor(JSON.stringify({ layout, ...(count ? { count } : {}) }), family);
  const widget = api.renderWidget(state, settings, family);
  const bodies = nodes.filter(node => node.kind === 'text' && node.value.startsWith('【演示】'));
  assert.equal(bodies.length, scenario === 'empty' || scenario === 'error' ? 0 : settings.count);
  assert.ok(bodies.every(node => node.font.size === 12 && node.minimumScaleFactor === 1));
  assert.ok(nodes.some(node => node.kind === 'text' && node.value.startsWith(family === 'small' ? '同步 ' : '上次同步 ')));
  assert.ok(nodes.some(node => node.kind === 'text' && node.value.startsWith(family === 'small' ? '采集 ' : '网站采集 ')));
  return widget;
}

function html(node, direction = 'column') {
  if (node.kind === 'spacer') return `<i style="display:block;${node.value === undefined ? 'flex:1;min-width:0;min-height:0' : `flex:none;${direction === 'column' ? 'height' : 'width'}:${node.value}px`}"></i>`;
  if (node.kind === 'text') return `<span class="native-text" style="font-size:${node.font.size}px;font-weight:${node.font.weight};color:${node.textColor.hex};${node.lineLimit > 1 ? `display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${node.lineLimit};white-space:normal` : ''}">${esc(node.value)}</span>`;
  const css = ['display:flex', `flex-direction:${node.direction}`, 'min-width:0', 'flex-shrink:0'];
  if (node.kind === 'widget') css.push('box-sizing:border-box');
  else if (direction === 'row' && !node.size?.width) css.push('flex:1');
  if (node.padding) css.push(`padding:${node.padding.map(n => n + 'px').join(' ')}`);
  if (node.align) css.push(`align-items:${node.align}`);
  if (node.backgroundColor) css.push(`background:${node.backgroundColor.hex}`);
  if (node.cornerRadius) css.push(`border-radius:${node.cornerRadius}px`);
  if (node.size?.width) css.push(`width:${node.size.width}px`);
  if (node.size?.height) css.push(`height:${node.size.height}px`);
  return `<div class="${node.kind}" style="${css.join(';')}">${node.children.map(child => html(child, node.direction)).join('')}</div>`;
}

const states = {};
for (const layout of ['original', 'night', 'news', 'timeline', 'timeline-dark']) for (const scenario of ['ready', 'long', 'stale', 'empty', 'error']) for (const density of ['default', 'max']) for (const dark of [false, true]) {
  const key = [layout, scenario, density, dark ? 'dark' : 'light'].join('/'); states[key] = {};
  for (const family of ['small', 'medium', 'large']) states[key][family] = html(capture(family, layout, scenario, density === 'max' ? { small: 2, medium: 3, large: 7 }[family] : undefined, dark));
}
const output = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tibo 动态 · 布局预览</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f4f4f5;color:#1d2633;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}main{max-width:1160px;padding:36px;margin:auto}h1{margin:0 0 10px;font-size:28px}.controls{display:flex;gap:16px;flex-wrap:wrap;margin:24px 0}label{font-size:12px;color:#64748b}select{display:block;margin-top:7px;padding:9px 12px;border:1px solid #ddd;border-radius:8px;background:white}.stage{display:flex;flex-wrap:wrap;align-items:start;gap:28px;background:linear-gradient(130deg,#5288a0,#617688);border-radius:28px;padding:28px}.device-label{color:#fff9;margin:0 0 12px}.widget{width:164px;height:164px;border-radius:26px;overflow:hidden}.medium .widget{width:344px}.large .widget{width:344px;height:364px}.native-text{display:block;flex-shrink:0;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}p{color:#64748b;line-height:1.8}a{color:#2563eb}#version{font-size:11px;color:#64748b}</style><main><div id="version">Scriptable · 1.0.6</div><h1>Tibo 动态，五种阅读方式。</h1><p>运行脚本 → 外观布局。所有示例由实际脚本的组件树生成。</p><div class="controls">
<label>布局<select id="layout"><option value="original">原版苔绿</option><option value="night">极夜卡片</option><option value="news">蓝白简报</option><option value="timeline">暖色时间线</option><option value="timeline-dark">暗色时间线</option></select></label>
<label>状态<select id="scenario"><option value="ready">示例消息</option><option value="long">长文本</option><option value="stale">刷新失败 · 旧缓存</option><option value="empty">暂无消息</option><option value="error">无缓存 · 网络失败</option></select></label>
<label>条数<select id="density"><option value="default">默认 1 / 3 / 6</option><option value="max">最多 2 / 3 / 7</option></select></label>
<label>系统外观<select id="theme"><option value="light">浅色</option><option value="dark">深色</option></select></label></div>
<div class="stage">${['small', 'medium', 'large'].map((family, i) => `<section class="${family}"><div class="device-label">${['小号', '中号', '大号'][i]}</div><div id="${family}"></div></section>`).join('')}</div>
<p>仅使用示例消息，时钟固定为 2026-10-24 23:58。浏览器排版与 iOS 存在差异，请以设备预览为准。<br><a href="TiboMonitor.js">脚本源码</a> · <a href="README.md">安装与设置说明</a></p></main>
<script>const states=${JSON.stringify(states).replace(/</g, '\\u003c')};function update(){const key=['layout','scenario','density','theme'].map(id=>document.getElementById(id).value).join('/');for(const family of ['small','medium','large'])document.getElementById(family).innerHTML=states[key][family];}document.querySelectorAll('select').forEach(s=>s.addEventListener('change',update));update();</script></html>`;
await writeFile(new URL('../preview.html', import.meta.url), output);
console.log('Generated preview.html from 300 native widget trees; fixed fonts, counts and timestamps verified.');
export { capture, html };
