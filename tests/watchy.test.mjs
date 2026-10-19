import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../watchy/TiboWatchy.js',import.meta.url),'utf8');
const NOW=Date.parse('2026-10-19T10:30:00Z');
const post=(id='2112039275344941371',extra={})=>({id,text:'Original post',isDemo:false,publishedAt:'2026-10-19T04:32:57Z',translation:{status:'complete',text:'新的中文消息'},resetClassification:{status:'complete',isResetAnnouncement:false},...extra});
async function run({body={tweets:[post()]},status=200,networkError=false,noFetch=false,hang=false,script=source}={}){
  const outputs=[],calls=[];let timeout,resolveFetch;
  class Clock extends Date {constructor(...args){super(...(args.length?args:[NOW]));}static now(){return NOW;}}
  const context={Date:Clock,sendToWidgy:value=>outputs.push(value),setTimeout:fn=>{timeout=fn;return 1;},clearTimeout(){}};
  const response={ok:status>=200&&status<300,status,json:()=>Promise.resolve(body)};
  if(!noFetch)context.fetch=(url,options)=>{calls.push({url,options});return hang?new Promise(resolve=>{resolveFetch=resolve;}):networkError?Promise.reject(Error('offline')):Promise.resolve(response);};
  vm.runInNewContext(script,context);
  await new Promise(resolve=>setImmediate(resolve));
  return {outputs,calls,timeout,complete:()=>resolveFetch?.(response)};
}
test('Watchy 一个文字层仅请求一次，中文与成功时间同次返回',async()=>{
  const h=await run();assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,'https://tibo-monitor.hhyan.me/api/tweets');
  assert.equal(h.calls[0].options.credentials,'omit');assert.equal(h.calls[0].options.cache,'no-store');
  assert.equal(h.outputs[0],'Tibo · 刷新 10/19 18:30\n新的中文消息\n帖 10/19 12:32 · 重置：否');
});
test('Watchy 按发布时间和精确字符串 ID 选最新，翻译未完成保留状态，判定未完成不当作否',async()=>{
  const h=await run({body:{tweets:[post('2112039275344941370'),post('2112039275344941371',{translation:{status:'pending',text:'未完成的内容'},resetClassification:{status:'processing',isResetAnnouncement:false}})]}});
  assert.match(h.outputs[0],/【待译】Original post/);assert.match(h.outputs[0],/重置：待判定/);assert.doesNotMatch(h.outputs[0],/未完成的内容/);
});
test('Watchy 网络失败、无效结构、HTTP 429 及不支持 fetch 时均不伪造成功时间',async()=>{
  for(const options of [{networkError:true},{body:{tweets:[post('123',{publishedAt:'bad'})]}},{body:{}},{status:429},{noFetch:true}]){
    const h=await run(options);assert.equal(h.outputs.length,1);assert.match(h.outputs[0],/刷新失败/);assert.doesNotMatch(h.outputs[0],/10\/19 18:30/);
  }
});
test('Watchy 空数组是真实成功；演示记录明确标识，长文本按字符截断',async()=>{
  assert.equal((await run({body:{tweets:[]}})).outputs[0],'Tibo · 刷新 10/19 18:30\n暂无公开消息');
  const h=await run({body:{tweets:[post('123',{isDemo:true,translation:{status:'complete',text:'🌞'.repeat(50)}})]}});
  assert.match(h.outputs[0],/^【演示】/);assert.equal(Array.from(h.outputs[0].split('\n')[1]).length,28);
});
test('Watchy 超时仅结束一次，延迟成功不能再发送内容',async()=>{
  const h=await run({hang:true});assert.equal(h.outputs.length,0);h.timeout();h.timeout();assert.equal(h.outputs.length,1);assert.match(h.outputs[0],/超时/);
  h.complete();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.outputs.length,1);assert.match(h.outputs[0],/超时/);
  const ok=await run();ok.timeout();assert.equal(ok.outputs.length,1);
});
