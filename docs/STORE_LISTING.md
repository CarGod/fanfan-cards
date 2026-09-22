# 翻翻词卡 · Chrome 应用商店上架材料

提交前逐项核对。控制台里的字段与这里一一对应，**不要在控制台里临时编**——
权限说明和隐私政策一旦对不上，就是重新排队重审。

隐私政策：[`PRIVACY.md`](PRIVACY.md) · 公开地址：<https://luffyliu.com/fanfan-cards/privacy/>

---

## 一、商品详情

### 名称（45 字符内）

| 语言 | 文案 | 长度 |
|---|---|---|
| 简体中文 | 翻翻词卡：AI 语境划词 · 生词本 | 15 |
| English | FanFan Cards — AI Context Lookup & Vocab | 40 |

与 `public/_locales/*/messages.json` 里的 `extName` 保持一致。改一处要改两处。

### 简短描述（132 字符内，商店列表里唯一会被读到的一句）

**简体中文**（58 字）

> 在英文网页上划词，AI 解释它在这句里的意思；收进生词本，查过的词下次在别的网页会自己亮起来。翻译免费，语境解释需自己的 AI Key。

**English**（131 字符）

> Look up a word, see what it means in this sentence. Saved words light up next time. Translation free; context needs your AI key.

### 详细描述

**简体中文**

> 翻翻词卡把你每天真实读到的英文，变成你自己的词汇资产。
>
> **划词就懂。** 选中一个词，AI 结合它所在的这句话给出解释——不是词典里那条最常见的义项，
> 而是它在这里到底什么意思。「lock a table for minutes」里的 lock 不是「锁」。
>
> **查过的词，下次自己亮起来。** 打开翻翻模式，生词本里的词会在任何网页上被轻轻标出来；
> 点一下直接看已经保存的释义、原句和例句，不再调用 AI，也不产生新的费用。
>
> **收进生词本，带着原句复习。** 收藏时连同它出现的那句话和网址一起存下来——
> 脱离语境的单词表是背不下来的。复习按间隔重复排期。
>
> **也能翻译。** 悬停加一个键翻译这一段，一个快捷键翻译整页，YouTube 播放器里有双语字幕。
> 译文追加在原文下面，不替换、不打乱排版。
>
> **翻译免费，语境解释要你自己的 AI Key。** 不配 Key 时走谷歌翻译接口：词典义、整页和字幕翻译都能用，
> 只是没有「这句里指什么」。要语境解释，填一个 DeepSeek、Claude、OpenAI、Gemini 或任何 OpenAI 兼容接口的 Key；
> 按每天查 30 个词算，用 DeepSeek 一个月大约 7–12 元（估算）。
>
> **数据是你的。** 词卡只存在你自己的浏览器里；设置和 API Key 默认随你的 Chrome 账号同步，
> 可以在设置里改成仅本机。开发者没有服务器，收不到你的任何数据。想备份和跨设备，
> 可以把词卡同步到**你自己的 GitHub 私有仓库**，存成人能读的 Markdown。
>
> 开源：https://github.com/CarGod/fanfan-cards

**English**

> FanFan Cards turns the English you actually read every day into vocabulary you own.
>
> **Select a word, understand it here.** The AI explains a word in the sentence it appears in —
> not the most common dictionary sense, but what it means *right here*. The "lock" in
> "lock a table for minutes" is not a padlock.
>
> **Words you looked up light up next time.** Turn on FanFan mode and words from your notebook
> are marked wherever they appear. Click one to revisit the stored meaning, sentence and
> examples — no additional AI call, no additional cost.
>
> **Save to your notebook, review with the sentence.** Every saved word keeps the sentence and
> the page it came from — word lists stripped of context do not stick. Reviews are scheduled
> by spaced repetition.
>
> **Translation too.** Hover and hold one key for a paragraph, one shortcut for the page,
> bilingual subtitles on YouTube. Translations are appended below the original.
>
> **Translation is free; context needs your own AI key.** Without a key, lookups and
> translation go through Google Translate: dictionary senses, page and subtitle translation,
> just no "what it means here". For that, add a key from DeepSeek, Claude, OpenAI, Gemini,
> or any OpenAI-compatible endpoint.
>
> **Your data stays yours.** Cards live only in your own browser; settings and API keys sync
> with your Chrome account by default and can be kept local-only. There is no server behind
> this extension; the developer receives nothing. For backup and multi-device use, sync to
> **your own private GitHub repository**, stored as Markdown a human can read.
>
> Open source: https://github.com/CarGod/fanfan-cards

