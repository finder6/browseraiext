// analyze.js - 分析页主逻辑
'use strict';

// ---------- 默认配置 ----------
const DEFAULTS = {
  mode: 'ollama',                    // ollama | openai
  baseUrl: 'http://localhost:11434',
  apiKey: '',
  model: 'qwen3.8-4b:latest',
  temperature: 0.2,
  chunkSize: 20000,                  // 字符/块
  concurrency: 2,
  maxKb: 150,                        // 最大采集内容 KB
  skipKnownLibs: true,               // 跳过已知框架库（省预算且避免误触网关 WAF）
  skipIncompleteScripts: true,       // 大型脚本剩余预算装不下时整体跳过（不采半截代码做无效分析）
  numCtx: 32768,                     // Ollama num_ctx
  numPredict: 8192,                  // Ollama num_predict
  customPrompt: ''
};

const BUILTIN_PROMPT = `你是一名资深 Web 安全分析师。分析给定的网页内容片段（可能包含 HTML、内联/外链 JavaScript、HTTP 响应头、meta 信息等）。
请从中提取以下四类信息，只报告该片段中真实存在、有依据的内容，不要臆造：

1. sensitive 敏感信息：硬编码密钥/Token/密码、云厂商 AK/SK、JWT、私钥、数据库连接串、内网 IP/域名、邮箱、手机号、身份证号、注释中的内部信息等。
2. apis API 接口：完整的接口 URL 或路径（含相对路径）、GraphQL/RPC 端点、WebSocket 地址、请求方法（若可判断）。注意业务前缀路径同样要列（如 /member/login、/memberCenter/xxx），不要只收 /api/* 开头的；前端路由（router 配置里的 path）也一并列出并注明「前端路由」。
3. fingerprints Web 指纹：前端框架/库（含版本）、打包工具（webpack/vite）、UI 组件库、后端语言/框架、服务器、CMS、统计与安全组件。给出来源证据。
4. vulns 漏洞分析：基于代码静态特征判断的潜在风险，如 DOM XSS sink（innerHTML/eval/document.write）、postMessage 无校验、硬编码凭据、CORS 配置过宽、sourcemap 泄露、敏感信息暴露、不安全的反序列化特征等。给出证据位置与修复建议。

另外内容中会附有「本地规则预筛命中项」，请逐一确认：真实有效则保留并归类，误报则丢弃。

注意：若某板块标注了「第x段/共y段」或出现「【上文重叠·同一文件前段结尾】」，说明这是同一个文件被分段提交。请把重叠部分当作上下文衔接（不要重复报告），并注意函数定义、import 表与调用点可能分处不同段，抽取接口/路径时要结合重叠段推断完整形态。

严格只输出如下 JSON，不要输出任何其他文字或代码块标记：
{
  "sensitive": [{"type":"类型","value":"命中的值","severity":"高|中|低","evidence":"上下文证据(截断至100字)"}],
  "apis": [{"method":"GET|POST|未知","url":"接口地址","desc":"一句话说明"}],
  "fingerprints": [{"category":"前端框架|构建工具|组件库|后端|服务器|CMS|其他","name":"名称","version":"版本或空","evidence":"证据"}],
  "vulns": [{"type":"漏洞类型","severity":"高|中|低","desc":"分析说明","evidence":"证据代码片段(截断至120字)","suggestion":"修复建议"}]
}
若某类在本片段中不存在，输出空数组。

注意：为兼容传输通道，内容中部分英文关键字中间可能被插入零宽空格（U+200B，如 e\u200bval、scr\u200bipt），阅读时请自动忽略零宽字符还原原词，还原后再做分析，引用证据时也请还原为原始写法。`;

// ---------- 工具函数 ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SEV_ORDER = { '高': 0, '中': 1, '低': 2, '信息': 3 };

// ---------- 配置读写 ----------
async function loadSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get('settings')).settings };
}
function saveSettings(s) { return chrome.storage.local.set({ settings: s }); }

// ---------- AI 调用 ----------
// 送 API 前的输入净化：剔除 NUL 与 C0 控制字符、修复孤立代理对、
// 压缩 1 万字符以上的无换行长串（部分后端的校验器对这类形态敏感）
function sanitizeContent(text) {
  return String(text)
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF]))|(?:(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/g, '\uFFFD')
    .replace(/[^\n]{10000}/g, '$&\n');
}

