// test/waf_minified_probe_test.js - 对照实验：无害压缩代码片段是否触发 WAF 启发式
'use strict';
const fs = require('fs');
const path = require('path');
let src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'analyze.js'), 'utf8').replace(/^'use strict';/, '');
global.document = { getElementById: () => ({ classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, style: {} }), createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }), addEventListener() {} };
global.chrome = { storage: { local: { get: async () => ({ settings: {} }), set: async () => {} } }, tabs: { get: async () => ({}) }, runtime: { getURL: () => '', sendMessage: async () => null }, scripting: {} };
global.location = { search: '' };
eval(src + ';global.__R={obfuscateForWaf};');

(async () => {
  const jq = fs.readFileSync(path.join(__dirname, 'repro_chunk_6.txt'), 'utf8');
  // 取中段 3000 字符（纯 jquery 压缩代码，无攻击特征）
  const slice = global.__R.obfuscateForWaf(jq.slice(30000, 33000));
  const body = JSON.stringify({ model: 'auto', stream: false, messages: [{ role: 'user', content: '回复OK:\n' + slice }] });
  try {
    const r = await fetch('http://newh.ffishing.top:11434/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer wbgw-7f3a9c2e5b1d8460' },
      body
    });
    const t = await r.text();
    const waf = r.status === 403 && /<!DOCTYPE/.test(t);
    console.log('jquery中段3KB =>', r.status, waf ? '[WAF拦截]' : '', String(t).slice(0, 60).replace(/\n/g, ' '));
  } catch (e) {
    console.log('异常', String(e.cause ? e.cause.code : e.message).slice(0, 40));
  }
})();