---

## 二、单一用途说明

> 帮助用户在网页与视频上阅读英文：解释所选词句、翻译段落与页面，并把生词保存为词卡供复习。

写给审核看的展开版：

> The extension has one purpose: helping a reader understand English they encounter while
> browsing. Every feature serves that single purpose — selecting a word to get a
> context-aware explanation, translating a paragraph or a page, reading bilingual subtitles
> on a video, and saving what was looked up into cards for later review. Saving and review
> are not a separate product; they are what makes a lookup worth doing more than once.

**这一条是最常见的拒审理由**，所以句子里的每一项功能都要能收进同一个目的。
把「复习」讲成一个独立的记忆工具，就会被判成两个用途。

---

## 三、逐项权限说明

控制台会**逐项**要求解释。以下与 `public/manifest.json` 一一对应。

| 权限 | 说明 |
|---|---|
| `storage` | 保存用户的词卡、复习记录、设置与 API Key。本机保存，并可将配置和密钥写入浏览器同步空间。 |
| `unlimitedStorage` | 词卡与翻译缓存会随长期使用增长，5MB 的默认配额会在重度用户那里被用满，导致保存失败。 |
| `contextMenus` | 提供「解释选中的英文」右键菜单项，作为划词以外的第二条入口。 |
| `activeTab` | 用户点击工具栏图标或按下快捷键时，对**当前这一个**标签页执行整页翻译。 |
| `alarms` | 为可选的每日复习提醒排期，以及为 GitHub 同步和配置恢复自动重试排期。 |
| `notifications` | 用户开启每日提醒后，在设定时间发出一条「有卡片待复习」的通知。默认关闭。 |
| 内容脚本 `http://*/*`、`https://*/*` | 划词解释与整页翻译的作用对象就是「用户正在读的任意网页」——无法预先枚举域名。脚本只注入 UI，**不主动读取页面内容**：只有在用户划词、按下整段翻译键或触发整页翻译时才读取相应文本。用户可以在弹窗里按站点关闭，也可以全局关闭。 |
| 内容脚本 `youtube.com`（`world: "MAIN"`） | 双语字幕功能需要读取播放器公开的字幕轨信息，并取得播放器为字幕请求生成的一次性校验参数——这些只存在于页面自身的 JavaScript 上下文中，隔离世界读不到。该脚本不访问任何扩展 API，只做这一件事。详见隐私政策。 |
| `host_permissions`：`api.anthropic.com`、`api.openai.com`、`api.deepseek.com`、`generativelanguage.googleapis.com` | 直接把解释与翻译请求发给用户选定的 AI 服务商。不经过任何中转服务器，因此必须直连这些域名。 |
| `host_permissions`：`translate.googleapis.com` | 不配 Key 时的默认后端：把选中的词、所在句子、被翻译的段落和字幕发给谷歌翻译接口。同样不经中转。 |
| `host_permissions`：`api.github.com` | 用户主动启用 GitHub 同步后，把词卡写入**用户自己的**仓库。 |
| `optional_host_permissions`：`https://*/*` | 仅用于用户自行填写的 OpenAI 兼容 API 地址。**不预先申请**：用户在设置页点击「测试连接」时，才按其填写的那个域名单独请求授权。 |
| `optional_host_permissions`：`http://localhost/*` | 支持把本机运行的模型服务（Ollama、LM Studio 等）作为服务商。同样按需申请。 |

> 广泛主机权限与全站内容脚本会让审核明显变慢，这是正常的，**不要重复提交**。

---

## 四、数据用途声明（控制台逐条勾选）

