// test/waf_token_probe_test.js - 对最小触发子串继续细分并测试候选 token
'use strict';
const fs = require('fs');
const path = require('path');
let src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'analyze.js'), 'utf8').replace(/^'use strict';/,'');
global.document={getElementById:()=>({classList:{add(){},remove(){},toggle(){}},addEventListener(){},appendChild(){},style:{}}),createElement:()=>({classList:{add(){},remove(){},toggle(){}},appendChild(){}}),addEventListener(){}};
global.chrome={storage:{local:{get:async()=>({settings:{}}),set:async()=>{}}},tabs:{get:async()=>({})},runtime:{getURL:()=>'',sendMessage:async()=>null},scripting:{}};
global.location={search:''};
eval(src + ';global.__R={obfuscateForWaf};');

const URL_ = 'http://newh.ffishing.top:11434/v1/chat/completions';
const KEY = 'Bearer wbgw-7f3a9c2e5b1d8460';
const FILL = ' 这是无害的填充文本。lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ';

async function probe(content) {
  const body = JSON.stringify({ model: 'auto', stream: false, messages: [{ role: 'user', content: '回复OK:\n' + content }] });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': KEY }, body, signal: ctrl.signal });
    clearTimeout(timer);
    const t = await r.text();
    return !(r.status === 403 && /<!DOCTYPE/.test(t));
  } catch (e) { clearTimeout(timer); return true; }
}

(async () => {
  const minimal = "===e?\"math\":void 0}function _t(e){if(!Ii)return!0;if(Wo(e))return!1;if(e=e.toLowerCase(),null!=Zo[e])return Zo[e];var t=document.createElement(e);return e.indexOf(\"-\")>-1?Zo[e]=t.constructor===window.HTMLUnknownElement||t.constructor===window.HTMLElement:Zo[e]=/HTMLUnknownElement/.test(t.toString()";

  // 1. 逐 token 验证（包上无害填充凑到 300+ 字符，排除短内容豁免）
  const tokens = [
    'document.createElement(e)',
    'window.HTMLUnknownElement',
    't.constructor===window.HTMLElement',
    'e.toLowerCase()',
    'void 0',
    '/HTMLUnknownElement/.test(t.toString()',
    'Zo[e]=t.constructor',
    'if(!Ii)return!0'
  ];
  console.log('=== token 逐个验证（每个包 300+ 字符填充） ===');
  for (const tk of tokens) {
    const ok = await probe(FILL + tk + FILL);
    console.log((ok ? '通过' : '★触发★') + '  ' + tk);
    await new Promise(s => setTimeout(s, 1200));
  }
})();
