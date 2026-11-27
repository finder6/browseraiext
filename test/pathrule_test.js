// 业务路径规则测试（对齐 FindSomething PATH 能力）
const fs = require('fs');
const src = fs.readFileSync('extension/rules.js', 'utf8');
eval(src);

const checks = {};
const T = (name, fn) => { try { checks[name] = !!fn(); } catch (e) { checks[name] = 'ERR:' + e.message; } };
const hits = (text, cat) => runRules(text, [cat]).filter(r => cat === 'api' ? r.rule === '业务路径' : true);
const values = (text) => hits(text, 'api').map(r => r.value);

// 1. 业务前缀接口路径（用户报告里 FindSomething 找到的那类）
T('业务路径 /member/login 命中', () => values('"\/member\/login"').includes('/member/login'));
T('业务路径 /memberCenter/balanceAbility 命中', () => values('path:"/memberCenter/balanceAbility"').includes('/memberCenter/balanceAbility'));
T('业务路径 /member/multi/query 命中', () => values(`fetch("/member/multi/query")`).includes('/member/multi/query'));
// 2. 原有 API 风格路径不回归
T('API 路径 /api/userinfo 仍命中(旧规则)', () => runRules('var u="/api/userinfo"', ['api']).some(r => r.value === '/api/userinfo'));
// 3. 静态资源排除
T('静态资源 .js 排除', () => !values('src="/assets/index.6db6936b.js"').some(v => v.includes('.js')));
T('静态资源 .css/.png 排除', () => values('"/assets/index.3af8e0b4.css" + "/img/logo.png"').length === 0);
// 4. 动态路由占位
T('动态路由 /member/:id 命中', () => values(`path: '/member/:id/edit'`).includes('/member/:id/edit'));
// 5. 单段路径不收（噪声控制）
T('单段路径 /login 不命中', () => values('href="/login"').length === 0);
// 6. cap 上限生效（>12 条也能全出）
T('cap 120：150 条路径能出 120 条', () => {
  const paths = Array.from({length: 150}, (_, i) => `"/biz/route${i}"`).join('+');
  return values(paths).length === 120;
});
// 7. 带 query 的路径提取纯净值
T('query 参数不混入值', () => values('get("/member/authList?page=1")').includes('/member/authList'));

let pass = 0, total = 0;
for (const [k, v] of Object.entries(checks)) { total++; if (v === true) pass++; console.log((v === true ? 'PASS' : 'FAIL') + '  ' + k + (v !== true ? ' -> ' + v : '')); }
console.log(`\n${pass}/${total} 通过`);
process.exit(pass === total ? 0 : 1);
