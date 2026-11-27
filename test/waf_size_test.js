// test/waf_size_test.js - 定位 WAF 拦截的 body 体积阈值
'use strict';
const KEY = 'Bearer wbgw-7f3a9c2e5b1d8460';
const URL_ = 'http://newh.ffishing.top:11434/v1/chat/completions';

// 含典型攻击特征的内容模板（HTML/JS/SQL/payload）
const FEATURE = [
  "<script>var t=document.getElementById('x').innerHTML=userInput;",
  "eval(decodeURIComponent(location.hash.slice(1)));",
  "axios.post('/api/v1/user/list',{token:'eyJhbGciOiJIUzI1NiJ9.abc.def'});",
  "var sql=\"select * from user where id=1 or 1=1\";var payload=\"<img src=x onerror=alert(1)>\";",
  "fetch('/admin/login',{method:'POST',body:JSON.stringify({password:'Admin@123'})});",
  "var cfg={apiKey:'sk-proj-abcdef123456',dbUrl:'mysql://root:P@ssw0rd@10.0.0.5:3306/app'};"
].join('\n');

function makeBody(targetChars) {
  let content = '目标页面: https://10.10.1.30\n内容片段:\n' + FEATURE + '\n';
  let i = 0;
  while (content.length < targetChars) content += `\n<!-- 填充行 ${++i}: lorem ipsum dolor sit amet consectetur -->`;
  content = content.slice(0, targetChars);
  return JSON.stringify({ model: 'auto', messages: [{ role: 'system', content: '你是安全分析师，只输出JSON。' }, { role: 'user', content }], stream: false });
}

(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (const size of [2000, 5000, 10000, 20000, 40000]) {
    const body = makeBody(size);
    let result = null;
    for (let attempt = 1; attempt <= 2 && !result; attempt++) {
      if (attempt === 2) await sleep(15000); // 失败后等 15s 再试一次
      const t0 = Date.now();
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 120000);
        const resp = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': KEY }, body, signal: ctrl.signal });
        clearTimeout(timer);
        const text = await resp.text();
        const isWaf = /WAF拦截|<!DOCTYPE/i.test(text) && resp.status === 403;
        result = `body=${body.length}字符(${size}目标) => ${resp.status} ${isWaf ? '[WAF拦截]' : text.slice(0, 50).replace(/\n/g, ' ')} 耗时${((Date.now() - t0) / 1000).toFixed(1)}s`;
      } catch (e) {
        result = null;
        if (attempt === 2) result = `body=${body.length}字符(${size}目标) => 异常 ${String(e.cause ? e.cause.code : e.message).slice(0, 50)}`;
      }
      await sleep(8000); // 请求间隔，避免触发频率限制
    }
    console.log(result);
    if (result && result.includes('=> 200')) break;
  }
})();