async function callAI(settings, messages, timeoutMs = 300000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let url, body, headers = { 'Content-Type': 'application/json' };
    if (settings.mode === 'ollama') {
      url = trimSlash(settings.baseUrl) + '/api/chat';
      body = JSON.stringify({
        model: settings.model,
        messages,
        stream: false,
        options: {
          temperature: Number(settings.temperature) || 0.2,
          num_ctx: Number(settings.numCtx) || 32768,
          num_predict: Number(settings.numPredict) || 8192
        }
      });
    } else {
      url = trimSlash(settings.baseUrl) + '/chat/completions';
      if (settings.apiKey) headers['Authorization'] = 'Bearer ' + settings.apiKey;
      body = JSON.stringify({
        model: settings.model,
        messages: messages.map(m => ({ ...m, content: sanitizeContent(m.content) })),
        temperature: Number(settings.temperature) || 0.2,
        stream: false
      });
    }
    const resp = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status} ${t.slice(0, 300)}`);
    }
    const data = await resp.json();
    const text = settings.mode === 'ollama'
      ? (data.message && data.message.content) || ''
      : ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '');
    if (!text) throw new Error('模型返回内容为空');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function testConnection(settings) {
  let url;
  if (settings.mode === 'ollama') url = trimSlash(settings.baseUrl) + '/api/tags';
  else url = trimSlash(settings.baseUrl) + '/models';
  const headers = {};
  if (settings.mode === 'openai' && settings.apiKey) headers['Authorization'] = 'Bearer ' + settings.apiKey;
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

function trimSlash(s) { return String(s || '').trim().replace(/\/+$/, ''); }

// UTF-8 安全的 Base64（用于 WAF 拦截时编码重试）
function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}

// 是否为 WAF/防护类 403 拦截（HTML 页面而非 JSON 错误）
function isWafBlock(errMsg) {
  return /403/.test(errMsg) && /<!DOCTYPE|<html|WAF/i.test(errMsg);
}

// 是否为「输入超出模型上下文」类错误（HTTP 400 request_invalid_parameter / context length 等）
// 特征：请求太大被上游参数校验拒绝，原样重试无意义，应对半拆分后重试
function isContextOverflow(errMsg) {
  return /request_invalid_parameter|invalid_request_error|maximum context length|context length exceeded|input is too long|输入过长|上下文长度|请求参数无效/i.test(errMsg);
}

// 将块对半拆分：多板块时选「最接近对半」的板块边界切，单板块超长才文本二分硬切。
// 同一文件被切开时，后半段携带前段尾部重叠（默认 1500 字符）并标注段落关系，
// 避免两块各自为政、丢跨段上下文（如 import 表在前段、调用在后段）
const CHUNK_OVERLAP = 1500;
function splitChunk(chunk, totalParts = 2) {
  const totalLen = chunk.reduce((s, b) => s + b.text.length, 0);
  if (chunk.length === 1) {
    const b = chunk[0];
    const mid = Math.max(1, Math.floor(b.text.length / 2));
    const head = b.text.slice(0, mid);
    const tail = b.text.slice(mid);
    const overlap = b.text.slice(Math.max(0, mid - CHUNK_OVERLAP), mid);
    return [[{ label: `${b.label}（第1段/共${totalParts}段）`, text: head }],
            [{ label: `${b.label}（第2段/共${totalParts}段，开头重叠上文${overlap.length}字符）`,
               text: `【上文重叠·同一文件前段结尾】\n${overlap}\n【下文为接续内容】\n${tail}` }]];
  }
  const half = totalLen / 2;
  let best = 1, bestDiff = Infinity, acc = 0;
  for (let k = 1; k < chunk.length; k++) {
    acc += chunk[k - 1].text.length;
    const diff = Math.abs(acc - half);
    if (diff < bestDiff) { bestDiff = diff; best = k; }
  }
  const first = chunk.slice(0, best);
  const second = chunk.slice(best).map(b => ({ ...b }));
  // 板块边界切分：给后半段附上前段结尾片段，保留跨文件关联线索
  // （如 config.js 的密钥定义 → api.js 的调用处）
  const lastBlock = first[first.length - 1];
  if (lastBlock) {
    const tailCtx = lastBlock.text.slice(-600);
    second[0].label = `${second[0].label}（开头附上一块结尾片段，仅供参考、勿重复计入）`;
    second[0].text = `【上一块结尾·${lastBlock.label}】\n${tailCtx}\n【本块内容】\n${second[0].text}`;
  }
  return [first, second];
}

// 将用户消息整体 Base64 编码以绕过 WAF 内容检测
function encodeUserMsg(userMsg, pageUrl) {
  return `目标页面: ${pageUrl || '未知'}\n\n`
    + `<<<B64>>>${utf8ToB64(userMsg)}<<<B64>>>\n\n`
    + `上面 <<<B64>>> 标记之间是 Base64(UTF-8) 编码的网页内容，请先解码为明文，再按系统提示进行安全分析。`;
}

// 修复字符串值内部未转义的引号（模型输出 JS 代码片段时常见）
// 原理：字符串内遇到 " 时前瞻，若下一个非空白字符不是 ,}]: 则判定为内部引号，补转义
function fixInnerQuotes(s) {
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (!inStr) { out += ch; if (ch === '"') inStr = true; continue; }
    if (esc) { out += ch; esc = false; continue; }
    if (ch === '\\') { out += ch; esc = true; continue; }
    if (ch === '"') {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      const nx = s[j];
      if (nx && !',}]:'.includes(nx)) { out += '\\"'; }
      else { out += ch; inStr = false; }
      continue;
    }
    out += ch;
  }
  return out;
}

// 容忍小模型常见格式毛病：尾逗号、单引号键值、行注释
function tryParseJSON(s) {
  try { return JSON.parse(s); } catch (e) {}
  try { return JSON.parse(s.replace(/,\s*([}\]])/g, '$1')); } catch (e) {}
  try {
    return JSON.parse(s
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/([{,]\s*)'([^']*?)'(\s*:)/g, '$1"$2"$3')
      .replace(/:\s*'([^']*?)'([,}\]])/g, ': "$1"$2'));
  } catch (e) {}
  try { return JSON.parse(fixInnerQuotes(s.replace(/,\s*([}\]])/g, '$1'))); } catch (e) {}
  return null;
}

// 修复被截断的 JSON：截到最后一个完整元素，再补齐未闭合的括号
function repairTruncatedJSON(s) {
  const last = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (last < 0) return null;
  let t = s.slice(0, last + 1);
  const stack = [];
  let inStr = false, esc = false;
  for (const ch of t) {
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (inStr) t = t.slice(0, t.lastIndexOf('"'));
  t += stack.reverse().join('');
  return tryParseJSON(t);
}

// 从模型输出中稳健提取 JSON 对象
function extractJSON(text) {
  if (!text) return null;
  // 先去掉代码块围栏
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [];
  if (fence) candidates.push(fence[1]);
  candidates.push(text);
  for (const c of candidates) {
    const start = c.indexOf('{');
    if (start < 0) continue;
    let depth = 0, inStr = false, escape = false;
    for (let i = start; i < c.length; i++) {
      const ch = c[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const parsed = tryParseJSON(c.slice(start, i + 1));
          if (parsed) return parsed;
          // 解析失败则继续扫描，可能后面还有完整对象
        }
      }
    }
    // 兜底：完整对象没找到，尝试修复截断的 JSON
    const repaired = repairTruncatedJSON(c.slice(start));
    if (repaired) return repaired;
  }
  return null;
}

// ---------- 页面采集 ----------
function extractPageInfo(maxHtml) {
  // 在目标页面上下文执行
  const html = document.documentElement.outerHTML;
  // 先清理噪声、后截断：让采集预算花在有价值的内容上，而不是被 SVG 雪碧图/CSS/注释挤占。
  // 与 analyze.js 的 stripNoise 保持同一套规则（注入函数必须自包含，无法引用外部函数）
  const beforeClean = html.length;
  let clean = html
    .replace(/<svg\b[^>]*>[\s\S]*?<\\?\/svg\s*>/gi, m => `[SVG已剔除:${m.length}字符]`)
    .replace(/<symbol\b[^>]*>[\s\S]*?<\\?\/symbol\s*>/gi, m => `[SVG雪碧图已剔除:${m.length}字符]`)
    .replace(/<path\b[^>]*\bd=\\?"[^"]{40,}\\?"[^>]*\\?\/?>/gi, m => `[SVG路径已剔除:${m.length}字符]`)
    .replace(/<style\b[^>]*>[\s\S]*?<\\?\/style\s*>/gi, m => `[CSS样式已剔除:${m.length}字符]`)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\sdata-v-[\w-]+(?:="")?/g, '')
    .replace(/style="([^"]{20,400})"/g, (m, v) => {
      if (!/(animation|transition|transform|@keyframes)/i.test(v)) return m;
      const kept = v.split(';').filter(decl => !/^\s*(animation|transition|transform|will-change)/i.test(decl)
        && !/^\s*(left|top|width|height)\s*:\s*[\d.]+(px|%)\s*$/i.test(decl)).join(';').trim();
      return kept ? `style="${kept}"` : 'style=""';
    })
    .replace(/data:image\/svg\+xml[^"'\s)]{100,}/gi, m => `[已剔除SVG数据URI:${m.length}字符]`)
    .replace(/data:[a-zA-Z0-9.+-/]+;base64,[A-Za-z0-9+/=]{100,}/gi, m => `[已剔除base64数据:${m.length}字符]`)
    .replace(/[A-Za-z0-9+/=]{600,}/g, m => `[已剔除长base64串:${m.length}字符]`)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
  // 未闭合兜底（截断场景的保险）
  clean = clean.replace(/<svg\b[^>]*>[\s\S]*$/i, m => `[SVG已剔除(未闭合):${m.length}字符]`)
    .replace(/<style\b[^>]*>[\s\S]*$/i, m => `[CSS样式已剔除(未闭合):${m.length}字符]`);
  const scripts = Array.from(document.scripts).map(s => ({
    src: s.src || null,
    inline: s.src ? null : (s.textContent || '').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').slice(0, 20000),
    inlineLen: s.src ? 0 : (s.textContent || '').length
  }));
  // modulepreload / preload 的 JS 资源：Vite/webpack 站点用 <link rel="modulepreload"> 预加载
  // 懒加载路由 chunk，这些文件不在 <script> 标签里但往往包含各页面业务逻辑，一并纳入采集候选
  const preloads = Array.from(document.querySelectorAll('link[rel="modulepreload"], link[rel="preload"]'))
    .map(l => ({ href: l.href, as: l.as || '' }))
    .filter(p => /^https?:/i.test(p.href))
    .filter(p => p.href.split('?')[0].toLowerCase().endsWith('.js') || p.as === 'script')
    .map(p => p.href);
  const metas = Array.from(document.querySelectorAll('meta')).map(m => ({
    name: m.name || m.getAttribute('property') || m.getAttribute('http-equiv') || '',
    content: m.content || ''
  }));
  const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 150).map(a => a.href);
  const forms = Array.from(document.querySelectorAll('form')).slice(0, 30).map(f => ({
    action: f.action, method: f.method,
    inputs: Array.from(f.querySelectorAll('input,select,textarea')).slice(0, 40)
      .map(i => ({ name: i.name || '', type: i.type || '' }))
  }));
  const comments = [];
  try {
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
    let node, n = 0;
    while ((node = walker.nextNode()) && n < 50) {
      const t = (node.nodeValue || '').trim();
      if (t) { comments.push(t.slice(0, 300)); n++; }
    }
  } catch (e) {}
  let storageKeys = [];
  try { storageKeys = Object.keys(localStorage).slice(0, 50); } catch (e) {}
  let cookies = '';
  try { cookies = document.cookie || ''; } catch (e) {}
  let generator = '';
  try { generator = (document.querySelector('meta[name=generator]') || {}).content || ''; } catch (e) {}
  return {
    url: location.href, title: document.title,
    html: clean.slice(0, maxHtml),
    htmlLen: clean.length,          // 清理后全长（用于截断标注）
    origHtmlLen: html.length,       // 清理前原始长度（用于统计）
    preNoiseRemoved: beforeClean - clean.length,
    scripts, preloads, metas, links, forms, comments, storageKeys, cookies, generator
  };
}

// ---------- 语料构建 ----------
// 清理无分析价值的噪声内容（base64 图片/字体、长编码串），保留占位标注
function stripNoise(text, opts = {}) {
  if (!text) return { text: text || '', removed: 0 };
  const before = text.length;
  // data URI（base64 图片/字体等）
  let out = text.replace(/data:[a-zA-Z0-9.+-/]+;base64,[A-Za-z0-9+/=]{100,}/g,
    m => `[已剔除base64数据:${m.length}字符]`);
  // 裸的长 base64 串（srcset、JS 变量里的编码图等，600+ 字符才处理，避免误伤长标识符）
  out = out.replace(/[A-Za-z0-9+/=]{600,}/g, m => `[已剔除长base64串:${m.length}字符]`);
  // SVG 标签块：图标/装饰性矢量图形，路径数据冗长且无分析价值，整体剔除只留占位
  // （\\? 兼容 JS 字符串里的转义写法：<\/svg>、<\/symbol>、<\/style>）
  out = out.replace(/<svg\b[^>]*>[\s\S]*?<\\?\/svg\s*>/gi, m => `[SVG已剔除:${m.length}字符]`);
  // SVG 雪碧图片段（常见于 JS 模板字符串，不带 <svg> 外壳）：
  // t.innerHTML=`<symbol id="icon-404" viewBox="0 0 128 128"><path d="M121.718 ..."/></symbol>`
  out = out.replace(/<symbol\b[^>]*>[\s\S]*?<\\?\/symbol\s*>/gi, m => `[SVG雪碧图已剔除:${m.length}字符]`);
  // 散落的 <path d="M..."> 长路径数据（坐标串动辄数千字符且无分析价值）；
  // \\? 兼容 JS 双引号字符串里的 d=\"M1 2...\" 转义引号
  out = out.replace(/<path\b[^>]*\bd=\\?"[^"]{40,}\\?"[^>]*\\?\/?>/gi, m => `[SVG路径已剔除:${m.length}字符]`);
  // URL 编码的内联 SVG data URI（data:image/svg+xml,%3Csvg... 这类）
  out = out.replace(/data:image\/svg\+xml[^"'\s)]{100,}/gi, m => `[已剔除SVG数据URI:${m.length}字符]`);
  // <style> 样式块：CSS 无论出现在 HTML 正文还是 JS 拼接的模板里（document.write('<style>...')）
  // 都无安全分析价值，所有模式统一剔除；未闭合兜底防止截断残留
  out = out.replace(/<style\b[^>]*>[\s\S]*?<\\?\/style\s*>/gi, m => `[CSS样式已剔除:${m.length}字符]`);
  out = out.replace(/<style\b[^>]*>[\s\S]*$/i, m => `[CSS样式已剔除(未闭合):${m.length}字符]`);
  // 未闭合兜底：HTML/JS 被采集上限截断时 </svg>/</style> 闭合标签可能被切掉，
  // 孤立的起始标签直接剔到文本末尾（SVG 雪碧图 <svg id="__svg__icons__dom__"> 常见于页面尾部）
  out = out.replace(/<svg\b[^>]*>[\s\S]*$/i, m => `[SVG已剔除(未闭合):${m.length}字符]`);
  if (opts.html) {
    // HTML 注释：已单独采集为「HTML 注释」板块，正文里剔除避免重复
    out = out.replace(/<!--[\s\S]*?-->/g, '');
    // 条件注释残留（<!--[if lt IE 9]> ... <![endif]--> 形式的变体）
    out = out.replace(/<!\[endif\]-->/g, '');
    // Vue 作用域样式属性 data-v-xxxxxxx：每个元素都带一份，纯框架标记无安全价值
    out = out.replace(/\sdata-v-[\w-]+(?:="")?/g, '');
    // 装饰性动画/定位内联样式（粒子、扫描线、雷达环等，纯视觉）：整段 style 值剔除，
    // 保留 style 属性本身，避免丢失 background:url(javascript:) 这类老式 XSS 线索
    out = out.replace(/style="([^"]{20,400})"/g, (m, v) => {
      if (!/(animation|transition|transform|@keyframes)/i.test(v)) return m;
      const kept = v.split(';').filter(decl => !/^\s*(animation|transition|transform|will-change)/i.test(decl)
        && !/^\s*(left|top|width|height)\s*:\s*[\d.]+(px|%)\s*$/i.test(decl)).join(';').trim();
      return kept ? `style="${kept}"` : 'style=""';
    });
  }
  // 空白归一化：连续空格/制表符压成 1 个，3 个以上换行压成 2 个（纯 token 节省，不改变内容）
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
  return { text: out, removed: before - out.length };
}

// ---------- 外链脚本预算分配 ----------
// 文件名含 config/secret/env 等关键词的疑似配置脚本最优先（排序由调用方完成）
const HIGH_RISK_RE = /(config|conf|setting|env|secret|key|token|auth|credential|constant|global|init|param|api)/i;
// 按调用方排好序的优先级依次分配预算；关键点：按实际取用的字符数记账，
// 而不是按"可用额度"记账（旧版 used += take 导致每个小脚本虚扣 60000，预算提前耗尽）
// completeOnly（默认）：剩余预算装不下整个文件就整体跳过——半截代码缺上下文，
// 模型只能基于残缺代码猜结论，与其出一份无效分析，不如明确标注「未完整采集」。
function allocateScriptBudget(fetchedScripts, budget, usedStart, opts = {}) {
  const completeOnly = opts.completeOnly !== false;
  let used = usedStart;
  const scriptBodies = [];
  const exhausted = [];
  const incomplete = [];
  for (const f of fetchedScripts) {
    const remain = budget - used;
    if (remain < 2000) {
      exhausted.push(f);
      continue;
    }
    if (f.origLen <= remain) {
      // 完整采集：不做 60000 截断，能装下就给全文
      used += f.origLen;
      scriptBodies.push({
        name: f.url.split('/').pop().split('?')[0] || f.url,
        content: f.full,
        origLen: f.origLen,
        risky: HIGH_RISK_RE.test(f.url)
      });
      continue;
    }
    if (completeOnly) {
      incomplete.push(f);
      continue;
    }
    const take = Math.min(60000, remain);
    const content = f.full.slice(0, take);
    used += content.length;
    scriptBodies.push({
      name: f.url.split('/').pop().split('?')[0] || f.url,
      content,
      origLen: f.origLen,
      risky: HIGH_RISK_RE.test(f.url)
    });
  }
  return { scriptBodies, exhausted, incomplete };
}

function buildCorpus(page, headers, scriptBodies) {
  const blocks = [];
  let noiseRemoved = 0;
  const H = (t) => `\n===== ${t} =====\n`;
  blocks.push({ label: '页面基本信息', text: `URL: ${page.url}\n标题: ${page.title}\nGenerator: ${page.generator}` });
  if (headers) {
    blocks.push({ label: 'HTTP 响应头', text: headers.map(h => `${h.name}: ${h.value}`).join('\n').slice(0, 4000) });
  }
  if (page.metas.length) {
    blocks.push({ label: 'META 标签', text: page.metas.map(m => `${m.name}: ${m.content}`).join('\n').slice(0, 3000) });
  }
  if (page.cookies) blocks.push({ label: 'Cookies', text: page.cookies.slice(0, 2000) });
  if (page.comments.length) blocks.push({ label: 'HTML 注释', text: page.comments.join('\n').slice(0, 4000) });
  if (page.storageKeys.length) blocks.push({ label: 'LocalStorage 键', text: page.storageKeys.join(', ') });
  if (page.forms.length) {
    blocks.push({ label: '表单', text: page.forms.map(f => `${(f.method || 'GET').toUpperCase()} ${f.action}\n  字段: ${f.inputs.map(i => i.name + '(' + i.type + ')').join(', ')}`).join('\n').slice(0, 5000) });
  }
  if (page.links.length) blocks.push({ label: '页面链接(前150)', text: page.links.join('\n').slice(0, 6000) });
  noiseRemoved += page.preNoiseRemoved || 0;  // 采集端预清理（先清理后截断）的剔除量
  const htmlNote = (page.htmlLen && page.htmlLen > page.html.length)
    ? `\n[注: HTML 清理噪声后共 ${page.htmlLen} 字符，受采集上限截取 ${page.html.length} 字符，可在设置中调大「最大采集内容(KB)」]` : '';
  const h = stripNoise(page.html, { html: true });
  noiseRemoved += h.removed;
  blocks.push({ label: 'HTML 源码', text: h.text + htmlNote });
  const inlines = page.scripts.filter(s => !s.src && s.inline && s.inline.trim());
  if (inlines.length) {
    blocks.push({
      label: '内联脚本',
      text: inlines.map((s, i) => {
        const note = s.inlineLen > (s.inline || '').length
          ? ` (原始 ${s.inlineLen} 字符，截取 ${(s.inline || '').length})` : '';
        const c = stripNoise(s.inline || '');
        noiseRemoved += c.removed;
        return `--- inline script #${i + 1}${note} ---\n${c.text}`;
      }).join('\n')
    });
  }
  for (const sb of scriptBodies) {
    const note = sb.origLen && sb.origLen > sb.content.length
      ? `\n\n[注: 该脚本原始 ${sb.origLen} 字符，受采集上限截取 ${sb.content.length} 字符，可在设置中调大「最大采集内容(KB)」]` : '';
    const tag = sb.risky ? '【疑似配置/凭据文件，重点关注敏感信息】' : '';
    const c = stripNoise(sb.content);
    noiseRemoved += c.removed;
    blocks.push({ label: `外链脚本: ${sb.name}${tag}`, text: c.text + note });
  }
  if (page.skippedScripts && page.skippedScripts.length) {
    blocks.push({ label: '未采集的外链脚本', text: '以下脚本未纳入分析（第三方域名/拉取失败/预算用尽）:\n' + page.skippedScripts.join('\n') });
  }
  const result = blocks.filter(b => b.text && b.text.trim());
  result.noiseRemoved = noiseRemoved;
  return result;
}

