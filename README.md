# AI 页面安全分析器（Chrome 扩展）

点击扩展图标 → 新开标签页，自动抓取当前网页的 HTML / 内联 JS / 外链 JS / 响应头 / Cookie / 表单 / 注释，
先经**本地正则预筛引擎**提取候选线索，再交给 **AI**（OpenAI 兼容接口或 Ollama 本地模型）分块并发分析，产出：

- 🔐 敏感信息（密钥、Token、密码、内网 IP、JWT、身份证/手机号等）
- 🧩 API 接口（URL / 路径 / 方法 / fetch·axios 调用 / WebSocket / GraphQL）
- 🌐 Web 指纹（前后端框架、打包工具、UI 库、CMS、服务器、统计组件）
- 🐛 漏洞分析（DOM XSS sink、postMessage 无校验、CORS 过宽、sourcemap 泄露等，含修复建议）

支持导出 Markdown / JSON 报告。

## 安装

1. 打开 `chrome://extensions/`，开启右上角「开发者模式」
2. 「加载已解压的扩展程序」→ 选择本 `extension` 目录
3. 打开目标网页，点击扩展图标即自动打开分析页并开始分析

## AI 接口配置

点击分析页右上角「⚙ 设置」：

| 字段 | 说明 |
|---|---|
| 接口类型 | `Ollama 本地模型` 或 `OpenAI 兼容接口`（DeepSeek/通义/Kimi/中转站等） |
| 接口地址 | Ollama 默认 `http://localhost:11434`；OpenAI 兼容填到 `/v1`，如 `https://api.deepseek.com/v1` |
| API Key | Ollama 留空 |
| 模型 | 可点「获取模型列表」自动拉取 |
| Ollama num_ctx / num_predict | 上下文长度与最大生成长度。**Ollama 默认 num_ctx 仅 4096，长 prompt 会被静默截断**，建议保持 32768/8192 |

配置要点（针对本地小模型）：
- **分块大小**默认 20000 字符/块，Ollama 长上下文模型可调大
- **并发数**默认 2，本地模型建议 1~2，云端可调到 4+
- **最大采集内容**默认 150KB，页面 JS 很多时可调大
- **外链脚本只采集主域名相关**（同主机/同根域），自动跳过 CDN、统计等第三方脚本
- 支持自定义系统提示词（追加分析侧重点）

## 设计借鉴的开源项目

- [in-browser-sec-audit](https://github.com/brianhama/in-browser-sec-audit) —— 分块并发、可配置接口、报告导出
- [FindSomething](https://github.com/momosecurity/FindSomething) / [ReconLens](https://github.com/fr0stb1rd/ReconLens) —— 本地正则预筛思路（敏感信息/API/指纹规则）
- [superSearchPlus](https://github.com/dark-kingA/superSearchPlus) —— 敏感信息+指纹聚合输出形态

## 许可证

本项目基于 **GPL-3.0** 协议开源（见 `LICENSE`）。

> ⚠️ 传染性开源要求：任何基于本代码修改、二次开发的衍生作品，分发时**必须同样以 GPL-3.0 协议开源**并保留原始版权声明；闭源商用不被允许。详见 [GPL-3.0 全文](https://www.gnu.org/licenses/gpl-3.0.html)。

## 权限说明

- `activeTab` + `scripting`：仅在点击图标后注入采集脚本
- `webRequest`：读取目标页响应头用于指纹识别
- `host_permissions: <all_urls>`：拉取外链 JS、调用你配置的 AI 接口
- 页面内容只发送给你自己配置的 AI 接口，无其他第三方上报

> ⚠️ 仅用于授权范围内的安全测试。
