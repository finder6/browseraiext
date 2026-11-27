// 上下文超限自动二分重试测试（含跨段重叠）
const fs = require('fs');
let src = fs.readFileSync('extension/analyze.js', 'utf8').replace(/^'use strict';/, '');
global.document = { getElementById: () => ({ classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, style: {} }), createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }), addEventListener() {} };
global.chrome = { storage: { local: { get: async () => ({ settings: {} }), set: async () => {} } }, tabs: { get: async () => ({}) }, runtime: { getURL: () => '', sendMessage: async () => null }, scripting: {} };
global.location = { search: '' };
eval(src + ';global.__NS={isContextOverflow, splitChunk, CHUNK_OVERLAP};');
const { isContextOverflow, splitChunk, CHUNK_OVERLAP } = global.__NS;

const checks = {};
const T = (name, fn) => { try { checks[name] = !!fn(); } catch (e) { checks[name] = 'ERR:' + e.message; } };
const B = (label, text) => ({ label, text });
const len = c => c.reduce((s, b) => s + b.text.length, 0);

// 1. 错误识别
T('智谱 request_invalid_parameter 识别', () => isContextOverflow('HTTP 400 {"error":{"message":"请求参数无效","type":"invalid_request_error","code":"request_invalid_parameter"}}'));
T('maximum context length 识别', () => isContextOverflow('HTTP 400 maximum context length exceeded'));
T('普通 403 WAF 不误判为超限', () => !isContextOverflow('HTTP 403 <!DOCTYPE html><html>WAF'));
T('普通网络错误不误判', () => !isContextOverflow('HTTP 502 bad gateway'));

// 2. 单文件超长：硬切 + 后半段带重叠
T('单文件硬切：前半段50%', () => {
  const [h1] = splitChunk([B('外链脚本: big.js', 'q'.repeat(100000))]);
  return h1.length === 1 && len(h1) === 50000;
});
T('单文件硬切：后半段含【上文重叠】且保留全部尾部内容', () => {
  const text = '0123456789'.repeat(10000); // 100000 字符
  const [, h2] = splitChunk([B('big.js', text)]);
  return h2[0].text.startsWith('【上文重叠')
    && h2[0].text.includes('【下文为接续内容】')
    && h2[0].text.endsWith(text.slice(50000))
    && h2[0].label.includes('第2段');
});
T('单文件硬切：重叠长度等于 CHUNK_OVERLAP', () => {
  const text = 'a'.repeat(100000);
  const [, h2] = splitChunk([B('big.js', text)]);
  const body = h2[0].text;
  const head = '【上文重叠·同一文件前段结尾】\n';
  const i1 = body.indexOf(head) + head.length;
  const i2 = body.indexOf('\n【下文为接续内容】');
  return i2 - i1 === CHUNK_OVERLAP;
});

// 3. 多板块：边界切 + 后半段附前段结尾片段
T('多板块在边界拆分', () => {
  const chunk = [B('a', 'x'.repeat(30000)), B('b', 'y'.repeat(30000)), B('c', 'z'.repeat(30000))];
  const [h1, h2] = splitChunk(chunk);
  return h1.length === 1 && h2.length === 2 && len(h1) === 30000;
});
T('多板块：后半段带上一块结尾600字符', () => {
  const chunk = [B('a', 'x'.repeat(20000)), B('b', 'y'.repeat(20000))];
  const [, h2] = splitChunk(chunk);
  return h2[0].text.startsWith('【上一块结尾·a】') && h2[0].text.includes('【本块内容】');
});
T('多板块：正文内容不丢失', () => {
  const chunk = [B('a', 'x'.repeat(20000)), B('b', 'y'.repeat(20000))];
  const [, h2] = splitChunk(chunk);
  return h2[0].text.endsWith('y'.repeat(20000)) && h2[0].label.startsWith('b');
});

let pass = 0, total = 0;
for (const [k, v] of Object.entries(checks)) { total++; if (v === true) pass++; console.log((v === true ? 'PASS' : 'FAIL') + '  ' + k + (v !== true ? ' -> ' + v : '')); }
console.log(`\n${pass}/${total} 通过`);
process.exit(pass === total ? 0 : 1);
