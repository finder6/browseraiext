// test/noise_saving_test.js - 用真实页面估算噪声清理的节省效果
'use strict';
const fs = require('fs');
const path = require('path');
let src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'analyze.js'), 'utf8').replace(/^'use strict';/, '');
global.document = { getElementById: () => ({ classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, style: {} }), createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }), addEventListener() {} };
global.chrome = { storage: { local: { get: async () => ({ settings: {} }), set: async () => {} } }, tabs: { get: async () => ({}) }, runtime: { getURL: () => '', sendMessage: async () => null }, scripting: {} };
global.location = { search: '' };
eval(src + ';global.__Ns={stripNoise};');
const N = global.__Ns.stripNoise;

(async () => {
  const page = await (await fetch('http://39.153.247.156:8200/jacloud-web/modules/login.html')).text();
  const r = N(page, { html: true });
  console.log(`登录页 HTML: ${page.length} → ${r.text.length} 字符，剔除 ${r.removed}（${(r.removed / page.length * 100).toFixed(1)}%）`);
  for (const [k, v] of Object.entries({ base64: (page.match(/已剔除base64|data:image\/svg\+xml/g) || []).length })) {}
  const tags = ['SVG已剔除', 'CSS样式已剔除', '已剔除base64', '已剔除SVG数据URI'];
  for (const t of tags) {
    const m = r.text.match(new RegExp('\\[' + t + ':(\\d+)字符\\]', 'g')) || [];
    const total = m.reduce((s, x) => s + (+x.match(/\d+/)[0]), 0);
    if (total) console.log(`  ${t}: ${m.length} 处，共 ${total} 字符`);
  }
})();
