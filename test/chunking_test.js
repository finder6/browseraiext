// test/chunking_test.js - 验证分块策略：小块贪心合并 + 尾块过小并入前一块
'use strict';
const fs = require('fs');
const path = require('path');
let src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'analyze.js'), 'utf8').replace(/^'use strict';/, '');
global.document = { getElementById: () => ({ classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, style: {} }), createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }), addEventListener() {} };
global.chrome = { storage: { local: { get: async () => ({ settings: {} }), set: async () => {} } }, tabs: { get: async () => ({}) }, runtime: { getURL: () => '', sendMessage: async () => null }, scripting: {} };
global.location = { search: '' };
eval(src + ';global.__C={chunkBlocks};');
const C = global.__C.chunkBlocks;
const B = (label, text) => ({ label, text });
const len = (ch) => ch.reduce((s, b) => s + b.text.length, 0);

const checks = {
  '小块贪心合并进同一块(不是一脚本一块)': (() => {
    const blocks = [B('a', 'x'.repeat(100)), B('b', 'y'.repeat(200)), B('c', 'z'.repeat(300))];
    const r = C(blocks, 20000);
    return r.length === 1 && r[0].length === 3;
  })(),
  '满块正常切分': (() => {
    const blocks = [B('a', 'x'.repeat(15000)), B('b', 'y'.repeat(15000)), B('c', 'z'.repeat(15000))];
    const r = C(blocks, 20000);
    return r.length === 3;
  })(),
  '超大块硬切(带重叠,尾段正文5000并入前块)': (() => {
    const r = C([B('big', 'x'.repeat(65000))], 20000);
    const bodyChars = (ch) => ch.reduce((s, b) => s + (b.text.match(/x/g) || []).length
      - (b.text.startsWith('【上文重叠') ? 1500 : 0), 0);
    return r.length === 3 && bodyChars(r[0]) === 20000 && bodyChars(r[2]) === 25000;
  })(),
  '大块硬切各段带重叠标注': (() => {
    const r = C([B('big', 'x'.repeat(65000))], 20000);
    return r[1][0].label.includes('第2段') && r[1][0].text.includes('【上文重叠') && r[1][0].text.includes('【下文为接续内容】');
  })(),
  '尾块(3000)并入前块省一次请求': (() => {
    const blocks = [B('a', 'x'.repeat(20000)), B('b', 'y'.repeat(20000)), B('tail', 'z'.repeat(3000))];
    const r = C(blocks, 20000);
    return r.length === 2 && len(r[1]) === 23000;
  })(),
  '尾块超过5000不合并(独立分析更稳)': (() => {
    const blocks = [B('a', 'x'.repeat(20000)), B('b', 'y'.repeat(20000)), B('tail', 'z'.repeat(8000))];
    const r = C(blocks, 20000);
    return r.length === 3 && len(r[2]) === 8000;
  })(),
  '合并受1.3x上限约束': (() => {
    const blocks = [B('a', 'x'.repeat(20000)), B('tail', 'z'.repeat(7000))];
    const r = C(blocks, 20000);  // 20000+7000=27000 > 26000 上限，不合并
    return r.length === 2;
  })(),
  '只有一个块不触发合并': (() => {
    const r = C([B('a', 'x'.repeat(100))], 20000);
    return r.length === 1;
  })()
};
let pass = 0;
for (const [k, v] of Object.entries(checks)) { console.log((v ? '✅' : '❌') + ' ' + k); if (v) pass++; }
console.log('分块策略测试:', pass + '/' + Object.keys(checks).length);
process.exit(pass === Object.keys(checks).length ? 0 : 1);
