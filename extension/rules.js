// rules.js - 本地正则预筛引擎（FindSomething / ReconLens 风格）
// 在送 AI 之前先做本地规则匹配，产出候选线索，随原文一起交给 AI 确认与深挖

const RULES = {
  sensitive: [
    { type: 'JWT', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g },
    { type: 'AWS AccessKey', re: /AKIA[0-9A-Z]{16}/g },
    { type: '阿里云 AccessKey', re: /LTAI[0-9A-Za-z]{12,30}/g },
    { type: '腾讯云 SecretId', re: /AKID[0-9A-Za-z]{13,40}/g },
    { type: 'Google API Key', re: /AIza[0-9A-Za-z_-]{35}/g },
    { type: '私钥块', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/g },
    { type: '通用 Secret/Token 赋值', re: /(?:secret|token|api[-_]?key|apikey|access[-_]?key|password|passwd|pwd|authorization)\s*[:=]\s*['"][^'"]{6,}['"]/gi },
    { type: '数据库连接串', re: /(?:mongodb(?:\+srv)?|mysql|postgres(?:ql)?|jdbc:[a-z]+|redis|mssql):\/\/[^\s'"<>]{8,}/gi },
    { type: '邮箱', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
    { type: '身份证号', re: /[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]/g },
    { type: '手机号', re: /(?:^|[^\d])1[3-9]\d{9}(?=[^\d]|$)/g },
    { type: '内网 IP', re: /(?:^|[^\d.])((?:10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})(?=[^\d.]|$)/g },
    { type: '公网 IP', re: /(?:^|[^\d.])((?:[1-9]|[1-9]\d|1\d{2}|2[0-4]\d|25[0-5])\.(?:\d{1,3})\.(?:\d{1,3})\.(?:\d{1,3}))(?=[^\d.]|$)/g },
    { type: 'Base64 疑似凭据', re: /(?:Basic|Bearer)\s+[A-Za-z0-9+/=]{20,}/g },
    { type: '云存储 Bucket', re: /(?:oss|cos|obs|s3)[.\-][a-z0-9\-]+\.aliyuncs\.com|\.oss-[\w-]+\.aliyuncs\.com|\.cos\.[\w-]+\.myqcloud\.com|\.s3[.\-][\w-]*\.amazonaws\.com/gi },
  ],
  api: [
    { type: 'API 路径', re: /["'`](\/(?:api|v[0-9]|rest|graphql|rpc|service|gateway|open|admin)\/[A-Za-z0-9_\-./${}]{2,80})["'`]/g },
    // 业务路径（FindSomething PATH 风格）：引号包裹的 ≥2 段路径，每段字母开头——
    // 覆盖 /member/login、/memberCenter/balanceAbility 等业务前缀接口与前端路由（含 /:id 占位）
    { type: '业务路径',
      re: /["'`](\/[:A-Za-z][\w:\-]*(?:\/[:A-Za-z][\w:\-]*)+)(?:\?[^"'`]*)?["'`]/g,
      cap: 120,
      exclude: /\.(?:js|mjs|css|png|jpe?g|gif|svg|ico|webp|bmp|woff2?|ttf|eot|otf|mp[34]|webm|wav|m4a|pdf|docx?|xlsx?|pptx?|zip|gz|map|html?)$/i },
    { type: '完整 URL 接口', re: /https?:\/\/[A-Za-z0-9._\-]+(?::\d{2,5})?(?:\/[A-Za-z0-9_\-./?%&=]*)?/g, cap: 60 },
    { type: 'fetch/axios 调用', re: /(?:fetch|axios(?:\.(?:get|post|put|delete|patch))?)\s*\(\s*["'`]([^"'`]+)["'`]/g },
    { type: 'ajax 请求', re: /(?:\$\.ajax|\$\.get|\$\.post|XMLHttpRequest[^;]{0,40}open)\s*\([^)]{0,200}/g },
    { type: 'WebSocket', re: /wss?:\/\/[A-Za-z0-9._:\-\/]+/g },
    { type: 'GraphQL', re: /graphql(?:\/query|\/mutation|\/schema)?/gi },
  ],
  fingerprint: [
    { type: '前端框架', re: /(?:Vue|React|Angular|Nuxt|Next\.js|Svelte|Backbone|Ember)/g },
    { type: '打包工具特征', re: /webpackChunk|__NEXT_DATA__|__NUXT__|window\.__POWERED_BY_QIANKUN__|VITE_[A-Z_]+/g },
    { type: 'UI 组件库', re: /element-ui|element-plus|ant-design|antd|arco-design|naive-ui|vuetify|layui|bootstrap/gi },
    { type: 'jQuery/工具库', re: /jQuery v[\d.]+|jquery\.min\.js|lodash|moment(?:\.min)?\.js|axios/gi },
    { type: '后端框架特征', re: /X-Powered-By|Spring|Shiro|ThinkPHP|Laravel|Django|Flask|Express|Koa|Gin|Beego|Struts|RuoYi|JeecgBoot/gi },
    { type: 'Server 头', re: /(?:Server|X-Powered-By)\s*:\s*[^\r\n]+/gi },
    { type: '统计/安全组件', re: /baidu-analytics|baidu hm\.js|google-analytics|gtag|cnzz|sensorsdata|growingio|sentry|umeng|matomo/gi },
    { type: 'CMS 特征', re: /wp-content|wp-includes|Joomla|Drupal|Discuz|DedeCMS|phpcms|帝国CMS|empirecms|ecshop|shopex|wordpress/gi },
    { type: '地图/开放平台', re: /amap|baidu-map|qq\.com\/maps|mapbox|weixin jssdk|wx\.config|jsapi/gi },
  ],
  vulnHint: [
    { type: '危险函数 eval', re: /\beval\s*\(\s*[^)]{0,120}/g },
    { type: '危险函数 Function', re: /new\s+Function\s*\(/g },
    { type: 'innerHTML/outerHTML 写入', re: /\.(?:inner|outer)HTML\s*=\s*[^=][^;\n]{0,120}/g },
    { type: 'document.write', re: /document\.write(?:ln)?\s*\(/g },
    { type: 'postMessage 无 origin 校验', re: /addEventListener\s*\(\s*["']message["'][^)]{0,200}/g },
    { type: 'window.open 拼接参数', re: /window\.open\s*\(\s*[^)]{0,150}/g },
    { type: 'src/href 属性拼接', re: /\.(?:src|href|action)\s*=\s*[^=][^;\n]{0,120}/g },
    { type: '调试后门特征', re: /vconsole|eruda|debugger\b|console\.log\s*\(\s*["'][^"']*(?:token|password|secret)/gi },
    { type: 'CORS 通配', re: /Access-Control-Allow-Origin\s*:\s*\*/gi },
    { type: 'sourcemap 泄露', re: /sourceMappingURL\s*=\s*[^'\s"]+\.map/g },
  ]
};

// 对文本跑规则，返回 {ruleType: [命中片段...]}，每个片段带上下文
// rule 可选字段：cap（本条规则的命中上限，默认 maxPerRule）、exclude（命中值命中此正则则丢弃，如静态资源后缀）
function runRules(text, categories, maxPerRule = 12) {
  const out = [];
  for (const cat of categories) {
    for (const rule of RULES[cat]) {
      const re = new RegExp(rule.re.source, rule.re.flags);
      const cap = rule.cap || maxPerRule;
      let m, count = 0;
      while ((m = re.exec(text)) !== null && count < cap) {
        const hit = m[1] !== undefined && m[0].includes(m[1]) ? m[1] : m[0];
        if (rule.exclude && rule.exclude.test(hit)) {
          if (m.index === re.lastIndex) re.lastIndex++; // 防零宽死循环
          continue;
        }
        const start = Math.max(0, m.index - 60);
        const end = Math.min(text.length, m.index + hit.length + 60);
        out.push({
          category: cat,
          rule: rule.type,
          value: hit.slice(0, 200),
          context: text.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 260)
        });
        count++;
        if (m.index === re.lastIndex) re.lastIndex++; // 防零宽死循环
      }
    }
  }
  // 去重（同 value+rule 只保留一条）
  const seen = new Set();
  return out.filter(r => {
    const k = r.rule + '|' + r.value;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
