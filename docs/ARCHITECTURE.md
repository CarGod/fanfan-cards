# ARCHITECTURE — 技术架构

## 1. 全局视图

```
┌─────────────────────────── 网页（任意 http/https 站点） ──────────────────────────┐
│                                                                                  │
│  content script (IIFE, document_idle)                                            │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │  shadow root  #fanfan-root                                    │  │
│  │  ┌──────────────┐   ┌───────────────┐   ┌──────────────────────────────┐   │  │
│  │  │ selection.ts │──▶│  context.ts   │──▶│  React UI（pill / card）      │   │  │
│  │  │ 读取选区     │   │  抽取句子/段落 │   │  position.ts 纯函数定位       │   │  │
│  │  └──────────────┘   └───────────────┘   └──────────────────────────────┘   │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────┬───────────────────────────────────────────────┘
                                   │ chrome.runtime.sendMessage（类型化信封）
                                   ▼
┌────────────────────────── background service worker (ESM) ───────────────────────┐
│  messaging.registerHandlers                                                      │
│      ├── ai/explain      → 设置 → Provider → 缓存 → 模型 → 结构化解释             │
│      ├── vocab/save      → 词条落库（去重合并）+ 当日活跃计数                      │
│      ├── vocab/lookup    │                                                       │
│      ├── vocab/remove    │                                                       │
│      ├── settings/get    │                                                       │
│      ├── app/open        → 复用已打开的应用标签页                                 │
│      └── options/open                                                            │
│  contextMenus / commands → chrome.tabs.sendMessage → content                      │
└──────────────┬─────────────────────────────────────────┬─────────────────────────┘
               │                                         │ fetch（唯一出网点）
               ▼                                         ▼
      chrome.storage.local                    Anthropic / OpenAI / DeepSeek / Gemini
               ▲
               │ 直接读写 + onChanged 订阅（不经过 background）
┌──────────────┴───────────────────────────────────────────────────────────────────┐
│  扩展页面（ESM）                                                                   │
│  popup（启动器）   options（设置）   app（#/dashboard · #/vocabulary · #/flashcard） │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## 2. 为什么这样分层

### 2.1 只有 content script 走消息通道

Content script 运行在宿主页面里：它拿不到 API Key（拿到也不该拿），也受宿主页 CSP 影响。
所以**所有出网请求都在 service worker 里发生**，content script 只发消息。

扩展页面（popup / options / app）不同：它们是扩展自己的页面，和 service worker 同源同权限。
让它们**直接读写 `chrome.storage`** 而不是绕一圈消息，换来三件事：

1. 少一次往返，列表页首屏更快；
2. 免费获得跨页面实时同步——`chrome.storage.onChanged` 让"在网页上收藏一个词"立刻反映到
   已打开的单词本标签页；
3. service worker 可以随时被杀死而不影响正在浏览单词本的用户。

### 2.2 service worker 是无状态的

MV3 的 worker 大约 30 秒无事件就被回收。因此：

- 所有监听器在模块顶层注册（冷启动时才能收到唤醒它的那个事件）；
- 模块作用域里不放任何"丢了会出错"的状态；唯一的内存态是 `ClaudeProvider.useRefusalFallback`
  这种"丢了只是多一次请求"的降级标记；
- 需要持久化的东西一律进 `chrome.storage`。

### 2.3 两次构建，两种格式

| 产物 | 格式 | 原因 |
|---|---|---|
| `assets/background.js` | ESM | manifest 里声明 `"type": "module"`，可以正常拆 chunk |
| `assets/{popup,options,app}.js` | ESM | 普通扩展页面 |
| `assets/content.js` | **IIFE 单文件** | Chrome 把 content script 当经典脚本加载，不支持 `import` |

所以 `vite.content.config.ts` 单独用 lib 模式 + `inlineDynamicImports`，CSS 用 `?inline`
导入成字符串、注入到 shadow root，不产出独立样式文件。

## 3. 模块职责

| 目录 | 职责 | 不做什么 |
|---|---|---|
| `types/` | 领域模型、设置 schema、消息契约 | 不含逻辑 |
| `shared/` | 无依赖工具：id、归一化、日期、防抖、哈希 | 不碰 chrome API |
| `storage/` | 存储适配层 + 仓储 + 写锁 + 迁移 | 不认识 AI |
| `ai/` | Provider 抽象、prompt、结构化输出、JSON 修复 | 不认识存储 |
| `services/` | 跨层编排：消息、复习、导入导出、朗读 | 不含 UI |
| `sync/` | GitHub 客户端、双向同步、Markdown 渲染 | 不认识 UI，纯数据进出 |
| `background/` | 消息路由与浏览器事件 | 不含业务规则（都在 services / storage） |
| `content/` | 页面内 UI 与 DOM 读取 | 不发起网络请求 |
| `components/` | 共享 UI 原语与 hooks | 不含页面逻辑 |
| `dashboard/ vocabulary/ flashcard/` | 三个学习界面 + 调度算法 | — |

依赖方向严格向下：`pages → services → {storage, ai} → types/shared`。没有反向依赖。

## 4. 关键数据流

### 4.1 划词解释

```
mouseup (capture, debounce 140ms)
  └─ readSelection(maxLen)            过滤：空/过长/无拉丁字母/在输入框内/在自己的 UI 内
       └─ extractContext(range)       向上找文本块 → 计算选区在块内的字符偏移
            │                          → 向两侧扫描到句子边界（带缩写守卫）
            └─ SelectionSnapshot { text, rect, context{ sentence, block, title, url } }
  └─ 按 triggerMode：显示 pill / 直接解释 / 需按住 Alt
       └─ sendMessage('ai/explain', …)
            └─ background: getSettings → resolveProvider → cacheKey → readCache
                 └─ 命中：直接返回（cached: true）
                 └─ 未命中：provider.explainWord() → coerceExplanation() → writeCache
       └─ sendMessage('vocab/lookup') 判断是否已收藏 → 决定底部按钮形态
