# 翻翻词卡隐私政策

生效日期：2026 年 8 月 18 日

翻翻词卡是一款本地优先的 Chrome 扩展。开发者不运营用于接收扩展用户数据的服务器，
不使用广告、分析或追踪服务，也不会出售用户数据。

## 扩展处理的数据

为了提供网页英语阅读、语境解释、词卡与复习功能，扩展会处理以下数据：

- **网页内容与浏览信息**：当用户主动划词、解释或翻译时，扩展会读取选中文字、附近句子或段落、
  页面标题和页面网址。整页或整段翻译功能会读取当前页面中可见的文本。
- **学习数据**：收藏的词、解释、来源句子与网址、复习记录、学习活动和用户设置。
- **身份验证信息**：用户自行填写的 AI 服务 API Key，以及在启用 GitHub 同步时填写的 GitHub Token。

上述数据默认保存在用户自己的浏览器 `chrome.storage.local` 中。开发者无法访问这些本地数据。

## 数据何时会发送给第三方

扩展仅在用户启用相应功能后进行以下传输，且全部使用 HTTPS：

1. 用户选择并配置 AI 模型后，选中文字、必要的上下文、页面标题和网址会直接发送给用户选择的
   服务商（Anthropic、OpenAI、DeepSeek、Google Gemini，或用户自行填写的兼容 API 地址），
   用于生成解释或翻译。API Key 只发送给对应服务商。
2. 用户主动启用 GitHub 同步后，词卡、来源信息、复习记录和学习活动会发送到用户自己的 GitHub
   仓库；GitHub Token 只发送给 GitHub API。

开发者不会通过中转服务器接收上述数据。第三方服务如何处理数据，由用户与该服务商之间的条款
和隐私政策约束。

## 数据保留与删除

本地数据会一直保留，直到用户在扩展中清空数据、移除扩展数据或卸载扩展。用户可以随时导出词卡，
也可以在设置页清空缓存或全部词卡。同步到 GitHub 的数据由用户自己的 GitHub 仓库设置与操作决定，
用户可在 GitHub 中删除。

## 安全与最小权限

扩展不加载或执行远程代码。外部请求使用 HTTPS；仅本机开发地址允许 `http://localhost`。
自定义 API 地址的访问权限只在用户点击“测试连接”时按目标域名申请。

扩展对信息的使用遵守 Chrome Web Store User Data Policy（包括 Limited Use 要求）：
The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy,
including the Limited Use requirements.

## 联系方式

如对本政策有疑问，请通过项目的
[GitHub Issues](https://github.com/CarGod/fanfan-cards/issues) 联系开发者。
