// test/waf_token2_test.js - 对 vue/jquery 最小触发子串逐 token 验证
'use strict';
const fs = require('fs');
const path = require('path');

const URL_ = 'http://newh.ffishing.top:11434/v1/chat/completions';
const KEY = 'Bearer wbgw-7f3a9c2e5b1d8460';
const FILL = '这是无害的中文填充文本。lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.';

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
  const tests = [
    ['vue原始150字符', 'var r=e.attrsList,i=0,o=r.length;i<o;i++)if(r[i].name===t){r.splice(i,1);break}return n}function on(e,t,n){var r=n||{},i=r.number,o=r.trim,a="$$v";o&&'],
    ['vue: function on(e,t,n)', 'function on(e,t,n){var r=n||{},i=r.number,o=r.trim,a="$$v";o&&'],
    ['vue: attrsList循环', 'var r=e.attrsList,i=0,o=r.length;i<o;i++)if(r[i].name===t){r.splice(i,1);break}'],
    ['vue: splice', 'r.splice(i,1);break'],
    ['vue: i<o;i++', 'i=0,o=r.length;i<o;i++)'],
    ['jq原始168字符', 'ntNode.removeChild(b),b=null}}function ja(a,b){var c=a.split("|"),e=c.length;while(e--)d.attrHandle[c[e]]=b}function ka(a,b){var c=b&&a,d=c&&1===a.nodeType&&1===b.nodeT'],
    ['jq: removeChild', 'ntNode.removeChild(b),b=null}}'],
    ['jq: split|', 'function ja(a,b){var c=a.split("|"),e=c.length;while(e--)d.attrHandle[c[e]]=b}'],
    ['jq: nodeType', 'function ka(a,b){var c=b&&a,d=c&&1===a.nodeType&&1===b.nodeT']
  ];
  for (const [desc, content] of tests) {
    const ok = await probe(FILL + '\n' + content + '\n' + FILL);
    console.log((ok ? '  通过   ' : '★触发★  ') + desc);
    await new Promise(s => setTimeout(s, 1200));
  }
})();
