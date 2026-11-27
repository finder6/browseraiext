// test/waf_encoded_test.js - 验证 Base64 编码内容能否过 WAF 并被模型正确解码
'use strict';
const fs = require('fs');
const path = require('path');

const rawBody = fs.readFileSync(path.join(__dirname, 'waf_body.json'), 'utf8');
const orig = JSON.parse(rawBody);
const userMsg = orig.messages[1].content;

function utf8ToB64(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}

const encodedUserMsg = '目标页面: https://10.10.1.30（内容片段，URL 可明文）\n\n'
  + '<<<B64>>>' + utf8ToB64(userMsg) + '<<<B64>>>\n\n'
  + '上面 <<<B64>>> 标记之间是 Base64(UTF-8) 编码的网页内容，请先解码为明文，再按系统提示进行安全分析。';

const body = JSON.stringify({
  model: 'auto',
  messages: [
    { role: 'system', content: orig.messages[0].content },
    { role: 'user', content: encodedUserMsg }
  ],
  stream: false
});
console.log('编码后 body 大小:', body.length, '字符');

(async () => {
  const t0 = Date.now();
  const resp = await fetch('http://newh.ffishing.top:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer wbgw-7f3a9c2e5b1d8460' },
    body
  });
  const text = await resp.text();
  console.log('http_code:', resp.status, '耗时:', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  fs.writeFileSync(path.join(__dirname, 'waf_resp_encoded.txt'), text);
  if (resp.status === 200) {
    let content = '';
    try { content = JSON.parse(text).choices[0].message.content; } catch (e) { content = text.slice(0, 400); }
    console.log('模型输出前600字符:\n', content.slice(0, 600));
    // 验证解码质量：模型是否找回了 body 里埋的特征
    const found = ['eyJhbGciOiJIUzI1NiJ9', 'sk-proj', '/api/v1/user/list', 'innerHTML'].filter(k => content.includes(k));
    console.log('解码后找关键特征:', found.length ? found.join(', ') : '（未直接回显，看 JSON 判断）');
  } else {
    console.log('响应前300:', text.slice(0, 300));
  }
})();
