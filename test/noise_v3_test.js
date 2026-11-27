// test/noise_v3_test.js - 验证未闭合 SVG/style 兜底（截断场景）
'use strict';
const fs = require('fs');
const path = require('path');
let src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'analyze.js'), 'utf8').replace(/^'use strict';/, '');
global.document = { getElementById: () => ({ classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, style: {} }), createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }), addEventListener() {} };
global.chrome = { storage: { local: { get: async () => ({ settings: {} }), set: async () => {} } }, tabs: { get: async () => ({}) }, runtime: { getURL: () => '', sendMessage: async () => null }, scripting: {} };
global.location = { search: '' };
eval(src + ';global.__Ns={stripNoise};');
const N = global.__Ns.stripNoise;

// 场景1：用户报告的 SVG 雪碧图（页面尾部被截断，无 </svg> 闭合）
const sprite = '<div id="app">正文内容</div><svg id="__svg__icons__dom__" xmlns="http://www.w3.org/2000/svg" style="position: absolute; width: 0px;"><symbol id="icon-404" viewBox="0 0 128 128"><path d="M121.718 73.272v9.953c3.957-7.584 ' + 'M1 2 L3 4 '.repeat(200) + '" fill="red"/></symbol>';
const r1 = N(sprite, { html: true });

// 场景2：正常闭合的 svg 仍走配对剔除
const closed = '<div>前文</div><svg><path d="M1 2"/></svg><div>后文</div>';
const r2 = N(closed, { html: true });

// 场景3：截断的 style
const cutStyle = '<div>内容</div><style>body{color:red' ;
const r3 = N(cutStyle, { html: true });

// 场景4：JS 文件中出现的 "<svg" 字符串不受未闭合兜底影响
const js = 'var tpl = "<svg><path/></svg>"; var cmd = "eval"; // 注释保留';
const r4 = N(js);

const checks = {
  '雪碧图(未闭合)剔除': r1.text.includes('[SVG已剔除(未闭合):') && !r1.text.includes('icon-404'),
  '雪碧图场景正文保留': r1.text.includes('正文内容'),
  '闭合svg正常剔除': r2.text.includes('[SVG已剔除:') && r2.text.includes('后文'),
  '未闭合style剔除': r3.text.includes('[CSS样式已剔除(未闭合):') && !r3.text.includes('color:red'),
  'JS中代码与注释保留(svg字符串被配对规则替换为占位属预期)': r4.text.includes('var cmd = "eval"') && r4.text.includes('注释保留') && r4.text.includes('[SVG已剔除:'),
  '剔除统计正确': r1.removed > 1000
};
let pass = 0;
for (const [k, v] of Object.entries(checks)) { console.log((v ? '✅' : '❌') + ' ' + k); if (v) pass++; }
console.log('噪声清理v3测试:', pass + '/' + Object.keys(checks).length);
process.exit(pass === Object.keys(checks).length ? 0 : 1);
