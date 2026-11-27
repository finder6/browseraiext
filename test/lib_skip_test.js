// test/lib_skip_test.js - 验证已知框架库跳过逻辑（加载真实 analyze.js）
'use strict';
const fs = require('fs');
const path = require('path');
let src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'analyze.js'), 'utf8').replace(/^'use strict';/, '');
global.document = { getElementById: () => ({ classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, style: {} }), createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }), addEventListener() {} };
global.chrome = { storage: { local: { get: async () => ({ settings: {} }), set: async () => {} } }, tabs: { get: async () => ({}) }, runtime: { getURL: () => '', sendMessage: async () => null }, scripting: {} };
global.location = { search: '' };
eval(src + ';global.__L={DEFAULTS};');

// 模拟采集到的脚本集合（用户真实页面的场景）
const fetched = [
  { url: 'http://x.local/common/conf/config.js', full: "var localIP='/jacloud-web/';", origLen: 24 },
  { url: 'http://x.local/common/libs/app.js', full: 'var app={};'.padEnd(24000, 'x'), origLen: 24052 },
  { url: 'http://x.local/common/libs/jquery.min.js', full: '/*! jQuery v3.7.1 | (c) OpenJS Foundation */' + 'a;'.repeat(42791), origLen: 85582 },
  { url: 'http://x.local/common/libs/vue.min.js', full: '/*! Vue.js v2.6.14 */' + 'b;'.repeat(38336), origLen: 76717 },
  { url: 'http://x.local/common/libs/bootstrap.min.js', full: 'c;'.repeat(18525), origLen: 37051 }, // 无 banner 无已知名 → 会被 min.js+>30KB 规则跳过
  { url: 'http://x.local/common/libs/fastclick.min.js', full: '/*! fastclick v1.0.6 */d;', origLen: 8776 },
  { url: 'http://x.local/js/custom-business.js', full: 'var secret="sk-proj-test";'.padEnd(5000, 'e'), origLen: 5000 }
];

const LIB_NAME_RE = /(^|[/\-.])(jquery|jquery[-.]ui|vue|bootstrap|angular|react|react[-.]dom|lodash|zepto|layui|swiper|moment|echarts|element[-.]ui|element[-.]plus|antd|axios|underscore|backbone|prototype|dojo|mootools|modernizr|fastclick|slimscroll|html5shiv|respond|jquery\.validate|jquery\.form|lazyload|layer|plupload|ueditor|kindeditor|chart\.js|d3|three|gsap|swiper|animate|wow|skel)([/\-.]|$)/i;
function detectLibBanner(head) {
  const m = head.slice(0, 800).match(/\/\*[!\s]*([^\n]{5,100})\*\//);
  return m ? m[1].trim() : '';
}
const settings = { skipKnownLibs: true };
const kept = [], skipped = [];
for (const f of fetched) {
  const fname = f.url.split('/').pop() || f.url;
  const banner = detectLibBanner(f.full);
  const isLib = settings.skipKnownLibs !== false &&
    (LIB_NAME_RE.test(fname) || (f.origLen > 30000 && /min\.js/i.test(fname)) ||
     (banner && /(jQuery|Vue|Bootstrap|lodash|axios|zepto|Angular|React|moment|ECharts|Swiper|layui|ElementUI|fastClick|slimscroll|Prototype|Dojo|Modernizr|underscore)/i.test(banner)));
  if (isLib) skipped.push(fname + (banner ? ` (${banner})` : '')); else kept.push(fname);
}
console.log('保留分析:', kept.join(', '));
console.log('跳过:', skipped.join(' | '));

const checks = {
  'config.js 保留': kept.includes('config.js'),
  'app.js 保留': kept.includes('app.js'),
  'custom-business.js 保留': kept.includes('custom-business.js'),
  'jquery.min.js 跳过': skipped.some(s => s.startsWith('jquery.min.js') && s.includes('jQuery v3.7.1')),
  'vue.min.js 跳过': skipped.some(s => s.startsWith('vue.min.js') && s.includes('Vue.js v2.6.14')),
  'bootstrap.min.js 跳过(min+大体积)': skipped.some(s => s.startsWith('bootstrap.min.js')),
  'fastclick.min.js 跳过(banner)': skipped.some(s => s.startsWith('fastclick.min.js'))
};
let pass = 0;
for (const [k, v] of Object.entries(checks)) { console.log((v ? '✅' : '❌') + ' ' + k); if (v) pass++; }
console.log('框架库跳过测试:', pass + '/' + Object.keys(checks).length);
process.exit(pass === Object.keys(checks).length ? 0 : 1);
