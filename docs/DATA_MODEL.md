# DATA_MODEL — 数据模型

## 1. 存储位置

全部数据在 `chrome.storage.local`（申请了 `unlimitedStorage`，不受 10MB 限制）。
没有服务器、没有 IndexedDB、没有 `storage.sync`（见 §7 的取舍说明）。

| key | 内容 | 形状 |
|---|---|---|
| `ara:meta` | schema 版本与安装时间 | `StorageMeta` |
| `ara:settings` | 用户设置（含 API Key） | `Settings` |
| `ara:words` | **单词本** | `Record<entryId, VocabularyEntry>` |
| `ara:activity` | 每日活跃汇总 | `Record<'YYYY-MM-DD', DailyActivity>` |
| `ara:reviewLog` | 复习流水（滚动保留最近 3000 条） | `ReviewLogEntry[]` |
| `ara:cache:explain` | 解释缓存（LRU，上限 300） | `Record<hash, { value, at, usedAt }>` |

命名统一 `ara:` 前缀，迁移和清理时可以一眼分辨。

## 2. VocabularyEntry — 核心资产

```ts
interface VocabularyEntry {
  id: string                  // w_<base36 时间>_<随机>
  word: string                // 页面上选中的原始形态，如 "Migrations"
  normalized: string          // 去标点小写，去重与搜索的键，如 "migrations"
  lemma: string               // 词典原形，如 "migration"
  kind: 'word' | 'phrase'
  phonetic: string            // /maɪˈɡreɪʃn/，未知时为空串（绝不编造）
  partOfSpeech: string        // noun / verb / phrase …

  meaning: string             // 基础中文释义（脱离语境）
  aiExplanation: string       // ★ 结合上下文的解释——产品的核心价值
  englishDefinition: string   // 英英释义
  example: string             // AI 新写的例句
  exampleTranslation: string
  synonyms: string[]

  source: {
    url: string               // 遇见它的页面
    title: string
    context: string           // ★ 当时那句原文
    wideContext: string       // 所在段落，复习时用
    capturedAt: number
  }

  origin: {                   // 谁产出了这条解释，保证可审计
    providerId: string        // 'claude' | 'openai' | 'mock' | …
    model: string
    offline: boolean
  }

  review: ReviewState
  tags: string[]
  notes: string               // 用户自己的笔记
  favorite: boolean
  createdAt: number
  updatedAt: number
}
```

### 与任务书里字段的对应关系

任务书给出的最小结构，在这里是一个超集：

| 任务书字段 | 本模型 | 说明 |
|---|---|---|
| `word` | `word` | 另存 `normalized` / `lemma`，用于去重、搜索与朗读 |
| `phonetic` | `phonetic` | 统一规范成 `/…/` 包裹 |
| `meaning` | `meaning` | 基础释义 |
| `aiExplanation` | `aiExplanation` | 语境解释 |
| `example` | `example` | 另存 `exampleTranslation` |
| `sourceUrl` | `source.url` | 收进 `source`，与标题、原句、段落同组 |
| `context` | `source.context` | 句子级；另存 `wideContext` 段落级 |
| `createdAt` | `createdAt` | epoch 毫秒（不是字符串：省空间、可直接比较、时区无关） |
| `reviewStatus` | `review.status` + `review.level` | 完整调度状态见下 |

### ReviewState

```ts
interface ReviewState {
  level: 0 | 1 | 2 | 3        // 陌生 / 学习中 / 熟悉 / 掌握
  status: 'new' | 'learning' | 'familiar' | 'mastered'   // level 的可读投影
  dueAt: number               // 下次到期（epoch ms），新词 = 立刻
  lastReviewedAt: number | null
  reviewCount: number
  lapses: number              // 从高等级掉回 0 的次数
  streak: number              // 连续答对次数，用于拉长间隔
}
```

`status` 是 `level` 的冗余投影。冗余是有意的：导出的 JSON 要能被人和别的工具直接读懂，
不该要求读者去查 `0` 是什么意思。

## 3. 复习调度

基础间隔：

| level | 含义 | 基础间隔 |
|---|---|---|
| 0 | 陌生 | 10 分钟（同一次会话内还会再见） |
| 1 | 学习中 | 1 天 |
| 2 | 熟悉 | 3 天 |
| 3 | 掌握 | 7 天 |

打分 → 等级变化：

| 评分 | level 变化 | streak | lapses |
|---|---|---|---|
| 忘记了 | → 0 | 归零 | 若原等级 > 0 则 +1 |
| 有点模糊 | −1（下限 0） | 归零 | — |
| 记得 | +1（上限 3） | +1 | — |
| 完全掌握 | +2（上限 3） | +1 | — |

实际间隔 = `基础间隔 × min(1 + 0.4 × (streak − 1), 3)`，上限 90 天。
所以一个反复答对的词，间隔会从 7 天逐步拉到 21 天，而不是永远每周骚扰用户一次。

`有点模糊` 既降级又**不**累计连击——它表示"想起来了但很吃力"，如果按成功计算，
会给一个正在挣扎的词拉长间隔（这个 bug 在写单元测试时被抓到，见 `scheduler.test.ts`）。

## 4. DailyActivity / ReviewLogEntry

```ts
interface DailyActivity {
  date: string      // 'YYYY-MM-DD'，本地时区
  saved: number     // 当天新增收藏
  reviewed: number  // 当天复习张数
  lookups: number   // 当天查询次数（含未收藏；缓存命中不计）
}

interface ReviewLogEntry {
  id: string
  entryId: string
  word: string      // 冗余存词面，删掉词条后历史仍可读
  grade: 'forgot' | 'hard' | 'good' | 'easy'
  levelBefore: 0|1|2|3
  levelAfter: 0|1|2|3
  reviewedAt: number
}
```

