// test/waf_repro_user_page_test.js - 拉取用户实际分析的目标页面，复现分块语料，逐块测试 WAF
'use strict';
const fs = require('fs');
const path = require('path');
let src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'analyze.js'), 'utf8').replace(/^'use strict';/, '');
global.document = { getElementById: () => ({ classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, style: {} }), createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }), addEventListener() {} };
global.chrome = { storage: { local: { get: async () => ({ settings: {} }), set: async () => {} } }, tabs: { get: async () => ({}) }, runtime: { getURL: () => '', sendMessage: async () => null }, scripting: {} };
global.location = { search: '' };
eval(src + ';global.__R={obfuscateForWaf};');

const PAGE = 'http://39.153.247.156:8200/jacloud-web/modules/login.html';
const ORIGIN = 'http://39.153.247.156:8200';
const URL_ = 'http://newh.ffishing.top:11434/v1/chat/completions';
const KEY = 'Bearer wbgw-7f3a9c2e5b1d8460';

async function probe(content, label) {
  const body = JSON.stringify({ model: 'auto', stream: false, messages: [{ role: 'user', content: '回复OK:\n' + content }] });
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': KEY }, body, signal: ctrl.signal });
    clearTimeout(timer);
    const t = await r.text();
    const waf = r.status === 403 && /<!DOCTYPE/.test(t);
    return `${r.status}${waf ? '[WAF]' : ''}`;
  } catch (e) { return 'ERR:' + String(e.cause ? e.cause.code : e.message).slice(0, 30); }
}

async function main() {
  // 1. 拉取页面与同域脚本（模拟扩展采集）
  const page = await (await fetch(PAGE)).text();
  const srcs = [...page.matchAll(/<script src="([^"]+)"/g)].map(m => m[1])
    .filter(u => /^https?:/.test(u) ? new URL(u).host === new URL(PAGE).host : true)
    .map(u => u.startsWith('http') ? u : new URL(u, PAGE).href);
  const bodies = {};
  for (const u of [...new Set(srcs)]) {
    try { bodies[u] = await (await fetch(u)).text(); } catch (e) { bodies[u] = ''; }
  }

  // 2. 组装语料块（模拟 buildCorpus 输出结构 + 新的框架库跳过逻辑）
  const LIB_NAME_RE = /(^|[/\-.])(jquery|jquery[-.]ui|vue|bootstrap|angular|react|react[-.]dom|lodash|zepto|layui|swiper|moment|echarts|element[-.]ui|element[-.]plus|antd|axios|underscore|backbone|prototype|dojo|mootools|modernizr|fastclick|slimscroll|html5shiv|respond|jquery\.validate|jquery\.form|lazyload|layer|plupload|ueditor|kindeditor|chart\.js|d3|three|gsap|swiper|animate|wow|skel)([/\-.]|$)/i;
  const skippedLibs = [];
  const blocks = [
    { label: 'HTML 源码', text: page },
    { label: '外链脚本: config.js', text: bodies[ORIGIN + '/jacloud-web/common/conf/config.js'] || '' },
    { label: '外链脚本: app.js', text: bodies[ORIGIN + '/jacloud-web/common/libs/app.js'] || '' },
    { label: '外链脚本: slimscroll', text: bodies[ORIGIN + '/jacloud-web/common/libs/jquery.slimscroll.min.js'] || '' },
    { label: '外链脚本: fastclick', text: bodies[ORIGIN + '/jacloud-web/common/libs/fastclick.min.js'] || '' },
    { label: '外链脚本: bootstrap.min.js', text: bodies[ORIGIN + '/jacloud-web/common/libs/bootstrap.min.js'] || '' },
    { label: '外链脚本: vue.min.js', text: bodies[ORIGIN + '/jacloud-web/common/libs/vue.min.js'] || '' },
    { label: '外链脚本: jquery.min.js', text: bodies[ORIGIN + '/jacloud-web/common/libs/jquery.min.js'] || '' }
  ].filter(b => {
    if (!b.text) return false;
    const fname = b.label.includes(': ') ? b.label.split(': ')[1] : '';
    const isLib = LIB_NAME_RE.test(fname) || (/min\.js/i.test(fname) && b.text.length > 30000);
    if (isLib) { skippedLibs.push(fname); return false; }
    return true;
  });
  console.log('按新逻辑跳过框架库:', skippedLibs.join(', ') || '无');

  // 3. 按 20000 字符分块（与扩展默认一致）并打散
  const CHUNK = 20000;
  const chunks = [];
  let cur = [], curLen = 0;
  for (const b of blocks) {
    if (curLen + b.text.length > CHUNK && cur.length) { chunks.push(cur); cur = []; curLen = 0; }
    cur.push(b); curLen += b.text.length;
  }
  if (cur.length) chunks.push(cur);
  console.log(`共 ${chunks.length} 块`);

  // 4. 逐块测 WAF
  for (let i = 0; i < chunks.length; i++) {
    const obf = chunks[i].map(b => `===== ${b.label} =====\n${global.__R.obfuscateForWaf(b.text)}`).join('\n\n');
    const res = await probe(obf, `chunk${i + 1}`);
    console.log(`块${i + 1}（${obf.length}字符, ${chunks[i].map(b => b.label).join('+').slice(0, 80)}） => ${res}`);
    fs.writeFileSync(path.join(__dirname, `repro_chunk_${i + 1}.txt`), obf);
    await new Promise(s => setTimeout(s, 2000));
  }
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
