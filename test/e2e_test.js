// test/e2e_test.js - 用本机 Ollama 对扩展核心逻辑做端到端测试
// 桩掉 chrome API 与 DOM，直接执行真实的 analyze.js 流水线
const fs = require('fs');
const path = require('path');

// ---------- 构造模拟页面数据（模拟 extractPageInfo 的返回） ----------
const testPage = {
  url: 'http://demo.local/login',
  title: '测试管理系统登录页',
  html: `<!DOCTYPE html>
<html><head><meta name="generator" content="HBuilder X 3.8"><meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>测试管理系统</title></head>
<body>
<!-- TODO: 上线前删除测试账号 admin / Admin@123456 -->
<div id="app"></div>
<form action="/api/auth/login" method="post"><input name="username" type="text"><input name="password" type="password"></form>
<script>
var cfg = { apiKey: "sk-proj-9f8e7d6c5b4a3210abcd", apiBaseUrl: "http://192.168.1.10:8080/backend", jwtSecret: "my-jwt-secret-key-2026" };
function render(userHtml) { document.getElementById("welcome").innerHTML = userHtml; }
axios.get("/api/v1/user/list?page=1");
axios.post("http://192.168.1.10:8080/admin/login", data);
var token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9P_5NsIuRfX1o";
</script>
</body></html>`,
  scripts: [
    { src: null, inline: null },
    { src: null, inline: `var uploadUrl = "http://demo.local/api/upload/image"; var db = "mysql://root:P@ssw0rd@10.0.0.5:3306/app"; document.write("<iframe src='"+qs+"'>");` },
    { src: 'http://demo.local/static/js/app.min.js', inline: null },
    { src: 'http://demo.local/static/config.js', inline: null },
    { src: 'https://cdn.jsdelivr.net/npm/vue@2.6.14/dist/vue.min.js', inline: null },
    { src: 'https://hm.baidu.com/hm.js?abcd1234', inline: null }
  ],
  metas: [{ name: 'generator', content: 'HBuilder X 3.8' }],
  links: ['http://demo.local/admin/index', 'http://demo.local/api/doc'],
  forms: [{ action: '/api/auth/login', method: 'post', inputs: [{ name: 'username', type: 'text' }, { name: 'password', type: 'password' }] }],
  comments: ['TODO: 上线前删除测试账号 admin / Admin@123456'],
  storageKeys: ['admin_token'],
  cookies: 'PHPSESSID=abcdef123456; admin_token=eyJhbGciOiJIUzI1NiJ9.test.sig',
  generator: 'HBuilder X 3.8'
};

// 模拟外链 JS 内容
const fakeJs = `var menuApi = "/api/v1/menu/tree";
var ossUpload = "https://bucket-app.oss-cn-hangzhou.aliyuncs.com";
var wxAppSecret = "wxSecret1234567890abcdef";
var version = "vue 2.6.14"; var hasElementUI = true;
eval(decodeURIComponent(location.hash.slice(1)));
`;
const fakeConfig = `window.GLOBAL_CONFIG = {
  adminUrl: "http://192.168.1.10:8080/admin",
  encryptKey: "aes-static-key-2026-abc",
  debugMode: true
};
`;

// ---------- DOM / chrome 桩 ----------
const registry = {};
function makeEl() {
  return {
    textContent: '', innerHTML: '', value: '', placeholder: '', title: '', id: '',
    disabled: false, style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {}, addEventListener() {}, click() {}
  };
}
const $ = (id) => (registry[id] = registry[id] || makeEl());
global.document = { getElementById: $, createElement: makeEl, addEventListener() {} };

const testSettings = {
  mode: 'ollama', baseUrl: 'http://localhost:11434', apiKey: '',
  model: 'qwen3.8-4b:latest', temperature: 0.2,
  chunkSize: 4000, concurrency: 2, maxKb: 150,
  numCtx: 32768, numPredict: 8192, customPrompt: ''
};
global.chrome = {
  storage: { local: { get: async () => ({ settings: testSettings }), set: async () => {} } },
  tabs: { get: async () => ({ id: 1, title: testPage.title, url: testPage.url }) },
  runtime: {
    getURL: (p) => 'chrome-extension://test/' + p,
    sendMessage: async (msg) => msg.type === 'getHeaders'
      ? { headers: [
          { name: 'Server', value: 'nginx/1.24.0' },
          { name: 'X-Powered-By', value: 'ThinkPHP/V5.0.24' },
          { name: 'Content-Type', value: 'text/html; charset=utf-8' },
          { name: 'Access-Control-Allow-Origin', value: '*' }
        ] }
      : null
  },
  scripting: { executeScript: async () => [{ result: testPage }] }
};
global.location = { search: '' };

// ---------- fetch 路由：AI 请求走真实本机 Ollama，其余返回桩脚本 ----------
const realFetch = global.fetch;
const aiCaptures = [];
const requestedUrls = [];
global.fetch = async (url, opts = {}) => {
  url = String(url);
  requestedUrls.push(url);
  if (url.includes('localhost:11434')) {
    const r = await realFetch(url, opts);
    try { const j = await r.clone().json(); if (j && j.message) aiCaptures.push(j.message.content); } catch (e) {}
    return r;
  }
  if (/\/static\/config\.js/.test(url)) {
    return { ok: true, headers: { get: (k) => String(k).toLowerCase() === 'content-type' ? 'application/javascript' : null }, text: async () => fakeConfig };
  }
  if (/\/static\/js\/app\.min\.js/.test(url)) {
    return { ok: true, headers: { get: (k) => String(k).toLowerCase() === 'content-type' ? 'application/javascript' : null }, text: async () => fakeJs };
  }
  return { ok: false, status: 404, headers: { get: () => null }, text: async () => '' };
};