// 块的「正文长度」：排除跨段重叠前缀，用于尾块合并尺寸判断（重叠不算真实内容量）
function chunkBodyLen(chunk) {
  const OVERLAP_PREFIX = /^【上文重叠·同一文件前段结尾】\n[\s\S]*?\n【下文为接续内容】\n/;
  return chunk.reduce((s, b, i) => {
    let t = b.text;
    if (i === 0) {
      const m = t.match(OVERLAP_PREFIX);
      if (m) t = t.slice(m[0].length);
    }
    return s + t.length;
  }, 0);
}

function chunkBlocks(blocks, chunkSize) {
  const chunks = [];
  let cur = [], curLen = 0;
  for (const b of blocks) {
    let text = b.text;
    if (text.length > chunkSize) {
      // 先冲刷当前块
      if (cur.length) { chunks.push(cur); cur = []; curLen = 0; }
      // 大块硬切：同一文件的各段带尾部重叠（默认 1500 字符）并标注段序号，
      // 避免 import 表在前段、实际调用在后段时两段互相"看不见"
      const parts = Math.ceil(text.length / chunkSize);
      for (let i = 0, seg = 1; i < text.length; i += chunkSize, seg++) {
        const body = text.slice(i, i + chunkSize);
        const prefix = i > 0
          ? `【上文重叠·同一文件前段结尾】\n${text.slice(Math.max(0, i - CHUNK_OVERLAP), i)}\n【下文为接续内容】\n`
          : '';
        chunks.push([{ label: `${b.label}（第${seg}段/共${parts}段）`, text: prefix + body }]);
      }
      continue;
    }
    if (curLen + text.length > chunkSize && cur.length) {
      chunks.push(cur); cur = []; curLen = 0;
    }
    cur.push(b); curLen += text.length;
  }
  if (cur.length) chunks.push(cur);
  // 尾块过小则并入前一块（允许适度超限到 1.3×chunkSize）：每省一个块就省一次
  // 请求的固定开销（系统提示约 600 token + 输出开销），26000 字符 ≈ 10K token，
  // 距 numCtx 32768 的安全上限仍有充足余量
  if (chunks.length >= 2) {
    const last = chunks[chunks.length - 1];
    const lastLen = chunkBodyLen(last);
    const prev = chunks[chunks.length - 2];
    const prevLen = chunkBodyLen(prev);
    if (lastLen <= 5000 && prevLen + lastLen <= chunkSize * 1.3) {
      prev.push(...last);
      chunks.pop();
    }
  }
  return chunks;
}