```

`requestRef` 递增序号保证**乱序返回被丢弃**：用户连续划两个词时，先发的慢响应不会覆盖后发的。

### 4.2 收藏

```
sendMessage('vocab/save', { explanation, source, origin })
  └─ withLock('ara:words')            串行化读-改-写，避免多标签页并发丢词
       └─ 已存在同一 normalized？
            ├─ 是 → 合并（刷新解释，保留 id / review / createdAt）
            └─ 否 → 新建，review = { level 0, dueAt: now }
  └─ bumpActivity(today, { saved: 1 })
  └─ storage.onChanged → 所有打开的扩展页面自动刷新
```

### 4.3 复习

```
buildReviewQueue(entries, { limit, allowAhead })   到期优先，等级升序，同级最过期优先
  └─ 会话开始时快照队列（不随打分变化，否则 "忘记" 的卡会让会话永不结束）
       └─ gradeCard(review, grade, now)            纯函数：等级 → 间隔 → dueAt
            └─ submitReview: 更新词条 + 追加复习日志 + 当日计数
```

## 5. 消息协议

一张类型映射表定义全部请求/响应，编译期两端对齐：

```ts
interface MessageMap {
  'ai/explain':    { req: ExplainWordInput & { forceOffline?: boolean }
                     res: { explanation, providerId, model, offline, cached, downgradeReason? } }
  'vocab/save':    { req: SaveWordPayload; res: { entry, created } }
  'vocab/lookup':  { req: { word: string }; res: { entry: VocabularyEntry | null } }
  'vocab/remove':  { req: { id: string };   res: { removed: boolean } }
  'settings/get':  { req: {};               res: { settings: Settings } }
  'app/open':      { req: { route?: string };res: { opened: true } }
  'options/open':  { req: {};               res: { opened: true } }
  ping:            { req: {};               res: { ok: true; version: string } }
}
```

两个约定：

1. **错误作为数据回传**（`{ ok: false, error: { code, message } }`）。structured clone 会把
   自定义 Error 子类拍平成普通对象，UI 需要的是稳定的 `code` 而不是字符串匹配。
2. 监听器**同步返回 `true`** 保持通道打开，异步结果再 `sendResponse`——这是 MV3 最常见的坑。

反向（background → content）的 `ContentCommand` 是即发即忘的，用于右键菜单和快捷键。

## 6. AI Provider 层

```
                       AIProvider（explainWord / translate / generateExample / summarize）
                                          ▲
        ┌────────────────┬────────────────┼──────────────────┬─────────────────┐
   MockProvider    ClaudeProvider   OpenAICompatible…   GeminiProvider     （未来：本地模型）
   本地词典+启发式   官方 SDK        OpenAI / DeepSeek /   REST + OpenAPI
                    结构化输出+      任意兼容网关         子集 schema
                    拒答回退         json_schema/json_object
