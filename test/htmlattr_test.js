// test/htmlattr_test.js - 验证 HTML 属性级噪声清理：Vue data-v-* 与装饰性动画内联样式
'use strict';
const fs = require('fs');
const path = require('path');
let src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'analyze.js'), 'utf8').replace(/^'use strict';/, '');
global.document = { getElementById: () => ({ classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, style: {} }), createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }), addEventListener() {} };
global.chrome = { storage: { local: { get: async () => ({ settings: {} }), set: async () => {} } }, tabs: { get: async () => ({}) }, runtime: { getURL: () => '', sendMessage: async () => null }, scripting: {} };
global.location = { search: '' };
eval(src + ';global.__H={stripNoise};');
const N = global.__H.stripNoise;

// 用户实测页面片段：粒子装饰 + data-v 作用域属性 + 真实表单
const particle = '<span data-v-cc0a3d24="" class="particle" style="width: 2px; height: 2px; left: 37%; top: 53%; animation-delay: 0.6s; animation-duration: 7s;"></span>';
const html = '<div id="app" data-v-cc0a3d24=""><div class="login" data-v-cc0a3d24="">' + particle.repeat(30)
  + '<form class="el-form login-form"><input type="password" name="pwd" value=""><input type="hidden" name="csrf" value="tok123"></form>'
  + '<div style="background:url(javascript:alert(1))" data-v-cc0a3d24="">x</div>'
  + '<i style="color:#f00;width:20px" data-v-cc0a3d24="">icon</i></div></div>';
const r = N(html, { html: true });

const checks = {
  'Vue data-v-* 属性全部剔除': !r.text.includes('data-v-'),
  '表单与隐藏字段保留': r.text.includes('type="password"') && r.text.includes('name="csrf"') && r.text.includes('tok123'),
  '粒子装饰样式大幅压缩': !r.text.includes('animation-duration') && r.text.includes('style=""'),
  'js: URL 的老式XSS线索保留': r.text.includes('javascript:alert(1)'),
  '非动画样式(颜色/宽度)保留': r.text.includes('color:#f00'),
  '剔除量可观(压缩>60%)': r.removed / html.length > 0.6,
  'JS 模式不受影响(data-v 保留)': (() => {
    const js = 'var tpl = `<div data-v-abc123="">x</div>`; var k = "apiKey";';
    return N(js).text.includes('data-v-abc123');
  })()
};
let pass = 0;
for (const [k, v] of Object.entries(checks)) { console.log((v ? '✅' : '❌') + ' ' + k); if (v) pass++; }
console.log('HTML属性清理测试:', pass + '/' + Object.keys(checks).length, '| 原始', html.length, '→ 清理后', r.text.length);
process.exit(pass === Object.keys(checks).length ? 0 : 1);