// ---------- WAF 特征打散 ----------
// 某些 AI 网关前置 WAF 会对请求体做攻击签名检测，而本扩展的正文（网页代码）
// 天然包含 eval/script/innerHTML 等特征，必然误中。处理方式：把高危关键字
// 中间插入零宽空格 U+200B 打断签名（正文其余部分保持明文，不损失推理速度），
// 并在系统提示词里告知模型自动还原（见 BUILTIN_PROMPT 末尾说明）。
const WAF_KEYWORDS = [
  'eval', 'alert(', 'prompt(', 'confirm(', '<script', '</script', '<iframe',
  'innerHTML', 'document.write', 'document.cookie', 'outerHTML',
  'document.createElement', 'createElement',
  'onerror', 'onload', 'javascript:', 'vbscript:',
  'union select', 'or 1=1', "' or '", 'drop table', 'sleep(', 'benchmark(',
  'waitfor delay', 'load_file', 'into outfile', '/etc/passwd', 'boot.ini',
  'decodeURIComponent', 'fromCharCode', 'atob(', 'child_process', 'rm -rf', 'write('
];
const ZWSP = '\u200b';
function obfuscateForWaf(text) {
  if (!text) return text;
  let out = text;
  for (const kw of WAF_KEYWORDS) {
    // 关键字内部允许已有空白差异（如 union  select）；按实际匹配原文切分以保留大小写。
    // 拆分点放在 25% 处，避免残段（如 documen␣t.write 中的 t.write( ）仍命中签名
    const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'), 'gi');
    out = out.replace(re, (m) => {
      const i = Math.max(1, Math.floor(m.length / 4));
      return m.slice(0, i) + ZWSP + m.slice(i);
    });
  }
  // 通用内联事件处理器：onclick/onmouseover/... = 全部打散
  out = out.replace(/\bon[a-z]{3,12}(\s*=[^=]|$)/gi, (m, tail) => 'on' + ZWSP + m.slice(2, m.length - tail.length) + tail);
  return out;
}
function chunkToPrompt(chunk, idx, total, pageUrl) {
  const body = chunk.map(b => `\n===== ${b.label} =====\n${obfuscateForWaf(b.text)}`).join('\n');
  return `目标页面: ${pageUrl}\n内容片段 ${idx + 1}/${total}（共 ${total} 片段，本片段可能只是部分内容，片段间可能有重叠上下文缺失）\n${body}`;
}