```

共享的部分刻意做厚，各家实现刻意做薄：

- `prompts.ts` — 所有 prompt 只有一份。**语境解释的 prompt 就是这个产品本身**，
  不能各家一份互相漂移。
- `schema.ts` — 一份 JSON Schema（发给模型）+ 一份 zod schema（校验/修复回来的东西）。
  另有一份"无 transform 的纯净版" zod，专门喂给需要把 zod 转 JSON Schema 的 SDK。
- `json.ts` — 依次尝试直接解析 / 去代码围栏 / 取第一个配平的 `{...}` / 修复尾逗号。
  结构化输出模式下仍偶尔需要它。
- `http.ts` — 统一超时、`AbortSignal.any` 组合取消、HTTP 状态 → `AIErrorCode` 映射。

`resolveProvider(settings)` 是唯一的工厂，且**永不抛错**：没有 Key、配置有误，一律降级到离线词典
并带回 `downgradeReason`，由 UI 提示用户去设置。用户正读到一半，给个能用的答案比给个异常重要。

## 7. 样式隔离

Content script 的 UI 全部在 shadow root 内：

- `:host { all: initial }` 切断宿主页的继承属性（字号、颜色、行高）；
- 样式表以字符串注入（`import styles from './styles.css?inline'`），不产出外部 CSS 文件，
  也就不需要 `web_accessible_resources`；
- host 元素挂在 `<html>` 而不是 `<body>`：`<body>` 上的 `transform` 会让内部的
  `position: fixed` 变成相对定位，这是这类扩展最隐蔽的定位 bug；
- `z-index: 2147483647`，并且 host 自身 0×0，不拦截页面点击。

## 7.5 GitHub 同步

```
用户点「立即同步」 / chrome.alarms 定时触发
  └─ runSync()
       ├─ 拉：GET contents/vocabulary.json → JSON.parse
       │     └─ 解析失败 → 中止（绝不覆盖读不懂的远端资产）
       │     └─ importSnapshot(远端) → 合并进本地（加法语义）
       ├─ 建：buildSnapshot() → stampWithDataTime()（时间戳由数据推导，见 TD-16）
       └─ 推：三个文件逐字节比对，仅在真正变化时 PUT
             vocabulary.json / VOCABULARY.md / README.md
```

定时任务用 `chrome.alarms` 而不是 `setInterval`：worker 被回收时 `setInterval` 会静默失效，
表面上还在工作。`ensureSyncAlarm()` 先 `alarms.get` 再创建——重复创建会重置倒计时，
worker 频繁重启时周期性 alarm 将永远不触发。

Token 只在 service worker 与设置页（同权限上下文）中使用，永不进入网页上下文。

## 8. 构建与验证

```
npm run build
 ├─ clean                     删除 dist
 ├─ vite build                 页面 + service worker（ESM），复制 public/
 ├─ vite build -c …content     content script（IIFE 单文件，emptyOutDir: false）
 └─ node scripts/build-manifest.mjs
        同步版本号 + 校验 manifest 引用的每个文件都真的产出了
```

三层验证：

| 层 | 手段 | 覆盖 |
|---|---|---|
| 类型 | `tsc --noEmit`（strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`） | 契约一致性 |
| 单元 | vitest，纯函数 | 复习调度、句子抽取、浮层定位、词归一化 |
| 集成 | `scripts/smoke-test.mjs`：**真实 dist 产物** + 假 chrome API | 消息路由、打包、存储读写、缓存、去重 |

第三层是关键——它跑的是打包后的字节，能抓到"监听器没注册""node 内置模块被 stub 成 `{}`"
这类只在构建后才出现的问题。
