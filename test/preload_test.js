// test/preload_test.js - 验证 <link rel="modulepreload"> JS 资源被纳入采集候选
'use strict';
const fs = require('fs');
const path = require('path');

// 模拟 Vite SPA：1 个入口 script + 3 个 modulepreload chunk（1 个外域 CDN 的应被同域过滤掉）
const linkEls = [
  { rel: 'modulepreload', href: 'http://x.local/assets/index-B2xQ9.js', as: '' },
  { rel: 'modulepreload', href: 'http://x.local/assets/login-4kTz.js', as: '' },
  { rel: 'modulepreload', href: 'http://x.local/assets/dashboard-8pLw.js', as: '' },
  { rel: 'preload', href: 'http://x.local/assets/vendor-a1b2.js', as: 'script' },
  { rel: 'preload', href: 'http://x.local/assets/font.woff2', as: 'font' },          // 非 JS，应被过滤
  { rel: 'modulepreload', href: 'https://cdn.jsdelivr.net/npm/vue.js', as: '' }      // 外域，应被同域过滤
].map(e => ({ rel: e.rel, href: e.href, as: e.as }));

global.document = {
  documentElement: { outerHTML: '<html><body>ok</body></html>' },
  title: 't',
  scripts: [{ src: 'http://x.local/assets/index-ColkfHWZ.js', textContent: '' }],
  querySelectorAll: (sel) => sel.includes('link[') ? linkEls : [],
  createTreeWalker: () => ({ nextNode: () => null }),
  querySelector: () => null,
  cookie: ''
};
global.location = { href: 'http://x.local/login' };
global.localStorage = {};
global.NodeFilter = { SHOW_COMMENT: 128 };

let srcCode = fs.readFileSync(path.join(__dirname, '..', 'extension', 'analyze.js'), 'utf8').replace(/^'use strict';/, '');
const m = srcCode.match(/function extractPageInfo\(maxHtml\) \{[\s\S]*?\n\}/);
if (!m) { console.log('❌ 未找到 extractPageInfo'); process.exit(1); }
eval(m[0] + ';global.__E=extractPageInfo;');
const result = global.__E(20000);

const preloads = result.preloads || [];
const allSrcs = result.scripts.filter(s => s.src && /^https?:/i.test(s.src)).map(s => s.src).concat(preloads);
// 模拟 analyze.js 的同域过滤（主域名 x.local，根域 x.local）
const sameSite = (u) => { try { const h = new URL(u).hostname; return h === 'x.local' || h.endsWith('.x.local'); } catch (e) { return false; } };
const uniqueSrcs = [...new Set(allSrcs)].filter(sameSite);

const checks = {
  'modulepreload chunk 进入候选': preloads.includes('http://x.local/assets/login-4kTz.js') && preloads.includes('http://x.local/assets/dashboard-8pLw.js'),
  'preload as=script 进入候选': preloads.includes('http://x.local/assets/vendor-a1b2.js'),
  '非 JS preload(字体)被过滤': !preloads.includes('http://x.local/assets/font.woff2'),
  'script 标签与 preload 合并且无重复': uniqueSrcs.length === 5 && new Set(uniqueSrcs).size === 5 && uniqueSrcs.includes('http://x.local/assets/index-ColkfHWZ.js'),
  '外域 preload 被同域规则过滤': !uniqueSrcs.includes('https://cdn.jsdelivr.net/npm/vue.js')
};
let pass = 0;
for (const [k, v] of Object.entries(checks)) { console.log((v ? '✅' : '❌') + ' ' + k); if (v) pass++; }
console.log('modulepreload 采集测试:', pass + '/' + Object.keys(checks).length);
process.exit(pass === Object.keys(checks).length ? 0 : 1);