// ---------- 规则命中项按块分发 ----------
// 旧版把全部规则命中项（最多 80 条）复制进每个分块，8 块就多花约 7 万字符（2 万+ token）。
// 改为：命中值出现在哪个块的文本里，就只发给哪个块；跨块截断等罕见未匹配项附加到最后一块兜底。
function buildRuleSummariesPerChunk(findings, chunks) {
  const matched = chunks.map(() => []);
  const unmatched = [];
  for (const f of findings.slice(0, 200)) {
    let hit = false;
    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i].map(b => b.text).join('\n').includes(f.value)) {
        matched[i].push(f); hit = true; break;  // 只归属首个命中的块（合并端会去重）
      }
    }
    if (!hit) unmatched.push(f);
  }
  if (unmatched.length && matched.length) matched[matched.length - 1].push(...unmatched);
  return matched.map(arr => arr.slice(0, 80)
    .map(f => `- [${f.category}/${f.rule}] ${String(f.value).slice(0, 100)}`).join('\n'));
}

// ---------- 结果合并 ----------
function mergeFindings(results) {
  const merged = { sensitive: [], apis: [], fingerprints: [], vulns: [] };
  const keyOf = (cat, o) => {
    const v = (o.value || o.url || o.name || o.type || JSON.stringify(o)).toString().toLowerCase().trim();
    const extra = cat === 'apis' ? (o.method || '') : (o.rule || o.name || '');
    return cat + '|' + extra + '|' + v.slice(0, 120);
  };
  const seen = new Set();
  for (const r of results) {
    for (const cat of Object.keys(merged)) {
      const arr = Array.isArray(r && r[cat]) ? r[cat] : [];
      for (const item of arr) {
        if (!item || typeof item !== 'object') continue;
        const k = keyOf(cat, item);
        if (seen.has(k)) continue;
        seen.add(k);
        merged[cat].push(item);
      }
    }
  }
  for (const cat of Object.keys(merged)) {
    merged[cat].sort((a, b) => (SEV_ORDER[a.severity] ?? 4) - (SEV_ORDER[b.severity] ?? 4));
  }
  return merged;
}

// ---------- 渲染 ----------
function renderFinding(container, fields) {
  const div = document.createElement('div');
  div.className = 'finding';
  div.innerHTML = fields;
  container.appendChild(div);
}
function setCount(id, n) {
  const el = $(id);
  el.textContent = n;
  el.classList.toggle('zero', n === 0);
}

function renderReport(merged, meta) {
  // 汇总条
  const sevCount = { '高': 0, '中': 0, '低': 0 };
  for (const cat of ['sensitive', 'vulns']) {
    for (const it of merged[cat]) if (it.severity in sevCount) sevCount[it.severity]++;
  }
  $('summaryBar').innerHTML = `
    <span class="chip">目标: <b>${esc(meta.url)}</b></span>
    <span class="chip">模型: <b>${esc(meta.model)}</b></span>
    <span class="chip">耗时: <b>${meta.elapsed}s</b></span>
    <span class="chip">高危: <b style="color:#b91c1c">${sevCount['高']}</b></span>
    <span class="chip">中危: <b style="color:#b45309">${sevCount['中']}</b></span>`;

  // 敏感信息
  const s1 = $('secSensitive'); s1.innerHTML = '';
  for (const it of merged.sensitive) {
    renderFinding(s1, `
      <span class="f-type">${esc(it.type || '未知')}</span>
      <span class="f-main"><span class="badge ${esc(it.severity || '信息')}">${esc(it.severity || '信息')}</span> <span class="f-value">${esc(it.value)}</span></span>
      <span></span>
      ${it.evidence ? `<span class="f-evidence">证据: ${esc(it.evidence)}</span>` : ''}`);
  }
  if (!merged.sensitive.length) s1.innerHTML = '<div class="empty">未发现敏感信息</div>';

  // API
  const s2 = $('secApis'); s2.innerHTML = '';
  for (const it of merged.apis) {
    renderFinding(s2, `
      <span class="f-type">${esc(it.method || '未知')}</span>
      <span class="f-main"><span class="f-value">${esc(it.url || '')}</span></span>
      <span class="f-extra">${esc(it.desc || '')}</span>`);
  }
  if (!merged.apis.length) s2.innerHTML = '<div class="empty">未发现 API 接口</div>';

  // 指纹
  const s3 = $('secFinger'); s3.innerHTML = '';
  for (const it of merged.fingerprints) {
    renderFinding(s3, `
      <span class="f-type"><span class="badge cat">${esc(it.category || '其他')}</span></span>
      <span class="f-main">${esc(it.name || '')}${it.version ? ` <span class="f-extra">v${esc(it.version)}</span>` : ''}</span>
      <span></span>
      ${it.evidence ? `<span class="f-evidence">证据: ${esc(it.evidence)}</span>` : ''}`);
  }
  if (!merged.fingerprints.length) s3.innerHTML = '<div class="empty">未识别到指纹</div>';

  // 漏洞
  const s4 = $('secVulns'); s4.innerHTML = '';
  for (const it of merged.vulns) {
    renderFinding(s4, `
      <span class="f-type">${esc(it.type || '')}</span>
      <span class="f-main"><span class="badge ${esc(it.severity || '信息')}">${esc(it.severity || '信息')}</span> ${esc(it.desc || '')}</span>
      <span></span>
      ${it.evidence ? `<span class="f-evidence">证据: ${esc(it.evidence)}</span>` : ''}
      ${it.suggestion ? `<span class="f-evidence">建议: ${esc(it.suggestion)}</span>` : ''}`);
  }
  if (!merged.vulns.length) s4.innerHTML = '<div class="empty">未发现明显漏洞特征</div>';

  setCount('cntSensitive', merged.sensitive.length);
  setCount('cntApis', merged.apis.length);
  setCount('cntFinger', merged.fingerprints.length);
  setCount('cntVulns', merged.vulns.length);
  $('report').classList.remove('hidden');
}

function renderRegex(findings) {
  $('regexCount').textContent = findings.length;
  $('regexCount').classList.toggle('zero', !findings.length);
  const box = $('regexResults');
  box.innerHTML = '';
  // 页面只渲染前 100 条（面板限高滚动），全部命中项已随原文提交 AI，不因展示截断而丢失
  const shown = findings.slice(0, 100);
  for (const f of shown) {
    const div = document.createElement('div');
    div.className = 'finding';
    const badge = f.category === 'sensitive' ? '高' : f.category === 'vulnHint' ? '中' : f.category === 'api' ? '低' : '信息';
    div.innerHTML = `
      <span class="f-type">${esc(f.rule)}</span>
      <span class="f-main"><span class="badge ${badge}">${esc(f.category)}</span> <span class="f-value">${esc(f.value)}</span></span>
      <span></span>
      <span class="f-evidence">${esc(f.context)}</span>`;
    box.appendChild(div);
  }
  if (!findings.length) box.innerHTML = '<div class="empty">正则引擎未命中</div>';
  else if (findings.length > shown.length) {
    const note = document.createElement('div');
    note.className = 'empty';
    note.textContent = `页面仅展示前 ${shown.length} 条（共 ${findings.length} 条），其余项已随原文提交 AI 确认`;
    box.appendChild(note);
  }
  $('regexCard').classList.remove('hidden');
}