必须与 [`PRIVACY.md`](PRIVACY.md) 完全一致。

| 类别 | 是否收集 | 说明 |
|---|---|---|
| 个人身份信息 | 否 | |
| 健康信息 | 否 | |
| 财务和付款信息 | 否 | |
| 身份验证信息 | **是** | 用户自填的 AI API Key 与 GitHub Token，用于连接对应服务商；还可经浏览器账号同步或导出到用户选择的配置文件。开发者不接收。 |
| 个人通信内容 | 否 | |
| 位置 | 否 | |
| 网络历史记录 | **是** | 不记录浏览历史。只在用户主动划词 / 翻译时读取当前页的网址和标题，作为词卡的来源信息保存在用户本地。 |
| 用户活动 | **是** | 不做分析或追踪。「三击空格翻译」需要监听输入框里的按键，只判断是否连续按了三次空格，不记录输入内容。复习记录属于用户自己的学习数据，只存在本地或其自有仓库。 |
| 网站内容 | **是** | 用户主动划选的文字、其上下文、页面标题与网址、被翻译的页面文本、YouTube 字幕文本。 |

三项声明全部勾选：

- [ ] 不将数据出售给第三方（不属于经批准的用例）
- [ ] 不将数据用于与本扩展单一用途无关的目的
- [ ] 不将数据用于判定信用等级或放贷目的

---

## 五、素材

| 素材 | 要求 | 状态 |
|---|---|---|
| 图标 | 128×128 PNG | ✅ `public/icons/icon-128.png` |
| 中文商店截图 | 5 张，全部 1280×800 | ✅ 见下表中文列 |
| 英文商店截图 | 5 张，全部 1280×800 | ✅ 见下表英文列；英文说明带与界面标签，保留中文学习释义 |
| 中文小宣传图 | 440×280 PNG | ✅ [promo-440x280.png](screenshots/promo-440x280.png) |
| 中文大宣传图 | 1400×560 PNG | ✅ [promo-1400x560.png](screenshots/promo-1400x560.png) |
| 英文小宣传图 | 440×280 PNG | ✅ [promo-440x280-en.png](screenshots/promo-440x280-en.png) |
| 真实扩展演示 | ≤30 秒，GIF ≤4 MB，另留 MP4 | ✅ 20.92 秒 / GIF 约 731 KiB：[GIF](screenshots/demo-degrade.gif) · [MP4](screenshots/demo-degrade.mp4) |

| # | 内容 | 中文 | English |
|---|---|---|---|
| 1 | 语境划词 | [shot-1-context.png](screenshots/shot-1-context.png) | [shot-1-context-en.png](screenshots/shot-1-context-en.png) |
| 2 | 收藏词高亮 | [shot-2-fanfan.png](screenshots/shot-2-fanfan.png) | [shot-2-fanfan-en.png](screenshots/shot-2-fanfan-en.png) |
| 3 | 本地回看 | [shot-3-revisit.png](screenshots/shot-3-revisit.png) | [shot-3-revisit-en.png](screenshots/shot-3-revisit-en.png) |
| 4 | 原句复习与四级评分 | [shot-4-review.png](screenshots/shot-4-review.png) | [shot-4-review-en.png](screenshots/shot-4-review-en.png) |
| 5 | YouTube 双语字幕 | [shot-5-youtube.png](screenshots/shot-5-youtube.png) | [shot-5-youtube-en.png](screenshots/shot-5-youtube-en.png) |

静态截图使用真实产品组件与预览示例数据；YouTube 背景为预览场景。视频使用已安装扩展，来源与拍摄参数单独记录。

---

## 六、提交前待办

- [x] 隐私政策发布为公开可访问 URL：<https://luffyliu.com/fanfan-cards/privacy/>
- [x] 补一张 YouTube 双语字幕的 1280×800 截图：`docs/screenshots/shot-5-youtube.png`
- [x] 开发者账号注册与验证（一次性，5 美元，需两步验证）
- [ ] 商店列表的中英两版文案分别填入对应语言的列表（扩展已带 `_locales`，
      控制台里的商品详情仍需按语言各填一次）
