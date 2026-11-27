// test/waf_body_test.js - 生成含代码特征的大 POST body 并测试网关 WAF
'use strict';
const fs = require('fs');
const path = require('path');

const codeChunk = [
  '===== HTML 源码 =====',
  '<!DOCTYPE html><html><head><script src="/js/app.js"></script></head><body>',
  '<form action="/api/auth/login"><input name="password" type="password"></form>',
  "<script>var t=document.getElementById('x').innerHTML=userInput;",
  "eval(decodeURIComponent(location.hash.slice(1)));",
  "axios.post('/api/v1/user/list',{token:'eyJhbGciOiJIUzI1NiJ9.abc.def'});</script>",
  '</body></html>',
  '===== 外链脚本: app.js =====',
  "var cfg={apiKey:'sk-proj-abcdef123456',secret:'test-secret'};",
  "fetch('/admin/login',{method:'POST'});",
  "var sql='select * from user where id='+id;",
  "document.write(\"<iframe src='\"+qs+\"'>\");",
  '----- 重复填充 -----'
].join('\n');

const body = JSON.stringify({
  model: 'auto',
  messages: [
    { role: 'system', content: '你是安全分析师。严格只输出JSON，不要其他文字。' },
    { role: 'user', content: '目标页面: https://10.10.1.30\n内容片段 1/7\n' + codeChunk + '\n' + codeChunk.repeat(80) }
  ],
  stream: false
});
fs.writeFileSync(path.join(__dirname, 'waf_body.json'), body);
console.log('body大小:', body.length, '字符');

(async () => {
  const resp = await fetch('http://newh.ffishing.top:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  const text = await resp.text();
  console.log('http_code:', resp.status);
  console.log('响应前300字符:', text.slice(0, 300));
  fs.writeFileSync(path.join(__dirname, 'waf_resp.txt'), text);
})();