// ---------- 导出 ----------
function buildMarkdown(merged, meta) {
  const L = [];
  L.push(`# AI 页面安全分析报告`, ``,
    `- 目标: ${meta.url}`, `- 标题: ${meta.title}`, `- 模型: ${meta.model}`,
    `- 分析时间: ${new Date().toLocaleString()}`, `- 耗时: ${meta.elapsed}s`, ``);
  const sec = (title, arr, fmt) => {
    L.push(`## ${title}（${arr.length}）`, ``);
    if (!arr.length) L.push(`无`, ``);
    else { arr.forEach((it, i) => L.push(`${i + 1}. ${fmt(it)}`)); L.push(''); }
  };
  sec('敏感信息', merged.sensitive, it => `[${it.severity || '信息'}] **${it.type}**: \`${it.value}\`${it.evidence ? `\n   - 证据: ${it.evidence}` : ''}`);
  sec('API 接口', merged.apis, it => `**${it.method || '未知'}** \`${it.url}\`${it.desc ? ' - ' + it.desc : ''}`);
  sec('Web 指纹', merged.fingerprints, it => `**${it.name}**${it.version ? ' v' + it.version : ''}（${it.category || '其他'}）${it.evidence ? `\n   - 证据: ${it.evidence}` : ''}`);
  sec('漏洞分析', merged.vulns, it => `[${it.severity || '信息'}] **${it.type}**: ${it.desc}${it.evidence ? `\n   - 证据: ${it.evidence}` : ''}${it.suggestion ? `\n   - 建议: ${it.suggestion}` : ''}`);
  return L.join('\n');
}