按**本地日历日**而不是 24 小时窗口聚合——用户理解的"今天"是日历日；
连续天数也因此在"昨天学过、今天还没开始"时不会断（半夜清零会惩罚睡觉的人）。

## 5. 并发与一致性

`chrome.storage` 没有事务。两个标签页同时收藏，各自"读整张词表 → 改 → 写回"就会丢词。

所有写路径都通过 `storage/mutex.ts` 的**按 key 串行队列**：

```ts
withLock('ara:words', async () => { const map = await readAll(); …; await write(map) })
```

同一个 worker / 页面内的写严格串行；跨进程的极端竞态（用户在两个窗口同一毫秒收藏同一个词）
最坏结果是一次解释刷新被覆盖，不会丢词条——因为同词是合并语义。

## 6. 版本与迁移

`ara:meta.schemaVersion` 记录当前版本（现为 `1`）。`storage/migrations.ts` 保存
"升级到版本 N 要做什么"的有序表；启动时逐级执行。第一版没有迁移函数，但结构先建好了——
第一次改 schema 时才建迁移机制，通常已经晚了。

## 7. 取舍记录

**为什么整张词表存一个 key，而不是一词一 key？**
一次 `get` 拿到全部，列表、搜索、统计都是内存操作，简单且快。代价是每次写要整体重写。
按每条 ~1KB 估算：1000 词 ≈ 1MB，单次写入毫秒级，在目标规模（数百到数千词）内完全够用。
超过这个规模的信号是写延迟变得可感知，届时换 IndexedDB——`StorageAdapter` 就是为这一天准备的。

**为什么不用 `storage.sync`？**
`storage.sync` 有 100KB 总量和 8KB 单项限制，装不下带原句的词条；而且它会把 API Key
同步到用户的 Google 账号。同步应该由用户显式控制（导出 / GitHub），不该悄悄发生。

**为什么 API Key 明文存在 `chrome.storage.local`？**
扩展没有安全的密钥保管设施：任何"加密"都得把解密密钥放在同一个包里，是自欺欺人。
真正的边界是：Key 只在 service worker 中使用，**永远不进入网页上下文**，也不写进任何日志。
文档如实说明这一点，比假装加密更负责任。

## 8. 导出格式（也是未来同步的格式）

```jsonc
{
  "format": "ai-reader-assistant/knowledge",
  "version": 1,
  "exportedAt": "2026-08-17T12:00:00.000Z",
  "counts": { "entries": 128, "reviews": 340, "activeDays": 21 },
  "entries":   [ /* VocabularyEntry[] */ ],
  "activity":  { "2026-08-17": { "date": "…", "saved": 3, "reviewed": 12, "lookups": 9 } },
  "reviewLog": [ /* ReviewLogEntry[] */ ]
}
```

- **导入是合并，不是覆盖**：本地数据是用户的资产，一次误操作不该毁掉它。
  同一个 `normalized` 冲突时，保留复习次数更多的那一份，并沿用本地 `id`。
- 纯 JSON、字段稳定、缩进两格 —— 这样它在 Git 里 diff 是可读的，
  这正是 GitHub 同步方案要利用的性质。
### 同步到 GitHub 时的仓库布局（按首字母分片）

```
index.json                清单：schema 版本、各分片词条数
vocabulary/a.json …z.json 词条数据，按首字母分片；other.json 收非拉丁字母开头的
vocabulary/a.md  …z.md    同一批词条的可读版本
meta/activity.json        每日活跃度
meta/reviews.json         复习流水
README.md                 统计首页 + 按字母导航
```

**为什么必须分片，而不只是"更整洁"**：一条词条实测约 2.5 KB（原句与段落占大头），
单个 `vocabulary.json` 在 **500 词左右就会越过 1 MB**，而 1 MB 正是 GitHub Contents API
读取单文件的硬上限——超过之后同步不是变慢，是直接坏掉。分片后最大的那片（英文里 s 开头
约占 11%）在 3000 词时约 860 KB。读取一律走 Blobs API，它没有这个上限。

分片同时让 diff 有意义：新增一个 z 开头的词只改动 `vocabulary/z.json`，而不是重写一个
GitHub 网页端根本拒绝渲染 diff 的多兆字节文件。

**写入走 Git Data API**（blob → tree → commit → ref），所以无论改动多少个文件都是
**一次提交**。Contents API 是一个文件一次提交，分片后会变成每次同步几十个 commit，
把"commit 历史即学习记录"这件事毁掉。

**只上传真正变了的文件**：git 的 blob sha 可以在本地算（`sha1("blob <len>\0" + 内容)`），
与远端 tree 列表比对即可，未变化的分片既不上传也不下载。稳态下一次同步 = 一次 tree 列表
请求 + 零上传。

`exportedAt` 在同步场景下由数据推导（所有词条与复习记录的最大 `updatedAt`），
不是"导出时刻"——否则每次定时同步都会产生一个只改时间戳的提交（见 TECH_DECISION TD-16）。

`ara:syncState` 记录同步结果（上次成功时间、仓库、错误码），与设置分开存：
设置是用户意图，同步状态是观测结果，一次失败不该改写用户配置。

- 另有 CSV 导出（word / phonetic / meaning / aiExplanation / example / context /
  sourceUrl / level / createdAt），供 Anki 与表格工具使用。