// ---------- 加载真实 analyze.js 与 rules.js（eval 作用域内导出函数） ----------
let analyzeSrc = fs.readFileSync(path.join(__dirname, '..', 'extension', 'analyze.js'), 'utf8');
analyzeSrc = analyzeSrc.replace(/^'use strict';/, '');
// eslint-disable-next-line no-eval
eval(analyzeSrc + '\n;global.__T = { analyzeTab, buildMarkdown, getReport: () => ({ report: LAST_REPORT, meta: LAST_META }) };');
eval(fs.readFileSync(path.join(__dirname, '..', 'extension', 'rules.js'), 'utf8'));
const { analyzeTab, buildMarkdown, getReport } = global.__T;

// ---------- 运行 ----------
(async () => {
  console.log('=== 开始端到端测试（本机 Ollama: ' + testSettings.model + '）===');
  await new Promise(r => setTimeout(r, 200)); // 等待 eval 期启动的 init() 完成配置加载
  const t0 = Date.now();
  await analyzeTab(1);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const { report: REPORT, meta: R_META } = getReport();
  for (const [id, el] of Object.entries(registry)) {
    if (/^chunk-/.test(id) || id === 'statusText') {
      console.log(`  DEBUG ${id}: class=${el.className || '-'} title=${(el.title || '').slice(0, 200)}`);
    }
  }
  if (!REPORT) {
    console.log('❌ 测试失败：LAST_REPORT 为空');
    for (const [id, el] of Object.entries(registry)) {
      const t = el.textContent || el.innerHTML;
      if (t) console.log(`  DOM[${id}]: ${String(t).slice(0, 300)}`);
    }
    process.exit(1);
  }
  console.log(`\n=== 分析完成，耗时 ${secs}s ===`);
  console.log(`敏感信息 ${REPORT.sensitive.length} 条:`);
  REPORT.sensitive.forEach(it => console.log(`  [${it.severity}] ${it.type}: ${String(it.value).slice(0, 70)}`));
  console.log(`API 接口 ${REPORT.apis.length} 条:`);
  REPORT.apis.forEach(it => console.log(`  ${it.method || '?'} ${it.url}  ${it.desc || ''}`.slice(0, 100)));
  console.log(`Web 指纹 ${REPORT.fingerprints.length} 条:`);
  REPORT.fingerprints.forEach(it => console.log(`  [${it.category}] ${it.name} ${it.version || ''}  证据:${String(it.evidence).slice(0, 50)}`));
  console.log(`漏洞分析 ${REPORT.vulns.length} 条:`);
  REPORT.vulns.forEach(it => console.log(`  [${it.severity}] ${it.type}: ${String(it.desc).slice(0, 80)}`));
  // 断言关键 planted 内容被找出
  const all = JSON.stringify(REPORT);
  const checks = [
    ['JWT', all.includes('eyJhbGciOiJIUzI1NiJ9')],
    ['内网IP 192.168.1.10', all.includes('192.168.1.10')],
    ['API /api/auth/login', all.includes('/api/auth/login')],
    ['注入点 ThinkPHP', /thinkphp/i.test(all)],
    ['XSS sink', /innerhtml/i.test(all)],
    ['测试账号注释', /admin/i.test(all)]
  ];
  console.log('\n=== 断言 ===');
  let pass = 0;
  for (const [name, ok] of checks) { console.log(`  ${ok ? '✅' : '❌'} ${name}`); if (ok) pass++; }
  console.log(`\n结果: ${pass}/${checks.length} 通过，Markdown 报告 ${buildMarkdown(REPORT, { url: testPage.url, title: testPage.title, model: testSettings.model, elapsed: secs }).length} 字节`);
  if (pass < checks.length) {
    aiCaptures.forEach((c, i) => {
      fs.writeFileSync(path.join(__dirname, `ai_raw_${i + 1}.txt`), c);
      console.log(`\n--- AI 原始输出 #${i + 1}（${c.length} 字符）已存 ai_raw_${i + 1}.txt，末尾 400 字符: ---\n${c.slice(-400)}`);
    });
  }
  const st = (registry.statusText || {}).textContent || '';
  console.log(`状态栏: ${st}`);
  const thirdPartyFetched = requestedUrls.filter(u => /jsdelivr|hm\.baidu/.test(u));
  const sameDomainFetched = requestedUrls.filter(u => /app\.min\.js/.test(u));
  const configFetched = requestedUrls.filter(u => /config\.js/.test(u));
  const configInReport = JSON.stringify(REPORT).includes('192.168.1.10:8080/admin') || JSON.stringify(REPORT).includes('encryptKey') || JSON.stringify(REPORT).toLowerCase().includes('aes-static-key');
  console.log(`第三方脚本过滤: ${thirdPartyFetched.length === 0 ? '✅ jsdelivr/百度统计未被请求' : '❌ 第三方脚本仍被请求: ' + thirdPartyFetched.join(',')}`);
  console.log(`同域脚本采集: ${sameDomainFetched.length ? '✅ app.min.js 已拉取' : '❌ 同域脚本未拉取'}`);
  console.log(`config.js 优先采集: ${configFetched.length ? '✅ 已拉取' : '❌ 未拉取'}${configInReport ? '，敏感内容进入报告 ✅' : '（报告未提及，见 ai_raw）'}`);
  const filterOk = thirdPartyFetched.length === 0 && sameDomainFetched.length > 0 && configFetched.length > 0;
  fs.writeFileSync(path.join(__dirname, 'e2e_report.json'), JSON.stringify(REPORT, null, 2));
  process.exit(pass >= 4 && filterOk ? 0 : 1);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