function download(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- 主流程 ----------
let LAST_REPORT = null, LAST_META = null, CURRENT_SETTINGS = null, LAST_FAILED_DUMPS = [];

function showError(msg) {
  $('errorText').textContent = msg;
  $('errorCard').classList.remove('hidden');
  $('progressCard').classList.add('hidden');
  $('report').classList.add('hidden');
}

async function analyzeTab(tabId) {
  const t0 = Date.now();
  $('btnReanalyze').disabled = true;
  $('errorCard').classList.add('hidden');
  $('report').classList.add('hidden');
  $('failCard').classList.add('hidden');
  $('progressCard').classList.remove('hidden');
  $('progressTitle').textContent = '正在采集页面内容…';
  $('progressBar').style.width = '5%';
  $('statusText').textContent = '';

  try {
    const settings = CURRENT_SETTINGS;
    const maxHtml = Math.min(60000, (settings.maxKb || 150) * 1024 / 2);

    // 1. 注入采集
    const [page] = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractPageInfo,
      args: [Math.round(maxHtml)]
    }).then(r => r.map(x => x.result));
    if (!page || !page.url) throw new Error('无法读取页面内容');
    if (!/^https?:/i.test(page.url)) throw new Error('仅支持 http/https 页面');
    $('targetInfo').textContent = page.title + ' — ' + page.url;

    // 2. 响应头
    $('statusText').textContent = '获取响应头…';
    const headers = await chrome.runtime.sendMessage({ type: 'getHeaders', tabId }).catch(() => null);
    const headerList = headers && headers.headers ? headers.headers : null;

    // 3. 拉取外链脚本（仅主域名相关：同主机或同根域，过滤 CDN/统计等第三方脚本）
    let pageHost = '';
    try { pageHost = new URL(page.url).hostname; } catch (e) {}
    const rootDomain = pageHost.split('.').slice(-2).join('.');
    const sameSite = (u) => {
      try {
        const h = new URL(u).hostname;
        return h === pageHost || (rootDomain && (h === rootDomain || h.endsWith('.' + rootDomain)));
      } catch (e) { return false; }
    };
    const allSrcs = page.scripts.filter(s => s.src && /^https?:/i.test(s.src)).map(s => s.src)
      .concat(page.preloads || []);
    const uniqueSrcs = [...new Set(allSrcs)].filter(sameSite).slice(0, 25);
    const skipped = allSrcs.length - uniqueSrcs.length;
    const notCollected = [];
    if (skipped > 0) notCollected.push(`- [第三方域名，已跳过] 共 ${skipped} 个脚本`);
    const budget = (settings.maxKb || 150) * 1024;
    let used = page.html.length;

    // 阶段1：下载全部同域脚本体并测量体积（下载不占 AI 预算，只有送分析的内容才占）
    const fetchedScripts = [];
    for (let i = 0; i < uniqueSrcs.length; i++) {
      $('statusText').textContent = `测量外链脚本体积（${i + 1}/${uniqueSrcs.length}）…`;
      try {
        const r = await fetch(uniqueSrcs[i], { credentials: 'omit' });
        if (r.ok) {
          const ct = r.headers.get('content-type') || '';
          if (/javascript|ecmascript|text\/(j|ecma)|application\/x-js/i.test(ct) || /\.js(\?|$)/i.test(uniqueSrcs[i])) {
            const full = await r.text();
            fetchedScripts.push({ url: uniqueSrcs[i], full, origLen: full.length });
          } else {
            notCollected.push(`- [非 JS 内容，未采集] ${uniqueSrcs[i]} (${ct || '未知类型'})`);
          }
        } else {
          notCollected.push(`- [HTTP ${r.status}，拉取失败] ${uniqueSrcs[i]}`);
        }
      } catch (e) {
        notCollected.push(`- [请求异常，未采集] ${uniqueSrcs[i]}`);
      }
    }

    // 阶段2：优先级分配预算——文件名含 config/secret/env 等关键词的疑似配置脚本最优先，
    // 其次按体积从小到大（小脚本信息密度高），大文件用剩余预算截断或整体放弃
    // 已知框架库检测：压缩后的标准库体积大、几乎无敏感信息，且密集代码易误触网关 WAF，
    // 默认跳过（指纹信息可从 HTML 引用与响应头获得），可在设置中关闭
    const LIB_NAME_RE = /(^|[/\-.])(jquery|jquery[-.]ui|vue|bootstrap|angular|react|react[-.]dom|lodash|zepto|layui|swiper|moment|echarts|element[-.]ui|element[-.]plus|antd|axios|underscore|backbone|prototype|dojo|mootools|modernizr|fastclick|slimscroll|html5shiv|respond|jquery\.validate|jquery\.form|lazyload|layer|plupload|ueditor|kindeditor|chart\.js|d3|three|gsap|swiper|animate|wow|skel)([/\-.]|$)/i;
    function detectLibBanner(head) {
      const m = head.slice(0, 800).match(/\/\*[!\s]*([^\n]{5,100})\*\//);
      return m ? m[1].trim() : '';
    }
    for (const f of fetchedScripts.slice()) {
      const fname = f.url.split('/').pop() || f.url;
      const banner = detectLibBanner(f.full);
      const isLib = settings.skipKnownLibs !== false &&
        (LIB_NAME_RE.test(fname) || (f.origLen > 30000 && /min\.js/i.test(fname)) ||
         (banner && /(jQuery|Vue|Bootstrap|lodash|axios|zepto|Angular|React|moment|ECharts|Swiper|layui|ElementUI|fastClick|slimscroll|Prototype|Dojo|Modernizr|underscore)/i.test(banner)));
      if (isLib) {
        fetchedScripts.splice(fetchedScripts.indexOf(f), 1);
        notCollected.push(`- [已知框架库，默认跳过（可在设置中开启分析）] ${fname}${banner ? ' — ' + banner : ''} (原始 ${f.origLen} 字符)`);
      }
    }
    fetchedScripts.sort((a, b) => {
      const ra = HIGH_RISK_RE.test(a.url) ? 0 : 1;
      const rb = HIGH_RISK_RE.test(b.url) ? 0 : 1;
      return ra - rb || a.origLen - b.origLen;
    });
    const { scriptBodies, exhausted, incomplete } = allocateScriptBudget(
      fetchedScripts, budget, used, { completeOnly: settings.skipIncompleteScripts !== false });
    for (const f of incomplete) {
      notCollected.push(`- [体积超出剩余预算，未完整采集故跳过（避免拿半截代码做无效分析）] ${f.url} (原始 ${f.origLen} 字符)`);
    }
    for (const f of exhausted) {
      notCollected.push(`- [预算用尽，未采集] ${f.url} (原始 ${f.origLen} 字符)`);
    }
    page.skippedScripts = notCollected;
    const fullCount = scriptBodies.filter(s => s.content.length >= s.origLen).length;
    $('statusText').textContent = `外链脚本处理完成：完整采集 ${fullCount} 个（共 ${scriptBodies.length} 个纳入分析${incomplete.length ? `，${incomplete.length} 个装不下已跳过` : ''}）`;

    // 4. 构建语料 + 本地预筛
    const blocks = buildCorpus(page, headerList, scriptBodies);
    const fullText = blocks.map(b => b.text).join('\n');
    const ruleFindings = runRules(fullText, ['sensitive', 'api', 'fingerprint', 'vulnHint']);
    renderRegex(ruleFindings);

    // 采集内容预览
    const rawPreview = blocks.map(b => `===== ${b.label} =====\n${b.text}`).join('\n\n');
    const summary = `[采集汇总: ${blocks.length} 个板块 / 共 ${rawPreview.length} 字符 / 已剔除base64等噪声 ${blocks.noiseRemoved} 字符 | 各板块完整，除非板块内标注了截断 | 预览显示上限 200000 字符]\n\n`;
    $('rawPreview').textContent = summary + rawPreview.slice(0, 200000)
      + (rawPreview.length > 200000 ? `\n…（预览已截断，实际采集 ${rawPreview.length} 字符）` : '');
    $('rawDetails').classList.remove('hidden');

    // 5. 分块
    const chunks = chunkBlocks(blocks, settings.chunkSize || 20000);
    $('progressTitle').textContent = `AI 分析中（共 ${chunks.length} 块）…`;
    const list = $('chunkList');
    list.innerHTML = '';
    chunks.forEach((c, i) => {
      const li = document.createElement('li');
      li.id = 'chunk-' + i;
      li.textContent = `块 ${i + 1}`;
      list.appendChild(li);
    });

    // 6. 串行分析（滚动上下文）：放弃并发，每块提示词附带前一块的分析结论摘要，
    // 让模型做跨块关联（数据流/调用链/凭据使用点）。代价是 N 块变 N 倍串行耗时。
    const ruleSummaries = buildRuleSummariesPerChunk(ruleFindings, chunks);
    const results = new Array(chunks.length).fill(null);
    const chunkErrors = [];
    const failedDumps = [];
    const chunkSummaries = [];   // chunkSummaries[i] = 第 i 块分析结论的紧凑摘要，供第 i+1 块参考
    let doneCount = 0;

    // 将单块分析结果压成紧凑摘要（限 3000 字符），作为下一块的滚动上下文
    function summarizeResult(parsed) {
      if (!parsed || typeof parsed !== 'object') return '';
      const lines = [];
      const cat = (label, arr, fmt) => {
        if (!Array.isArray(arr) || !arr.length) return;
        lines.push(`【${label}】`);
        for (const it of arr.slice(0, 15)) {
          if (it && typeof it === 'object') lines.push('- ' + fmt(it));
        }
        const more = arr.length - Math.min(15, arr.length);
        if (more > 0) lines.push(`-（另有 ${more} 条同类发现，略）`);
      };
      cat('敏感信息', parsed.sensitive, it => `${it.type || '未知'}: ${String(it.value || '').slice(0, 60)}`);
      cat('API接口', parsed.apis, it => `${it.method || '未知'} ${it.url || ''}`);
      cat('指纹', parsed.fingerprints, it => `${it.name || ''}${it.version ? ' v' + it.version : ''}（${it.category || ''}）`);
      cat('漏洞线索', parsed.vulns, it => `${it.type || '未知'}: ${String(it.desc || '').slice(0, 80)}`);
      return lines.slice(0, 80).join('\n').slice(0, 3000);
    }

    const run = async (userMsgContent) => {
      const text = await callAI(settings, [
        { role: 'system', content: (settings.customPrompt ? settings.customPrompt + '\n\n' : '') + BUILTIN_PROMPT },
        { role: 'user', content: userMsgContent }
      ]);
      const parsed = extractJSON(text);
      if (!parsed) throw new Error('返回内容无法解析为 JSON');
      return parsed;
    };

    // 单块分析：上下文超限（400 request_invalid_parameter 等）时自动对半拆分递归重试，
    // 避免分块大小配错（如 500000 字符单块超模型窗口）导致整轮失败
    const MIN_SPLIT_CHARS = 16000; // 低于此长度还报超限，说明问题不在长度，不再拆
    const analyzeChunk = async (chunk, summary, idx, total, depth, prevSummary) => {
      const userMsgPlain = chunkToPrompt(chunk, idx, total, page.url)
        + (summary ? `\n\n本地规则预筛命中项（请确认或剔除误报）:\n${obfuscateForWaf(summary)}` : '')
        + (prevSummary ? `\n\n【前序片段分析结论】\n${prevSummary}\n
以上是同一页面之前片段已得出的发现，仅作跨片段关联参考：请勿重复报告相同内容；若本片段代码与前序发现存在关联（如变量来源、数据流、调用链、凭据使用点），请在本片段对应发现的 desc/evidence 中注明「与前序片段关联」及具体关系；若发现前序结论与本片段代码矛盾，请指出。`
        : '');
      try {
        return await run(userMsgPlain);
      } catch (e) {
        const msg = String(e.message || e);
        const chunkLen = chunk.reduce((s, b) => s + b.text.length, 0);
        if (isContextOverflow(msg) && chunkLen > MIN_SPLIT_CHARS && depth < 4) {
          const halves = splitChunk(chunk);
          const halfSums = buildRuleSummariesPerChunk(ruleFindings, halves);
          const parts = [];
          for (let h = 0; h < halves.length; h++) {
            parts.push(await analyzeChunk(halves[h], halfSums[h], idx, total, depth + 1, prevSummary));
          }
          return mergeFindings(parts);
        }
        // 原有重试阶梯：WAF 拦截走 Base64 编码重试，普通失败原样重试
        if (isWafBlock(msg)) {
          try {
            return await run(encodeUserMsg(userMsgPlain, page.url) + '\n（严格只输出 JSON）');
          } catch (e2) { e2.failedMsg = userMsgPlain; throw e2; }
        }
        try {
          return await run(userMsgPlain + '\n\n（注意：严格只输出 JSON）');
        } catch (e2) { e2.failedMsg = userMsgPlain; throw e2; }
      }
    };

    // 串行主循环：第 i 块携带第 i-1 块的结论摘要
    for (let i = 0; i < chunks.length; i++) {
      const li = $('chunk-' + i);
      li.className = 'running';
      $('progressBar').style.width = (10 + 85 * doneCount / chunks.length) + '%';
      $('statusText').textContent = `串行分析中（滚动上下文）${i > 0 ? '，已携带前 ' + i + ' 块结论' : ''}`;
      const prevSummary = chunkSummaries[i - 1] || '';
      try {
        results[i] = await analyzeChunk(chunks[i], ruleSummaries[i], i, chunks.length, 0, prevSummary);
        li.className = 'done';
        chunkSummaries[i] = summarizeResult(results[i]);
      } catch (e1) {
        // analyzeChunk 内部已做过超限拆分与一轮重试，到这里说明确实失败
        const msg1 = String(e1.message || e1);
        try {
          // 最后一次机会：明文再试一次（对偶发性网络/解析失败兜底）
          results[i] = await analyzeChunk(chunks[i], ruleSummaries[i], i, chunks.length, 4, prevSummary);
          li.className = 'done';
          chunkSummaries[i] = summarizeResult(results[i]);
        } catch (e3) {
          const msg3 = String(e3.message || e3);
          li.className = 'failed';
          li.title = msg3.slice(0, 300);
          const hint = isContextOverflow(msg3) ? ' [输入超出模型上下文（已自动二分重试仍失败），建议调小「分块大小」或减小「最大采集内容」]' : '';
          chunkErrors.push(`块 ${i + 1}: ${msg3.slice(0, 300)}${hint}${isWafBlock(msg3) ? ' [疑似WAF内容拦截，即使编码重试也未成功]' : ''}`);
          // 保存最终发送的失败请求原文，供「导出失败块请求内容」离线排查
          failedDumps.push({ chunk: i + 1, msg: String(e3.failedMsg || '') });
          // 失败块不产生摘要，滚动链在此断开（预期降级：后续块退回无前序上下文模式）
        }
      }
      doneCount++;
      $('progressBar').style.width = (10 + 85 * doneCount / chunks.length) + '%';
      $('statusText').textContent = `已完成 ${doneCount}/${chunks.length} 块`;
    }

    // 7. 合并渲染（全部失败则直接报错，不再渲染空报告）
    if (chunkErrors.length === chunks.length) {
      showError(`所有 ${chunks.length} 个分块的 AI 分析全部失败。最后一条错误：${chunkErrors[chunkErrors.length - 1]}。请检查「⚙ 设置」中的接口地址（当前: ${settings.mode === 'ollama' ? 'Ollama' : 'OpenAI兼容'} ${settings.baseUrl}）与模型名（当前: ${settings.model}），并点「测试连接」排查。`);
      return;
    }
    const merged = mergeFindings(results);
    const meta = {
      url: page.url, title: page.title,
      model: settings.model, elapsed: ((Date.now() - t0) / 1000).toFixed(1)
    };
    renderReport(merged, meta);
    if (chunkErrors.length) {
      $('failCount').textContent = chunkErrors.length;
      $('failList').innerHTML = chunkErrors.map((e, k) => {
        const dump = failedDumps.find(d => d.chunk === k + 1 && d.msg);
        return `<li>${esc(e)}${dump ? ` <button class="dump-btn" data-dump="${k}" style="margin-left:8px;padding:2px 10px;cursor:pointer;">导出失败块请求内容</button>` : ''}</li>`;
      }).join('');
      $('failCard').classList.remove('hidden');
    } else {
      $('failCard').classList.add('hidden');
    }
    LAST_REPORT = merged; LAST_META = meta; LAST_FAILED_DUMPS = failedDumps;
    $('progressCard').classList.add('hidden');
    $('btnExportMd').disabled = false;
    $('btnExportJson').disabled = false;
  } catch (e) {
    showError(String(e.message || e));
  } finally {
    $('btnReanalyze').disabled = false;
  }
}

