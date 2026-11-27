// test/waf_bisect_test.js - 逐行定位 WAF 触发行
'use strict';
const fs = require('fs');
const path = require('path');
let src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'analyze.js'), 'utf8').replace(/^'use strict';/, '');
global.document = { getElementById: () => ({ classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, style: {} }), createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }), addEventListener() {} };
global.chrome = { storage: { local: { get: async () => ({ settings: {} }), set: async () => {} } }, tabs: { get: async () => ({}) }, runtime: { getURL: () => '', sendMessage: async () => null }, scripting: {} };
global.location = { search: '' };
eval(src + ';global.__W={obfuscateForWaf};');

const URL_ = 'http://newh.ffishing.top:11434/v1/chat/completions';
const KEY = 'Bearer wbgw-7f3a9c2e5b1d8460';

const lines = [
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
];

async function probe(content) {
  const safe = global.__W.obfuscateForWaf(content);
  const body = JSON.stringify({ model: 'auto', stream: false, messages: [{ role: 'user', content: '回复OK:\n' + safe }] });
  try {
    const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': KEY }, body });
    const t = await r.text();
    return `${r.status}${r.status === 403 && /<!DOCTYPE/.test(t) ? '[WAF]' : ''}`;
  } catch (e) { return 'ERR:' + String(e.cause ? e.cause.code : e.message).slice(0, 30); }
}

(async () => {
  for (let i = 0; i < lines.length; i++) {
    const res = await probe(lines[i]);
    console.log(`行${i + 1}: ${res}  ${global.__W.obfuscateForWaf(lines[i]).replace(/\u200b/g, '␣').slice(0, 60)}`);
    await new Promise(s => setTimeout(s, 1500));
  }
})();
