// test/budget_test.js - 验证外链脚本预算分配：按实际字符记账 + 完整性策略（装不下就整体跳过）
'use strict';
const fs = require('fs');
const path = require('path');
let src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'analyze.js'), 'utf8').replace(/^'use strict';/, '');
global.document = { getElementById: () => ({ classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, style: {} }), createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }), addEventListener() {} };
global.chrome = { storage: { local: { get: async () => ({ settings: {} }), set: async () => {} } }, tabs: { get: async () => ({}) }, runtime: { getURL: () => '', sendMessage: async () => null }, scripting: {} };
global.location = { search: '' };
eval(src + ';global.__B={allocateScriptBudget};');
const A = global.__B.allocateScriptBudget;
const mk = (url, len) => ({ url, full: 'x'.repeat(len), origLen: len });
const sum = (arr) => arr.reduce((s, x) => s + x.content.length, 0);

// 场景1：多个小脚本全部采到（旧 bug 下 3 个小脚本就虚扣完 150KB）
const r1 = A([mk('http://s.local/a.js', 500), mk('http://s.local/b.js', 800), mk('http://s.local/c.js', 1200),
              mk('http://s.local/d.js', 600), mk('http://s.local/e.js', 900)], 150 * 1024, 3000);
// 场景2：默认策略(completeOnly) —— 装不下整体跳过
const r2 = A([mk('http://s.local/tiny.js', 1000), mk('http://s.local/big1.js', 100000),
              mk('http://s.local/big2.js', 40000), mk('http://s.local/big3.js', 50000),
              mk('http://s.local/big4.js', 50000)], 150 * 1024, 30000);
// 场景3：旧策略(completeOnly=false) —— 允许 60000 截断（保留兼容）
const r3 = A([mk('http://s.local/tiny.js', 1000), mk('http://s.local/big1.js', 100000),
              mk('http://s.local/big2.js', 70000), mk('http://s.local/big3.js', 50000),
              mk('http://s.local/big4.js', 50000)], 150 * 1024, 30000, { completeOnly: false });
// 场景4：risky 标记与文件名提取
const r4 = A([mk('http://s.local/config.js?v=2', 100), mk('http://s.local/util.js', 100)], 150 * 1024, 0);

const checks = {
  '5个小脚本全部采集(旧bug只采3个)': r1.scriptBodies.length === 5 && r1.exhausted.length === 0,
  '记账=实际字符数': sum(r1.scriptBodies) === 500 + 800 + 1200 + 600 + 900,
  '完整装得下则给全文(不分60000截断)': r2.scriptBodies.find(s => s.name === 'big1.js').content.length === 100000,
  '装不下的big3整体跳过(不采半截)': !r2.scriptBodies.some(s => s.name === 'big3.js') && r2.incomplete.some(f => f.url.endsWith('big3.js')),
  '跳过原因与预算用尽分开统计': r2.incomplete.length === 3 && r2.exhausted.length === 0,
  '总消耗不超预算': sum(r2.scriptBodies) + 30000 <= 150 * 1024,
  '旧策略仍可截断(compatible)': (() => {
    const b = r3.scriptBodies.find(s => s.name === 'big2.js');
    return b && b.content.length === 150 * 1024 - 30000 - 1000 - 100000;
  })(),
  'config.js标记risky且query已剥离': r4.scriptBodies[0].risky === true && r4.scriptBodies[0].name === 'config.js',
  '普通脚本不标记risky': r4.scriptBodies[1].risky === false
};

// 场景5：重放 39.153.247.156:8090/login 的真实脚本清单
const realSizes = [
  ['useApi-s_02lHjl-D9f0yT4I.js', 1000], ['_plugin-vue_export-helper-BDNMzG2s.js', 100], ['cloneDeep-oHQOPbaR.js', 150],
  ['castArray-DE5jqXVw.js', 133], ['omit-ojAPzjpp.js', 953], ['debounce-DTAUXo02.js', 1060],
  ['_baseIteratee-B2SYWsRh.js', 1196], ['tag-vYgx0yt8.js', 1990], ['login-CIVRAKkH.js', 4665],
  ['_baseClone-MSRhe3lz.js', 4693], ['scrollbar-DyQaq3Bf.js', 7227], ['runtime-dom.esm-bundler-C0s0mAXk.js', 13567],
  ['form-b3IO3fDe.js', 26611], ['icon-CHo8QdaX.js', 49924], ['runtime-core.esm-bundler-DJPvrNxt.js', 64434],
  ['router-DyZ-V3Lq.js', 110586], ['message-ljEMU5I3.js', 127294], ['index-ColkfHWZ.js', 211973]
];
const RISKY = /(config|conf|setting|env|secret|key|token|auth|credential|constant|global|init|param|api)/i;
const sortedReal = realSizes.map(([n, l]) => mk('http://39.153.247.156:8090/assets/' + n, l))
  .sort((a, b) => (RISKY.test(a.url) ? 0 : 1) - (RISKY.test(b.url) ? 0 : 1) || a.origLen - b.origLen);

const r150 = A(sortedReal, 150 * 1024, 26000);                 // 150KB 默认预算
const r500 = A(sortedReal, 500 * 1024, 60000);                 // 用户计划切到的 500KB 预算
const got150 = r150.scriptBodies.map(s => s.name);
const got500 = r500.scriptBodies.map(s => s.name);

console.log('\n--- 150KB 预算（默认）: 采集 ' + got150.length + ' 个 ---');
got150.forEach(n => console.log('  ', n));
console.log('  跳过(装不下):', r150.incomplete.map(f => f.url.split('/').pop()).join(', ') || '无');
console.log('--- 500KB 预算: 采集 ' + got500.length + ' 个 ---');
got500.forEach(n => console.log('  ', n));
console.log('  跳过(装不下):', r500.incomplete.map(f => f.url.split('/').pop()).join(', ') || '无');

checks['真实场景150KB: 业务脚本login/form/icon完整采集'] = ['login-CIVRAKkH.js', 'form-b3IO3fDe.js', 'icon-CHo8QdaX.js'].every(n => got150.includes(n));
checks['真实场景150KB: 半截的runtime-core/router整体跳过'] = !got150.includes('runtime-core.esm-bundler-DJPvrNxt.js') && !got150.includes('router-DyZ-V3Lq.js');
checks['真实场景500KB: router/message 完整采集'] = got500.includes('router-DyZ-V3Lq.js') && got500.includes('message-ljEMU5I3.js');
checks['真实场景500KB: 采到的每个文件都是全文'] = r500.scriptBodies.every(s => s.content.length === s.origLen);
checks['真实场景500KB: 212KB的index仍装不下则跳过并标注'] = !got500.includes('index-ColkfHWZ.js') && r500.incomplete.some(f => f.url.endsWith('index-ColkfHWZ.js'));

let pass = 0;
for (const [k, v] of Object.entries(checks)) { console.log((v ? '✅' : '❌') + ' ' + k); if (v) pass++; }
console.log('预算分配测试:', pass + '/' + Object.keys(checks).length);
process.exit(pass === Object.keys(checks).length ? 0 : 1);
