// test/noise_v2_test.js - 验证 SVG/CSS/注释/空白清理
'use strict';
const fs = require('fs');
const path = require('path');
let src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'analyze.js'), 'utf8').replace(/^'use strict';/, '');
global.document = { getElementById: () => ({ classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, style: {} }), createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }), addEventListener() {} };
global.chrome = { storage: { local: { get: async () => ({ settings: {} }), set: async () => {} } }, tabs: { get: async () => ({}) }, runtime: { getURL: () => '', sendMessage: async () => null }, scripting: {} };
global.location = { search: '' };
eval(src + ';global.__N={stripNoise};');

const N = global.__N.stripNoise;
const svg = '<svg width="100" height="100"><path d="M10 10 H 90 V 90 H 10 Z ' + 'L 1 2 '.repeat(60) + '" fill="red"/></svg>';
const style = '<style>body{color:#333} .icon{background:url(data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22' + '%20path%20d%3D%22M1%202'.repeat(30) + '%22/%3E%3C/svg%3E)} .a{margin:0}</style>';
const html = `<div class="header">
      <span>   标题文本   保留</span>
      ${svg}
      ${style}
      <!-- 这是一段注释，正文里应该被剔除 -->
      <a href="/api/user/list">链接</a>




      <div>结尾</div>
    </div>`;
const r = N(html, { html: true });
const js = '// 重要注释：password=Admin@123 不能丢\nvar a = 1;   // 行注释保留\n';
const rjs = N(js);

const checks = {
  'SVG 块剔除': r.text.includes('[SVG已剔除:') && !r.text.includes('<path'),
  'CSS style 块剔除': r.text.includes('[CSS样式已剔除:') && !r.text.includes('<style'),
  'URL编码SVG数据URI剔除': !r.text.includes('%3Csvg') && !r.text.includes('data:image/svg+xml,%3C'),
  'HTML注释正文剔除': !r.text.includes('这是一段注释'),
  '正文保留': r.text.includes('标题文本 保留') && r.text.includes('/api/user/list') && r.text.includes('结尾'),
  '空白归一化': !/\n{3,}/.test(r.text) && !/[ \t]{2,}/.test(r.text),
  'JS注释不误删': rjs.text.includes('password=Admin@123') && rjs.text.includes('行注释保留'),
  '剔除统计>0': r.removed > 1000
};
let pass = 0;
for (const [k, v] of Object.entries(checks)) { console.log((v ? '✅' : '❌') + ' ' + k); if (v) pass++; }
console.log('噪声清理v2测试:', pass + '/' + Object.keys(checks).length);
console.log('\nHTML 块清理后预览:\n' + r.text.slice(0, 400));
process.exit(pass === Object.keys(checks).length ? 0 : 1);
