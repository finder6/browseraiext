// test/unit_helpers_test.js - 验证 isWafBlock / encodeUserMsg 辅助函数
'use strict';
const fs = require('fs');
const path = require('path');
let src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'analyze.js'), 'utf8').replace(/^'use strict';/, '');
global.document = { getElementById: () => ({ classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, style: {} }), createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }), addEventListener() {} };
global.chrome = { storage: { local: { get: async () => ({ settings: {} }), set: async () => {} } }, tabs: { get: async () => ({}) }, runtime: { getURL: () => '', sendMessage: async () => null }, scripting: {} };
global.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
global.TextEncoder = require('util').TextEncoder;
global.location = { search: '' };
eval(src + ';global.__H={isWafBlock,encodeUserMsg};');
const { isWafBlock, encodeUserMsg } = global.__H;

const checks = {
  'WAF 403+HTML 识别': isWafBlock('HTTP 403 {"error":{"message":"<!DOCTYPE html><html lang=\\"en\\"><title>WAF拦截页面</title>"}}'),
  '普通 403 不误判': !isWafBlock('HTTP 403 {"error":{"message":"forbidden"}}'),
  '普通超时不误判': !isWafBlock('HTTP 504 gateway timeout'),
  '普通 JSON 错误不误判': !isWafBlock('HTTP 401 {"error":{"message":"API Key 无效"}}')
};
let pass = 0;
for (const [k, v] of Object.entries(checks)) { console.log((v ? '✅' : '❌') + ' ' + k); if (v) pass++; }

// 编码往返验证
const sample = '目标页面: https://10.10.1.30\n<script>eval(x);</script> 中文内容 🛡️';
const encoded = encodeUserMsg(sample, 'https://10.10.1.30');
const b64 = encoded.match(/<<<B64>>>([\s\S]*?)<<<B64>>>/)[1];
const decoded = Buffer.from(b64, 'base64').toString('utf8');
const roundtrip = decoded === sample;
console.log((roundtrip ? '✅' : '❌') + ' Base64 编码往返一致（含中文/emoji）');
if (!roundtrip) console.log('  解码结果:', JSON.stringify(decoded.slice(0, 100)));
pass += roundtrip ? 1 : 0;
const total = Object.keys(checks).length + 1;
console.log(`单元测试: ${pass}/${total}`);
process.exit(pass === total ? 0 : 1);
