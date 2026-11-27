// test/rulesummary_test.js - 验证规则命中项按块分发（不再每块全量复制）
'use strict';
const fs = require('fs');
const path = require('path');
let src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'analyze.js'), 'utf8').replace(/^'use strict';/, '');
global.document = { getElementById: () => ({ classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, style: {} }), createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }), addEventListener() {} };
global.chrome = { storage: { local: { get: async () => ({ settings: {} }), set: async () => {} } }, tabs: { get: async () => ({}) }, runtime: { getURL: () => '', sendMessage: async () => null }, scripting: {} };
global.location = { search: '' };
eval(src + ';global.__R={buildRuleSummariesPerChunk};');
const B = global.__R.buildRuleSummariesPerChunk;

// 两个分块：块1 含 useApi 密钥，块2 含表单/邮箱
const chunks = [
  [{ label: '外链脚本: useApi.js', text: 'var adminKey = "AKID2026SECRET0001"; fetch("/api/user/list");' }],
  [{ label: 'HTML 源码', text: '<form action="/login"><input name="email" value="a@corp.local"></form> 联系人 admin@corp.local' }]
];
const findings = [
  { category: 'sensitive', rule: 'cloud_ak', value: 'AKID2026SECRET0001' },
  { category: 'sensitive', rule: 'email', value: 'admin@corp.local' },
  { category: 'apis', rule: 'api_path', value: '/api/user/list' }
];
const rs = B(findings, chunks);

const checks = {
  '块1只含自己的命中(密钥)': rs[0].includes('AKID2026SECRET0001') && !rs[0].includes('admin@corp.local'),
  '块2只含自己的命中(邮箱)': rs[1].includes('admin@corp.local') && !rs[1].includes('AKID2026SECRET0001'),
  '跨块值只归首个命中块(/api/user/list 在块1)': rs[0].includes('/api/user/list') && !rs[1].includes('/api/user/list'),
  '每块命中数受80条上限': (() => {
    const many = Array.from({ length: 100 }, (_, i) => ({ category: 'sensitive', rule: 'r', value: 'val' + i + 'x' }));
    const big = [{ label: 'b', text: many.map(f => f.value).join(' ') }];
    const r = B(many, [big]);
    return r[0].split('\n').length === 80;
  })(),
  '未匹配项兜底到最后一块(不丢确认机会)': (() => {
    const r = B([{ category: 'sensitive', rule: 'r', value: 'ghost-value-nowhere' }], chunks);
    return !r[0] && r[1].includes('ghost-value-nowhere');
  })(),
  '命中为空时输出空串(请求不带规则段)': B([], chunks).every(s => s === '')
};
let pass = 0;
for (const [k, v] of Object.entries(checks)) { console.log((v ? '✅' : '❌') + ' ' + k); if (v) pass++; }
console.log('规则按块分发测试:', pass + '/' + Object.keys(checks).length);
process.exit(pass === Object.keys(checks).length ? 0 : 1);
