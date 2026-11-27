// sanitizeContent 净化测试
const fs = require('fs');
let src = fs.readFileSync('extension/analyze.js', 'utf8').replace(/^'use strict';/, '');
global.document = { getElementById: () => ({ classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, style: {} }), createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }), addEventListener() {} };
global.chrome = { storage: { local: { get: async () => ({ settings: {} }), set: async () => {} } }, tabs: { get: async () => ({}) }, runtime: { getURL: () => '', sendMessage: async () => null }, scripting: {} };
global.location = { search: '' };
eval(src + ';global.__NS={sanitizeContent};');
const S = global.__NS.sanitizeContent;

const checks = {};
const T = (name, fn) => { try { checks[name] = !!fn(); } catch (e) { checks[name] = 'ERR:' + e.message; } };

T('剔除 NUL', () => !S('a\u0000b').includes('\u0000') && S('a\u0000b') === 'ab');
T('剔除 C0 控制字符(保留 \\n \\t \\r)', () => {
  const out = S('x\u0001\u0002\u0007y\nz\tw');
  return out === 'xy\nz\tw';
});
T('剔除 DEL(\\u007F)', () => S('a\u007Fb') === 'ab');
T('孤立高代理替换为 U+FFFD', () => {
  const out = S('var s="\ud800";');
  return out.includes('\uFFFD') && !/[\uD800-\uDBFF]/.test(out);
});
T('孤立低代理替换为 U+FFFD', () => !/[\uDC00-\uDFFF]/.test(S('\uDC00')));
T('成对代理对保留', () => {
  const emoji = '\uD83D\uDE00'; // 😀
  return S('x' + emoji + 'y').includes(emoji);
});
T('1万字符无换行长串被插入换行', () => {
  const out = S('a'.repeat(25000));
  const lines = out.split('\n');
  return lines.length === 3 && lines[0].length === 10000 && lines[2].length === 5000;
});
T('短文本原样保留', () => S('var a="/member/login"; fetch("/api/x");') === 'var a="/member/login"; fetch("/api/x");');
T('换行结构保留', () => S('a\n\nb\nc') === 'a\n\nb\nc');

let pass = 0, total = 0;
for (const [k, v] of Object.entries(checks)) { total++; if (v === true) pass++; console.log((v === true ? 'PASS' : 'FAIL') + '  ' + k + (v !== true ? ' -> ' + v : '')); }
console.log(`\n${pass}/${total} 通过`);
process.exit(pass === total ? 0 : 1);
