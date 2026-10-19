import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = (await readFile(new URL('../TiboMonitor.js', import.meta.url), 'utf8')).replace('try { await main(); } finally { Script.complete(); }', '');
const fm = { libraryDirectory: () => '/unused', documentsDirectory: () => '/unused', joinPath: (a, b) => a + '/' + b };
const api = await vm.runInNewContext(`(async () => { ${source}\nreturn { validateTweets, validateStatus }; })()`, { FileManager: { local: () => fm } });
const base = 'https://tibo-monitor.hhyan.me';
const result = await Promise.all(['tweets', 'status'].map(async name => {
  const response = await fetch(base + '/api/' + name, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(name + ' HTTP ' + response.status);
  const payload = await response.json();
  return name === 'tweets' ? api.validateTweets(payload) : api.validateStatus(payload);
}));
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), count: result[0].length, latestPublishedAt: result[0][0]?.publishedAt, source: result[1].source }, null, 2));