// ---------- 初始化 ----------
async function init() {
  CURRENT_SETTINGS = await loadSettings();
  fillSettingsForm(CURRENT_SETTINGS);

  // 失败块导出：点击后把最终发送的请求内容下载为 txt，供离线重放排查 400 触发源
  $('failList').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-dump]');
    if (!btn) return;
    const dump = LAST_FAILED_DUMPS[Number(btn.dataset.dump)];
    if (!dump || !dump.msg) return;
    const blob = new Blob([dump.msg], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `failed-chunk-${dump.chunk}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const params = new URLSearchParams(location.search);
  const err = params.get('error');
  if (err === 'unsupported-page') {
    showError('当前页面不是 http/https 页面（如 chrome:// 内部页），无法分析。请切换到目标网页后点击扩展图标。');
    return;
  }
  const tabId = Number(params.get('tabId'));
  if (!tabId) {
    showError('未指定目标标签页。请回到目标网页后点击扩展图标重新打开。');
    return;
  }
  try {
    const tab = await chrome.tabs.get(tabId);
    $('targetInfo').textContent = (tab.title || '') + ' — ' + (tab.url || '');
  } catch (e) {
    showError('目标标签页不存在或已关闭。');
    return;
  }
  analyzeTab(tabId);
}

// ---------- 设置表单 ----------
function fillSettingsForm(s) {
  $('setMode').value = s.mode;
  $('setBaseUrl').value = s.baseUrl;
  $('setApiKey').value = s.apiKey;
  $('setModel').value = s.model;
  $('setTemp').value = s.temperature;
  $('setChunkSize').value = s.chunkSize;
  $('setMaxKb').value = s.maxKb;
  $('setSkipLibs').checked = s.skipKnownLibs !== false;
  $('setSkipIncomplete').checked = s.skipIncompleteScripts !== false;
  $('setNumCtx').value = s.numCtx || 32768;
  $('setNumPredict').value = s.numPredict || 8192;
  $('setCustomPrompt').value = s.customPrompt || '';
}

function readSettingsForm() {
  return {
    mode: $('setMode').value,
    baseUrl: $('setBaseUrl').value.trim() || DEFAULTS.baseUrl,
    apiKey: $('setApiKey').value.trim(),
    model: $('setModel').value.trim() || DEFAULTS.model,
  temperature: Number($('setTemp').value) || 0.2,
  chunkSize: Number($('setChunkSize').value) || 20000,
  maxKb: Number($('setMaxKb').value) || 150,
  skipKnownLibs: $('setSkipLibs').checked,    skipIncompleteScripts: $('setSkipIncomplete').checked,
    numCtx: Number($('setNumCtx').value) || 32768,
    numPredict: Number($('setNumPredict').value) || 8192,
    customPrompt: $('setCustomPrompt').value.trim()
  };
}

// ---------- 事件绑定 ----------
$('btnSettings').addEventListener('click', () => $('settingsPanel').classList.toggle('hidden'));
$('btnSaveSettings').addEventListener('click', async () => {
  CURRENT_SETTINGS = readSettingsForm();
  await saveSettings(CURRENT_SETTINGS);
  $('btnSettings').textContent = '⚙ 设置 ✓';
  setTimeout(() => $('btnSettings').textContent = '⚙ 设置', 1200);
});
$('btnTestConn').addEventListener('click', async () => {
  const el = $('testResult');
  el.className = ''; el.textContent = '测试中…';
  try {
    const s = readSettingsForm();
    const data = await testConnection(s);
    let names = [];
    if (s.mode === 'ollama' && data.models) names = data.models.map(m => m.name || m.model);
    else if (data.data) names = data.data.map(m => m.id);
    el.className = 'ok';
    el.textContent = `连接成功${names.length ? '，可用模型: ' + names.slice(0, 5).join(', ') : ''}`;
  } catch (e) {
    el.className = 'fail';
    el.textContent = '连接失败: ' + String(e.message || e);
  }
});
$('btnFetchModels').addEventListener('click', async () => {
  try {
    const s = readSettingsForm();
    const data = await testConnection(s);
    let names = [];
    if (s.mode === 'ollama' && data.models) names = data.models.map(m => m.name || m.model);
    else if (data.data) names = data.data.map(m => m.id);
    const sel = $('modelList');
    sel.innerHTML = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    sel.classList.toggle('hidden', !names.length);
    if (names.length) {
      sel.onchange = () => { $('setModel').value = sel.value; };
    }
  } catch (e) {
    $('testResult').className = 'fail';
    $('testResult').textContent = '获取模型列表失败: ' + String(e.message || e);
  }
});
$('setMode').addEventListener('change', () => {
  const mode = $('setMode').value;
  $('setBaseUrl').placeholder = mode === 'ollama'
    ? 'http://localhost:11434'
    : 'https://api.deepseek.com/v1';
});
$('btnReanalyze').addEventListener('click', () => {
  const params = new URLSearchParams(location.search);
  const tabId = Number(params.get('tabId'));
  if (tabId) analyzeTab(tabId);
});
$('btnExportMd').addEventListener('click', () => {
  if (!LAST_REPORT) return;
  download(`security-report-${Date.now()}.md`, buildMarkdown(LAST_REPORT, LAST_META), 'text/markdown;charset=utf-8');
});
$('btnExportJson').addEventListener('click', () => {
  if (!LAST_REPORT) return;
  download(`security-report-${Date.now()}.json`, JSON.stringify({ meta: LAST_META, findings: LAST_REPORT }, null, 2), 'application/json');
});

init();
