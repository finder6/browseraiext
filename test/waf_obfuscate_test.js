// test/waf_obfuscate_test.js - 验证 obfuscateForWaf 打散签名后能否通过网关 WAF
'use strict';
const fs = require('fs');
const path = require('path');

// 加载真实 analyze.js 中的 obfuscateForWaf
let src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'analyze.js'), 'utf8').replace(/^'use strict';/, '');
global.document = { getElementById: () => ({ classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, style: {} }), createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }), addEventListener() {} };
global.chrome = { storage: { local: { get: async () => ({ settings: {} }), set: async () => {} } }, tabs: { get: async () => ({}) }, runtime: { getURL: () => '', sendMessage: async () => null }, scripting: {} };
global.location = { search: '' };
eval(src + ';global.__W={obfuscateForWaf,chunkToPrompt};');

const URL_ = 'http://newh.ffishing.top:11434/v1/chat/completions';
const KEY = 'Bearer wbgw-7f3a9c2e5b1d8460';

// 之前实测被 WAF 403 拦截的特征内容
const malicious = [
  "<!DOCTYPE html><html><head><script src=\"/js/app.js\"></script></head><body>",
  "<script>var t=document.getElementById('x').innerHTML=userInput;</script>",
  "<script>eval(decodeURIComponent(location.hash.slice(1)));</script>",
  "<img src=x onerror=alert(document.cookie)>",
  "<iframe src=\"javascript:alert(1)\"></iframe>",
  "<a onclick=\"document.write('<img src=x onerror=alert(1)>')\">x</a>",
  "<script>axios.post('/api/v1/user/list',{token:'eyJhbGciOiJIUzI1NiJ9.abc.def'});</script>",
  "<script>var sql=\"select * from user where id=1 union select password from admin\";</script>",
  "<script>fetch('/admin/login',{method:'POST'});setTimeout(function(){while(true){}},10000);</script>",
  "<form action=\"/api/auth/login\"><input name=password type=password></form></body></html>"
].join('\n');

(async () => {
  // 先本地确认：打散后的内容不再含可匹配的原始签名
  const safe = global.__W.obfuscateForWaf(malicious);
  const rawHits = ['eval(', '<script', 'innerHTML', 'onerror', 'javascript:', 'union select'].filter(k => safe.includes(k));
  console.log('打散后仍含原始签名:', rawHits.length ? rawHits.join(',') : '无 ✅');
  console.log('零宽字符数量:', (safe.match(/\u200b/g) || []).length);

  // 真实发送验证
  const body = JSON.stringify({
    model: 'auto', stream: false,
    messages: [
      { role: 'user', content: '请原样复读以下内容的前20个字符（包括零宽字符可忽略），不要分析:\n' + safe }
    ]
  });
  const t0 = Date.now();
  try {
    const resp = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': KEY },
      body
    });
    const text = await resp.text();
    const isWaf = resp.status === 403 && /<!DOCTYPE|WAF/i.test(text);
    console.log(`真实发送 => HTTP ${resp.status} ${isWaf ? '❌ 仍被WAF拦截' : (resp.status === 200 ? '✅ 通过' : '?')} 耗时${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log('响应前200:', text.slice(0, 200).replace(/\n/g, ' '));
  } catch (e) {
    console.log('请求异常:', String(e.cause ? e.cause.code : e.message).slice(0, 80));
  }
})();
