// test/waf_bisect2_test.js - 对已打散但仍被拦的块继续二分定位剩余签名（node test/waf_bisect2_test.js <chunk文件>）
'use strict';
const fs = require('fs');
const path = require('path');

const URL_ = 'http://newh.ffishing.top:11434/v1/chat/completions';
const KEY = 'Bearer wbgw-7f3a9c2e5b1d8460';

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

async function bisect(text) {
  if (text.length <= 250) return text;
  const mid = Math.floor(text.length / 2);
  const a = text.slice(0, mid), b = text.slice(mid);
  if (!(await probe(a))) { console.log(`  前半 ${a.length} 触发`); return bisect(a); }
  console.log(`  前半 ${a.length} 通过，查后半 ${b.length}`);
  await new Promise(s => setTimeout(s, 1000));
  return bisect(b);
}

(async () => {
  const file = process.argv[2];
  const text = fs.readFileSync(file, 'utf8');
  console.log('目标:', file, text.length, '字符');
  const minimal = await bisect(text);
  console.log('\n=== 最小触发子串（', minimal.length, '字符）===');
  console.log(JSON.stringify(minimal.slice(0, 600)));
})();
