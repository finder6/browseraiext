// test/preclean_test.js - 验证「先清理、后截断」：噪声剔除发生在截断之前
'use strict';
const fs = require('fs');
const path = require('path');

// extractPageInfo 会在注入目标页面时执行，这里直接模拟 DOM 环境调用它
global.document = {
  documentElement: { outerHTML: '' },
  title: 't',
  scripts: [],
  querySelectorAll: () => [],
  createTreeWalker: () => ({ nextNode: () => null }),
  querySelector: () => null,
  cookie: ''
};
global.location = { href: 'http://x.local/' };
global.localStorage = {};
global.NodeFilter = { SHOW_COMMENT: 128 };

let srcCode = fs.readFileSync(path.join(__dirname, '..', 'extension', 'analyze.js'), 'utf8').replace(/^'use strict';/, '');
const m = srcCode.match(/function extractPageInfo\(maxHtml\) \{[\s\S]*?\n\}/);
if (!m) { console.log('❌ 未找到 extractPageInfo'); process.exit(1); }
eval(m[0] + ';global.__E=extractPageInfo;');
const E = global.__E;

// 构造一个噪声巨大的页面：50KB 的 svg 雪碧图 + 5KB 有效内容，maxHtml=20KB
const bigSvg = '<svg id="__svg__icons__dom__"><symbol id="i1"><path d="' + 'M1 2 L3 4 '.repeat(5000) + '"/></symbol></svg>';
global.document.documentElement.outerHTML =
  '<html><body><div>敏感配置 apiKey=sk-proj-abcdef1234567890</div>' + bigSvg + '<a href="/api/user/list">x</a></body></html>';

const result = E(20000); // maxHtml 20KB
const checks = {
  '噪声在截断前被剔除(preNoiseRemoved>40000)': result.preNoiseRemoved > 40000,
  '清理后正文完整进入采集结果': result.html.includes('apiKey=sk-proj-abcdef1234567890') && result.html.includes('/api/user/list'),
  'svg 不占用采集额度': !result.html.includes('M1 2 L3 4'),
  '截断标注基于清理后长度': result.htmlLen < 1000,
  '占位标注保留': result.html.includes('[SVG已剔除(未闭合):') || result.html.includes('[SVG已剔除:')
};
let pass = 0;
for (const [k, v] of Object.entries(checks)) { console.log((v ? '✅' : '❌') + ' ' + k); if (v) pass++; }
console.log('先清理后截断测试:', pass + '/' + Object.keys(checks).length);
console.log('htmlLen(清理后全长):', result.htmlLen, '| preNoiseRemoved:', result.preNoiseRemoved);
process.exit(pass === Object.keys(checks).length ? 0 : 1);
