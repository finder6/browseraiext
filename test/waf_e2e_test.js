// test/waf_e2e_test.js - 完整流程级验证：打散后的完整分析请求能否过 WAF 且模型能正确理解
'use strict';
const fs = require('fs');
const path = require('path');
let src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'analyze.js'), 'utf8').replace(/^'use strict';/, '');
global.document = { getElementById: () => ({ classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, style: {} }), createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }), addEventListener() {} };
global.chrome = { storage: { local: { get: async () => ({ settings: {} }), set: async () => {} } }, tabs: { get: async () => ({}) }, runtime: { getURL: () => '', sendMessage: async () => null }, scripting: {} };
global.location = { search: '' };
global.AbortController = AbortController;
eval(src + ';global.__A={obfuscateForWaf,callAI,extractJSON,BUILTIN_PROMPT};');

const settings = {
  apiType: 'openai',
  baseUrl: 'http://newh.ffishing.top:11434/v1',
  apiKey: 'wbgw-7f3a9c2e5b1d8460',
  model: 'auto',
  temperature: 0.2,
  numCtx: 32768,
  numPredict: 8192
};

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
  const t0 = Date.now();
  try {
    // 模拟扩展真实调用链：obfuscateForWaf 打散后的内容 + 真实 BUILTIN_PROMPT + callAI
    const userMsg = `目标页面: http://demo.local/login\n内容片段 1/1\n===== HTML 源码 =====\n${global.__A.obfuscateForWaf(malicious)}`;
    const text = await global.__A.callAI(settings, [
      { role: 'system', content: global.__A.BUILTIN_PROMPT },
      { role: 'user', content: userMsg }
    ]);
    console.log('✅ 请求通过 WAF 且模型返回，耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's');
    const parsed = global.__A.extractJSON(text);
    if (!parsed) { console.log('❌ 模型输出无法解析 JSON:', text.slice(0, 300)); process.exit(1); }
    console.log('JSON 解析: OK |', Object.keys(parsed).map(k => k + '=' + (Array.isArray(parsed[k]) ? parsed[k].length : '?')).join(','));
    // 检查模型是否真的理解了打散后的代码
    const all = JSON.stringify(parsed);
    const understanding = {
      '发现 eval/innerHTML DOM XSS': /(eval|innerHTML|DOM\s*XSS|dom\s*xss)/i.test(all),
      '发现硬编码/敏感信息或JWT': /(jwt|token|token|硬编码|密钥)/i.test(all),
      '发现 SQL 注入风险': /(sql|注入|inject)/i.test(all),
      '发现 API 接口': /(api\/auth\/login|api\/v1\/user)/i.test(all)
    };
    let p = 0;
    for (const [k, v] of Object.entries(understanding)) { console.log((v ? '✅' : '❌') + ' ' + k); if (v) p++; }
    console.log(`理解度: ${p}/${Object.keys(understanding).length}`);
    process.exit(p >= 3 ? 0 : 1);
  } catch (e) {
    console.log('❌ 失败:', String(e.message || e).slice(0, 300));
    process.exit(1);
  }
})();
