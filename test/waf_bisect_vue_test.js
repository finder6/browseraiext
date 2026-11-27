// test/waf_bisect_vue_test.js - 在被 WAF 拦截的块内容中二分定位最小触发子串
'use strict';
const fs = require('fs');
const path = require('path');
let src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'analyze.js'), 'utf8').replace(/^'use strict';/, '');
global.document = { getElementById: () => ({ classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, style: {} }), createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }), addEventListener() {} };
global.chrome = { storage: { local: { get: async () => ({ settings: {} }), set: async () => {} } }, tabs: { get: async () => ({}) }, runtime: { getURL: () => '', sendMessage: async () => null }, scripting: {} };
global.location = { search: '' };
eval(src + ';global.__R={obfuscateForWaf};');

const URL_ = 'http://newh.ffishing.top:11434/v1/chat/completions';
const KEY = 'Bearer wbgw-7f3a9c2e5b1d8460';

async function probe(content) {
  const body = JSON.stringify({ model: 'auto', stream: false, messages: [{ role: 'user', content: '回复OK:\n' + content }] });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': KEY }, body, signal: ctrl.signal });
    clearTimeout(timer);
    const t = await r.text();
    return !(r.status === 403 && /<!DOCTYPE/.test(t)); // true = 通过
  } catch (e) { clearTimeout(timer); return true; } // 网络异常不当作拦截
}

(async () => {
  // 原始 vue.min.js（未打散），后续每段测试前现打散
  const page = fs.readFileSync(path.join(__dirname, 'repro_chunk_5.txt'), 'utf8');
  const vueStart = page.indexOf('===== 外链脚本: vue.min.js =====');
  const raw = page.slice(vueStart);
  console.log('目标长度:', raw.length);

  const MIN = 300;
  async function bisect(text, depth) {
    if (text.length <= MIN) return text;
    const mid = Math.floor(text.length / 2);
    const a = text.slice(0, mid), b = text.slice(mid);
    const okA = await probe(global.__R.obfuscateForWaf(a));
    await new Promise(s => setTimeout(s, 1500));
    if (!okA) { console.log(`depth${depth}: 前半 ${a.length} 触发`); return bisect(a, depth + 1); }
    console.log(`depth${depth}: 前半通过，查后半`);
    return bisect(b, depth + 1);
  }

  const minimal = await bisect(raw, 0);
  console.log('\n=== 最小触发子串（', minimal.length, '字符）===');
  console.log('打散后:', JSON.stringify(global.__R.obfuscateForWaf(minimal).replace(/\u200b/g, '␣').slice(0, 800)));
  console.log('原始:', JSON.stringify(minimal.slice(0, 800)));
})();
