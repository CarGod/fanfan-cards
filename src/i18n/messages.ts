import type { ResolvedLanguage } from './types.ts'

/**
 * 全部界面文案。
 *
 * 两种语言并排放在同一行，而不是分成 `zh.ts` / `en.ts` 两个文件：这样加一条文案时
 * 漏译是**写不出来**的——类型要求每条都给全两种语言。分文件的做法在第三次迭代之后
 * 必然出现「中文有、英文没有」的键，而那时没人会去逐条比对两个几百行的文件。
 *
 * 键的命名是 `<界面>.<区块>.<用途>`。占位符写 `{name}`。
 *
 * **不在这里的东西**：`ai/prompts.ts`（发给模型的指令，由 `targetLanguage` 决定）、
 * `ai/providers/mock.ts`（离线词典的词条内容，同样属于内容而非外壳）、
 * `sync/markdown.ts`（写进用户自己 GitHub 仓库的文件格式，改了会和已有仓库对不上）。
 * 界面语言管的是外壳，不该顺手改掉用户的数据和内容语言。
 */
type Entry = Record<ResolvedLanguage, string>

export const MESSAGES = {
  // ── 通用 ────────────────────────────────────────────────────────────────
  'app.name': { 'zh-CN': '翻翻词卡', en: 'FanFan Cards' },
  'common.dashboard': { 'zh-CN': '学习面板', en: 'Dashboard' },
  'common.due': { 'zh-CN': '待复习', en: 'Due' },
  'common.settings': { 'zh-CN': '设置', en: 'Settings' },
  'common.off': { 'zh-CN': '关闭', en: 'Off' },

  // ── 弹窗 ────────────────────────────────────────────────────────────────
  'popup.provider.no_key': { 'zh-CN': ' · 未配置 Key', en: ' · No API key' },
  'popup.stat.saved': { 'zh-CN': '收藏', en: 'Saved' },
  'popup.stat.streak': { 'zh-CN': '连续天数', en: 'Day streak' },
  'popup.paragraph.title': { 'zh-CN': '整段翻译', en: 'Paragraph translation' },
  'popup.paragraph.off': { 'zh-CN': '已关闭', en: 'Turned off' },
  'popup.paragraph.hint': {
    'zh-CN': '悬停 + {key} 翻译这一段',
    en: 'Hover + {key} to translate a paragraph',
  },
  'popup.paragraph.aria': { 'zh-CN': '整段翻译触发键', en: 'Paragraph translation trigger key' },
  'popup.display_mode.title': { 'zh-CN': '译文显示', en: 'Translation display' },
  'popup.display_mode.aria': { 'zh-CN': '译文显示方式', en: 'Translation display' },
  'popup.display_mode.bilingual': { 'zh-CN': '原文 + 译文', en: 'Original + translation' },
  'popup.display_mode.translation_only': { 'zh-CN': '仅译文', en: 'Translation only' },
  'popup.display_mode.hint_bilingual': {
    'zh-CN': '译文加在原文下面',
    en: 'Added under the original',
  },
  'popup.display_mode.hint_translation_only': {
    'zh-CN': '原文暂时藏起来',
    en: 'The original is hidden',
  },
  /* 一排两个开关，位置只有一半宽——标题必须短到不折行。 */
  'popup.site.short': { 'zh-CN': '本站划词', en: 'This site' },
  'popup.action.open_settings': { 'zh-CN': '打开设置', en: 'Open settings' },
  'popup.about': { 'zh-CN': '关于此项目', en: 'About this project' },
  'popup.site.title': { 'zh-CN': '在此网站启用划词', en: 'Enable on this site' },
  'popup.site.unsupported': { 'zh-CN': '当前页面不支持', en: 'Not available on this page' },
  'popup.site.aria': { 'zh-CN': '在此网站启用', en: 'Enable on this site' },
  'popup.site.globally_off': {
    'zh-CN': '扩展已全局关闭，可在设置页重新开启。',
    en: 'The extension is turned off everywhere. Turn it back on in Settings.',
  },
  'popup.action.restore': { 'zh-CN': '还原原文', en: 'Show original' },
  'popup.action.translate': { 'zh-CN': '翻译整页', en: 'Translate page' },
  'popup.action.review_count': {
    'zh-CN': '开始复习 {count} 张卡片',
    en: 'Review {count} cards',
  },
  'popup.action.review': { 'zh-CN': '进入闪卡复习', en: 'Open flashcards' },
  'popup.action.vocabulary': { 'zh-CN': '打开词卡', en: 'Open word cards' },
  'popup.today': {
    'zh-CN': '今日 +{saved} 词 · 复习 {reviewed} 张',
    en: 'Today +{saved} words · {reviewed} reviewed',
  },
  /** 版本号旁边的提示。点一下能跳到发布页，所以要说清它是什么。 */
  'popup.version.title': { 'zh-CN': '当前版本', en: 'Current version' },

  // ── 设置页外壳 ──────────────────────────────────────────────────────────
  'options.title': { 'zh-CN': '{name} 设置', en: '{name} Settings' },
  'options.ui_language': { 'zh-CN': '界面语言', en: 'Interface language' },
  'options.footer': {
    'zh-CN': '{name} · 本地优先 · 数据永远属于你',
    en: '{name} · Local-first · Your data stays yours',
  },
  'options.ui_language.hint': {
    'zh-CN': '选定之后就不再跟随浏览器。这只改界面，不改解释用什么语言写。',
    en: 'Once set, this stops following your browser. It changes the interface only, not the language explanations are written in.',
  },

  // ── 通用 ──────────────────────────────────────────────────────────────
  'common.loading': { 'zh-CN': '加载中…', en: 'Loading…' },

  // ── 应用外壳 ──────────────────────────────────────────────────────────
  'app.nav.vocabulary': { 'zh-CN': '词卡', en: 'Word cards' },
  'app.nav.flashcard': { 'zh-CN': '闪卡复习', en: 'Flashcards' },

  // ── 设置页 ────────────────────────────────────────────────────────────
  'options.nav.model': { 'zh-CN': 'AI 模型', en: 'AI model' },
  'options.nav.reading': { 'zh-CN': '划词与翻译', en: 'Look-up & translation' },
  'options.nav.review': { 'zh-CN': '复习', en: 'Review' },
  'options.nav.shortcut': { 'zh-CN': '快捷键', en: 'Shortcuts' },
  'options.nav.sync': { 'zh-CN': 'GitHub 同步', en: 'GitHub sync' },
  'options.nav.data': { 'zh-CN': '我的数据', en: 'My data' },
  'options.welcome.title': { 'zh-CN': '欢迎使用！', en: 'Welcome!' },
  'options.welcome.privacy': {
    'zh-CN': '扩展只在你主动划词或翻译时读取选中文字、附近上下文、页面标题和网址；词卡、设置与 Key 默认只保存在本机。配置模型后，这些阅读内容会直接发送给你选择的模型服务商；启用 GitHub 同步后，词卡会发送到你自己的仓库。开发者没有中转服务器，也不收集这些数据。不配置 Key 也可以使用离线词典。',
    en: 'The extension reads the selected text, its nearby context, the page title and the URL only when you look something up or ask for a translation. Word cards, settings and keys stay on this device by default. Once a model is configured, what you read goes straight to the provider you chose; with GitHub sync on, your word cards go to your own repository. There is no relay server, and the developer collects none of this. Without a key you can still use the offline dictionary.',
  },
  'options.model.desc': {
    'zh-CN': '所有请求都从扩展后台直接发往你选择的服务商，Key 只保存在本机 chrome.storage，不会经过任何第三方服务器。',
    en: 'Every request goes from the extension\'s background straight to the provider you chose. Your key lives in this browser\'s chrome.storage and never passes through a third-party server.',
  },
  'options.provider.badge_recommend': { 'zh-CN': '推荐', en: 'Recommended' },
  'options.provider.badge_free': { 'zh-CN': '免费', en: 'Free' },
  'options.provider.mock_notice': {
    'zh-CN': '离线词典模式：无需联网、无需 Key，但只能给出词典释义，无法结合上下文推断。',
    en: 'Offline dictionary: no network, no key — but it only gives dictionary definitions, never a meaning read from the context.',
  },
  'options.model.api_key': { 'zh-CN': 'API Key', en: 'API key' },
  'options.model.api_key_hint': {
    'zh-CN': '没有 Key？到 {url} 申请',
    en: 'No key yet? Get one at {url}',
  },
  'options.model.api_key_hint_optional': {
    'zh-CN': '如果你的网关不校验 Key，可以留空',
    en: 'Leave blank if your gateway does not check the key',
  },
  'options.model.placeholder_required': { 'zh-CN': '必填', en: 'Required' },
  'options.model.placeholder_optional': { 'zh-CN': '可选', en: 'Optional' },
  'options.model.model': { 'zh-CN': '模型', en: 'Model' },
  'options.model.hint_active': { 'zh-CN': '生效值：{value}', en: 'In use: {value}' },
  'options.model.hint_default': {
    'zh-CN': '留空 → 使用默认值 {value}',
    en: 'Leave blank → default: {value}',
  },
  'options.model.manual_required': {
    'zh-CN': '（此服务商必须手动填写）',
    en: '(none — you must fill this in)',
  },
  'options.model.base_url': { 'zh-CN': 'API 地址（可选）', en: 'API endpoint (optional)' },
  'options.model.base_url_hint_active': {
    'zh-CN': '生效值：{value}（覆盖了默认值）',
    en: 'In use: {value} (overrides the default)',
  },
  'options.test.run': { 'zh-CN': '测试连接', en: 'Test connection' },
  'options.test.running': { 'zh-CN': '测试中…', en: 'Testing…' },
  /*
   * 引文作者。人名（Bruce Lee、Aristotle）不用翻，「拉丁谚语」这种描述性的要翻——
   * 所以只有它需要一个键。
   */
  'options.test.author_latin': { 'zh-CN': '拉丁谚语', en: 'Latin proverb' },
  'options.test.quote': {
    'zh-CN': '用 “{text}” 真实调用一次 · {author}',
    en: 'Runs a real request on “{text}” · {author}',
  },
  'options.test.ok': { 'zh-CN': '连接正常（{model}）', en: 'Connected ({model})' },
  'options.test.meaning': {
    'zh-CN': '「{word}」在这句里：{meaning}',
    en: '“{word}” in this sentence: {meaning}',
  },
  'options.test.official_sdk': { 'zh-CN': '官方 SDK', en: 'official SDK' },
  'options.test.error_detail': { 'zh-CN': '{message}（{detail}）', en: '{message} ({detail})' },
  'options.reading.title': { 'zh-CN': '划词行为', en: 'Look-up behavior' },
  'options.reading.desc': { 'zh-CN': '决定选中文字之后会发生什么。', en: 'What happens after you select text.' },
  'options.reading.source_language': { 'zh-CN': '我在读的语言', en: 'Language I\'m reading' },
  'options.reading.source_language.hint': {
    'zh-CN': '选「自动识别」时由模型判断；指定语言可以避免在别的语种上误触发。',
    en: 'With “Auto-detect” the model decides; naming a language keeps look-ups from firing on other languages.',
  },
  'options.reading.target_language': {
    'zh-CN': '解释用什么语言写',
    en: 'Language explanations are written in',
  },
  'options.reading.target_language.hint': {
    'zh-CN': '固定不变——它是你思考用的语言，不该随页面变化。',
    en: 'Fixed on purpose — this is the language you think in, and it should not follow the page.',
  },
  'options.reading.enable': { 'zh-CN': '启用划词助手', en: 'Enable look-up' },
  'options.reading.enable.hint': {
    'zh-CN': '关闭后所有网页都不再注入 UI',
    en: 'When off, no page gets the extension UI',
  },
  'options.reading.trigger': { 'zh-CN': '触发方式', en: 'Trigger' },
  'options.reading.trigger.button': { 'zh-CN': '显示小按钮', en: 'Show a button' },
  'options.reading.trigger.auto': { 'zh-CN': '立即解释', en: 'Explain right away' },
  'options.reading.trigger.hotkey': { 'zh-CN': '按住 Alt 划词', en: 'Hold Alt to select' },
  'options.reading.auto_speak': { 'zh-CN': '自动朗读', en: 'Read aloud' },
  'options.reading.auto_speak.hint': {
    'zh-CN': '解释卡片出现时自动读一遍单词',
    en: 'Speaks the word when the card opens',
  },
  'options.reading.english_definition': { 'zh-CN': '显示英文释义', en: 'Show English definition' },
  'options.reading.english_definition.hint': {
    'zh-CN': '在卡片上同时给出 English definition',
    en: 'Adds an English definition to the card',
  },
  'options.reading.max_length': { 'zh-CN': '最长划选长度（字符）', en: 'Longest selection (characters)' },
  'options.reading.max_length.hint': {
    'zh-CN': '超过这个长度就不再触发，避免整段文字被当成单词发给模型',
    en: 'Anything longer will not trigger a look-up, so a whole paragraph never gets sent as a word',
  },
  'options.reading.display_mode': { 'zh-CN': '译文显示方式', en: 'Translation display' },
  'options.reading.display_mode.hint': {
    'zh-CN': '整页翻译和悬停整段翻译共用这个设置。「仅译文」把原文藏起来，不是删掉——随时切回来，不用重新翻一遍。',
    en: 'Shared by page translation and the hover-a-paragraph gesture. “Translation only” hides the original rather than removing it — switch back any time, with no re-translation.',
  },
  'options.reading.concurrency': { 'zh-CN': '整页翻译并发数', en: 'Page translation concurrency' },
  'options.reading.concurrency.hint': {
    'zh-CN': '同时发出多少个翻译请求。一篇长文的耗时大致等于「段落批次 ÷ 并发数」，所以调高确实更快。代价是撞限流：调高之后遇到 429 是常态，那时翻译会自动把并发减半继续跑，不会整轮停掉。默认 3 在几乎所有服务商上都不触线。',
    en: 'How many translation requests run at once. A long article takes roughly “batches ÷ concurrency”, so raising this really is faster. The cost is rate limiting: at higher values a 429 is normal, and translation then halves its concurrency and keeps going rather than stopping the whole run. The default of 3 stays under the limit on nearly every provider.',
  },
  'options.reading.concurrency.value': { 'zh-CN': '{count} 个', en: '{count}' },
  'options.reading.concurrency.default_suffix': { 'zh-CN': '（默认）', en: ' (default)' },
  'options.reading.page_range': { 'zh-CN': '整页翻译范围', en: 'Page translation scope' },
  'options.reading.page_range.hint': {
    'zh-CN': '「仅正文」会跳过导航栏、页眉页脚和侧边栏——它们通常是界面文字而不是你要读的内容。',
    en: '“Main content” skips navigation, headers, footers and sidebars — those are interface text, not what you came to read.',
  },
  'options.reading.page_range.content': { 'zh-CN': '仅正文', en: 'Main content' },
  'options.reading.page_range.all': { 'zh-CN': '整页', en: 'Whole page' },
  'options.reading.paragraph.hint': {
    'zh-CN': '按住这个键并把鼠标停在某一段上，就只翻译那一段；再按一次收起。适合「整页都读得懂，就那一段卡住」。',
    en: 'Hold this key and hover a paragraph to translate just that one; press again to hide it. For when the page reads fine and only one paragraph does not.',
  },
  'options.reading.paragraph.backtick': {
    'zh-CN': '按 ` 反引号（默认，不与任何组合键冲突）',
    en: 'Backtick ` (default, clashes with nothing)',
  },
  'options.reading.paragraph.hold': { 'zh-CN': '按住 {key}', en: 'Hold {key}' },
  'options.model.thinking': { 'zh-CN': '模型思考深度', en: 'Thinking depth' },
  'options.model.thinking.hint': {
    'zh-CN': '查词是等着要答案的动作，而多数服务商默认跑在最高推理档上——DeepSeek 就是。调低能明显变快，解释也够用；遇到难词再调高。「关闭」在支持的服务商上是真关，不支持的会退到它最低的一档。',
    en: 'Looking a word up is something you wait for, and most providers default to their highest reasoning effort — DeepSeek does. Lower is noticeably faster and still explains well; raise it for hard words. “Off” genuinely turns thinking off where the provider supports it, and falls back to its lowest setting where it does not.',
  },
  'options.model.thinking.off': { 'zh-CN': '关闭', en: 'Off' },
  'options.model.thinking.low': { 'zh-CN': '低（快）', en: 'Low (fast)' },
  'options.model.thinking.high': { 'zh-CN': '高', en: 'High' },
  'options.reading.examples': { 'zh-CN': '例句数量', en: 'Examples per look-up' },
  'options.reading.examples.hint': {
    'zh-CN': '0 表示不要例句——例句是查询里最费时间的部分，关掉能明显加快出结果。',
    en: 'Zero means none. Examples are the slowest part of a look-up, so turning them off is noticeably faster.',
  },
  'options.reading.examples.none': { 'zh-CN': '不要例句', en: 'No examples' },
  'options.reading.examples.count': { 'zh-CN': '{count} 句', en: '{count} sentences' },
  'options.reading.examples.count_one': { 'zh-CN': '1 句', en: '1 sentence' },
  'options.reading.examples.default_suffix': { 'zh-CN': '（默认）', en: ' (default)' },
  'options.reading.cache_ttl': { 'zh-CN': '解释缓存时长（小时）', en: 'Cache explanations for (hours)' },
  'options.reading.cache_ttl.hint': {
    'zh-CN': '同一个词在同一句话里的解释会被缓存，0 表示不缓存',
    en: 'The same word in the same sentence comes back from cache; 0 turns caching off',
  },
  'options.reading.blocked': { 'zh-CN': '已禁用的网站', en: 'Disabled sites' },
  'options.reading.blocked.restore': { 'zh-CN': '点击重新启用', en: 'Click to re-enable' },
  'options.data.title': { 'zh-CN': '我的知识库', en: 'My library' },
  'options.data.desc': {
    'zh-CN': '共 {count} 个词条，全部保存在本机。导出的 JSON 与同步到 GitHub 的格式完全一致。',
    en: '{count} entries, all stored on this device. The exported JSON is exactly what GitHub sync writes.',
  },
  'options.data.export': { 'zh-CN': '导出全部数据', en: 'Export all data' },
  'options.data.import': { 'zh-CN': '导入 JSON', en: 'Import JSON' },
  'options.data.clear_cache': { 'zh-CN': '清空缓存', en: 'Clear cache' },
  'options.data.wipe': { 'zh-CN': '清空词卡', en: 'Delete all word cards' },
  'options.data.exported': { 'zh-CN': '已导出 {count} 个词条', en: 'Exported {count} entries' },
  'options.data.imported': {
    'zh-CN': '导入完成：新增 {added}，合并 {merged}，跳过 {skipped}',
    en: 'Import finished: {added} added, {merged} merged, {skipped} skipped',
  },
  'options.data.import_failed': { 'zh-CN': '导入失败', en: 'Import failed' },
  'options.data.cache_cleared': {
    'zh-CN': '已清空解释与翻译缓存',
    en: 'Explanation and translation caches cleared',
  },
  'options.data.wipe_confirm': {
    'zh-CN': '确定要删除全部 {count} 个词条吗？此操作不可撤销，建议先导出备份。',
    en: 'Delete all {count} entries? This cannot be undone — export a backup first.',
  },
  'options.data.wiped': { 'zh-CN': '已清空词卡', en: 'All word cards deleted' },
  'options.sync.title': { 'zh-CN': '同步到 GitHub 私有仓库', en: 'Sync to a private GitHub repo' },
  'options.sync.desc': {
    'zh-CN': '把词卡变成你自己的 Git 仓库：每次同步都是一次提交，commit 历史就是你的学习记录。数据只在你的浏览器和 GitHub 之间流动，没有任何中间服务器。',
    en: 'Turn your word cards into a Git repo of your own: every sync is one commit, so the commit history is your learning record. Data moves between your browser and GitHub only — there is no server in the middle.',
  },
  'options.sync.token.label': {
    'zh-CN': 'GitHub Personal Access Token',
    en: 'GitHub Personal Access Token',
  },
  'options.sync.token.hint': {
    'zh-CN': 'Token 只保存在本机，只在扩展后台使用，不会发给除 GitHub 之外的任何一方。',
    en: 'The token stays on this device, is used only by the extension\'s background worker, and is never sent to anyone but GitHub.',
  },
  'options.sync.token.generate': {
    'zh-CN': '点这里生成（已预选 repo 权限与「永不过期」）→',
    en: 'Generate one here — repo scope and "never expires" preselected →',
  },
  'options.sync.expiry.note_lead': {
    'zh-CN': '选「永不过期」是有意的：会过期的 Token 会让几个月后的后台自动同步',
    en: '"Never expires" is deliberate: months from now, an expiring token would make background sync ',
  },
  'options.sync.expiry.note_em': { 'zh-CN': '静默失败。', en: 'fail silently.' },
  'options.sync.token.fine_grained': {
    'zh-CN': '想要最小权限？先在 GitHub 手动建好私有仓库，再用 fine-grained token 只授予该仓库的 Contents 读写——本扩展检测到仓库已存在就不会请求创建权限。',
    en: 'Want the narrowest scope? Create the private repo on GitHub yourself, then use a fine-grained token that grants Contents read/write on that repo alone — once the extension finds the repo, it never asks for permission to create one.',
  },
  'options.sync.repo.label': { 'zh-CN': '仓库名', en: 'Repository name' },
  'options.sync.repo.hint': {
    'zh-CN': '不存在就自动创建为私有仓库。换设备时会先在你的账号里找已有的知识库（认仓库描述里的标记，改过名也能认出来），找到就直接关联，不会重复创建。',
    en: 'Created as a private repo if it does not exist yet. On a new device the extension first looks through your account for an existing knowledge base — it matches a marker in the repo description, so a renamed repo is still recognised — and links to that instead of creating a second one.',
  },
  'options.sync.action.connecting': { 'zh-CN': '连接中…', en: 'Connecting…' },
  'options.sync.action.reconnect': { 'zh-CN': '重新连接', en: 'Reconnect' },
  'options.sync.action.connect': { 'zh-CN': '连接并创建仓库', en: 'Connect and create repo' },
  'options.sync.action.syncing': { 'zh-CN': '同步中…', en: 'Syncing…' },
  'options.sync.action.sync_now': { 'zh-CN': '立即同步', en: 'Sync now' },
  'options.sync.action.open_repo': { 'zh-CN': '打开仓库 ↗', en: 'Open repo ↗' },
  'options.sync.auto.title': { 'zh-CN': '自动同步', en: 'Auto sync' },
  'options.sync.auto.desc': {
    'zh-CN': '收藏或删除单词后约 30 秒自动提交一次；此外按下面的间隔兜底轮询',
    en: 'Commits about 30 seconds after you save or delete a word; the interval below is the fallback poll',
  },
  'options.sync.interval.label': { 'zh-CN': '同步间隔（分钟）', en: 'Sync interval (minutes)' },
  'options.sync.toast.created': { 'zh-CN': '已创建私有仓库 {repo}', en: 'Created private repo {repo}' },
  'options.sync.toast.adopted': {
    'zh-CN': '发现已有的知识库 {repo}，已自动关联',
    en: 'Found your existing knowledge base {repo} and linked to it',
  },
  'options.sync.toast.connected': { 'zh-CN': '已连接 {repo}', en: 'Connected to {repo}' },
  'options.sync.toast.first_sync': { 'zh-CN': '首次同步完成', en: 'First sync complete' },
  'options.sync.toast.force_pulled': {
    'zh-CN': '已用远端内容覆盖本地，本地现有 {count} 条变动',
    en: 'Local data overwritten from the repo · {count} entries pulled in',
  },
  'options.sync.toast.force_pushed': {
    'zh-CN': '已用本地内容覆盖远端，提交了 {count} 个文件',
    en: 'Repo overwritten from this device · {count} files committed',
  },
  'options.sync.toast.pushed': { 'zh-CN': '已同步 {count} 个词条', en: 'Synced {count} word cards' },
  'options.sync.toast.pushed_and_merged': {
    'zh-CN': '已同步 {count} 个词条，并合并了远端 {pulled} 条',
    en: 'Synced {count} word cards and merged {pulled} from the repo',
  },
  'options.sync.toast.up_to_date': {
    'zh-CN': '远端已是最新，无需提交',
    en: 'Repo already up to date — nothing to commit',
  },
  'options.sync.confirm.force_pull': {
    'zh-CN': '用远端覆盖本地：本机上远端没有的词卡会被删除，且不会再同步回去。确定吗？',
    en: 'Overwrite local with the repo: word cards on this device that the repo does not have will be deleted, and they will not sync back. Continue?',
  },
  'options.sync.confirm.force_push': {
    'zh-CN': '用本地覆盖远端：仓库里这台设备没有的词卡会被覆盖。确定吗？',
    en: 'Overwrite the repo with this device: word cards in the repo that this device does not have will be overwritten. Continue?',
  },
  'options.sync.error.detail': { 'zh-CN': '{message}（{detail}）', en: '{message} ({detail})' },
  'options.sync.status.failed': {
    'zh-CN': '上次同步失败（{when}）：{reason}',
    en: 'Last sync failed ({when}): {reason}',
  },
  'options.sync.status.ok': {
    'zh-CN': '上次同步 {when} · {repo} · {count} 个词条',
    en: 'Last synced {when} · {repo} · {count} word cards',
  },
  'options.sync.conflict.explain_lead': {
    'zh-CN': '两台设备各自改过词卡，自动合并没能对上。先试一次重新合并——它不会删任何东西。仍然失败，再选一边覆盖，',
    en: 'Both devices changed word cards and the automatic merge could not reconcile them. Try merging again first — it deletes nothing. If that still fails, pick a side to overwrite: ',
  },
  'options.sync.conflict.explain_em': {
    'zh-CN': '被覆盖的那一边会丢掉对方没有的词卡。',
    en: 'the side you overwrite loses every card the other side does not have.',
  },
  'options.sync.conflict.retry': { 'zh-CN': '重新合并（安全）', en: 'Merge again (safe)' },
  'options.sync.conflict.force_pull': { 'zh-CN': '用远端覆盖本地', en: 'Overwrite local from repo' },
  'options.sync.conflict.force_pull_title': {
    'zh-CN': '丢弃本机上远端没有的词卡，改用仓库里的内容',
    en: 'Discard local cards the repo does not have and take the repo\'s copy',
  },
  'options.sync.conflict.force_push': { 'zh-CN': '用本地覆盖远端', en: 'Overwrite repo from local' },
  'options.sync.conflict.force_push_title': {
    'zh-CN': '用本机内容整体提交，覆盖仓库里这台设备没有的改动',
    en: 'Commit this device\'s copy wholesale, overwriting repo changes this device does not have',
  },
  'options.review.title': { 'zh-CN': '复习方式', en: 'Review style' },
  'options.review.desc_lead': {
    'zh-CN': '所有模式都只从',
    en: 'Every mode draws only from cards that are ',
  },
  'options.review.desc_em': { 'zh-CN': '已经到期', en: 'already due' },
  'options.review.desc_tail': {
    'zh-CN': '的卡片里选——那才是间隔重复的含义。模式决定的是你按什么顺序遇到它们。',
    en: ' — that is what spaced repetition means. What a mode decides is the order you meet them in.',
  },
  'options.review.mode.label': { 'zh-CN': '排序模式', en: 'Card order' },
  'options.review.mode.curve': { 'zh-CN': '记忆曲线', en: 'Forgetting curve' },
  'options.review.mode.curve_hint': {
    'zh-CN': '按遗忘曲线到期顺序，最生疏的先来。这是真正的间隔重复，默认。',
    en: 'Due order along the forgetting curve, shakiest first. This is real spaced repetition, and the default.',
  },
  'options.review.mode.recent': { 'zh-CN': '最新优先', en: 'Newest first' },
  'options.review.mode.recent_hint': {
    'zh-CN': '最近收藏的先复习——“今天读到的那些词”。',
    en: 'Recently saved cards come first — "the words I read today".',
  },
  'options.review.mode.hardest': { 'zh-CN': '最难优先', en: 'Hardest first' },
  'options.review.mode.hardest_hint': {
    'zh-CN': '按遗忘次数排序，专攻反复记不住的。',
    en: 'Ordered by how often you forgot them, so the stubborn ones get the work.',
  },
  'options.review.mode.random': { 'zh-CN': '随机', en: 'Shuffle' },
  'options.review.mode.random_hint': {
    'zh-CN': '打乱顺序，避免靠位置记住答案。',
    en: 'Shuffles the order so you cannot recall an answer by its position.',
  },
  'options.review.intensity.label': { 'zh-CN': '间隔强度', en: 'Interval strength' },
  'options.review.intensity.relaxed': { 'zh-CN': '宽松', en: 'Relaxed' },
  'options.review.intensity.standard': { 'zh-CN': '标准', en: 'Standard' },
  'options.review.intensity.intensive': { 'zh-CN': '紧凑', en: 'Intensive' },
  'options.review.intensity.hint': {
    'zh-CN': '掌握后约 {mastered} 天后再见，熟悉约 {familiar} 天',
    en: 'Mastered cards come back in about {mastered} days, familiar ones in about {familiar}',
  },
  'options.review.goal.label': { 'zh-CN': '每天复习多少张', en: 'Cards per day' },
  'options.review.goal.hint': {
    'zh-CN': '一次会话的上限，也是学习面板上进度环的分母。',
    en: 'The cap for one session, and the denominator of the progress ring on the dashboard.',
  },
  'options.review.reminder.title': { 'zh-CN': '每日提醒', en: 'Daily reminder' },
  'options.review.reminder.desc_lead': { 'zh-CN': '只在', en: 'Reminders fire only ' },
  'options.review.reminder.desc_em': {
    'zh-CN': '确实有卡片到期、且你今天还没完成目标',
    en: 'when cards are actually due and you have not hit today\'s goal',
  },
  'options.review.reminder.desc_tail': {
    'zh-CN': '时才提醒。无条件响的提醒最终都会被关掉。',
    en: '. A reminder that rings no matter what ends up switched off.',
  },
  'options.review.reminder.toggle': { 'zh-CN': '开启提醒', en: 'Turn on reminders' },
  'options.review.reminder.toggle_desc': {
    'zh-CN': '到点后弹一条系统通知，点击直接进入复习',
    en: 'Sends a system notification at that time; click it to go straight into review',
  },
  'options.review.reminder.toggle_aria': { 'zh-CN': '开启每日提醒', en: 'Turn on daily reminder' },
  'options.review.reminder.time_label': { 'zh-CN': '提醒时间', en: 'Reminder time' },
  'options.review.reminder.time_hint': {
    'zh-CN': '按你本机时区的时间。',
    en: 'In this device\'s time zone.',
  },
  'options.shortcut.title': { 'zh-CN': '快捷键', en: 'Keyboard shortcuts' },
  'options.shortcut.desc_lead': {
    'zh-CN': 'Chrome 只允许你本人修改扩展快捷键——这是它的安全设计，扩展无法自行占用按键。下面显示的是当前',
    en: 'Only you can change an extension\'s shortcuts, by Chrome\'s design — no extension can claim a key on its own. What you see below is the binding that is ',
  },
  'options.shortcut.desc_em': { 'zh-CN': '实际生效', en: 'actually in effect' },
  'options.shortcut.desc_tail': {
    'zh-CN': '的绑定（Chrome 会按你的系统显示，macOS 上的 Option 就是 Windows 上的 Alt）。',
    en: ' (Chrome shows it for your platform: Option on macOS is Alt on Windows).',
  },
  'options.shortcut.translate_page': { 'zh-CN': '翻译 / 还原整页', en: 'Translate / restore page' },
  'options.shortcut.explain_selection': { 'zh-CN': '解释选中的英文', en: 'Explain the selection' },
  'options.shortcut.open_app': { 'zh-CN': '打开词卡与复习', en: 'Open word cards and review' },
  'options.shortcut.default': { 'zh-CN': '默认 {keys}', en: 'Default {keys}' },
  'options.shortcut.unset': { 'zh-CN': '未设置', en: 'Not set' },
  'options.shortcut.open_chrome': { 'zh-CN': '去 Chrome 修改快捷键', en: 'Change shortcuts in Chrome' },

  // ── 学习面板 ──────────────────────────────────────────────────────────
  'dashboard.sub.loading': { 'zh-CN': '正在读取本地知识库…', en: 'Loading your local library…' },
  'dashboard.sub.empty': {
    'zh-CN': '还没有收藏任何单词——去任意英文网页划词试试。',
    en: 'No words saved yet — look up a word on any English page to get started.',
  },
  'dashboard.sub.summary': {
    'zh-CN': '你的英语知识库里有 {total} 个词条，其中 {mastered} 个已掌握。',
    en: 'Your library holds {total} words, and you\'ve mastered {mastered} of them.',
  },
  'dashboard.stat.total': { 'zh-CN': '词卡总数', en: 'Total cards' },
  'dashboard.stat.total_foot': { 'zh-CN': '今日新增 {count}', en: '+{count} today' },
  'dashboard.stat.due_action': { 'zh-CN': '开始复习 →', en: 'Start reviewing →' },
  'dashboard.stat.due_none': { 'zh-CN': '今天没有到期的卡片', en: 'Nothing due today' },
  'dashboard.stat.reviewed_today': { 'zh-CN': '今日复习', en: 'Reviewed today' },
  'dashboard.stat.goal_foot': { 'zh-CN': '目标 {goal} 张', en: 'Goal: {goal} cards' },
  'dashboard.stat.streak': { 'zh-CN': '连续学习', en: 'Study streak' },
  'dashboard.stat.streak_days': { 'zh-CN': '{count} 天', en: '{count} days' },
  'dashboard.stat.streak_keep': { 'zh-CN': '保持住', en: 'Keep it going' },
  'dashboard.stat.streak_start': { 'zh-CN': '今天学一个词就能开始', en: 'One word today starts the streak' },
  'dashboard.goal.title': { 'zh-CN': '今日目标', en: 'Today\'s goal' },
  'dashboard.goal.progress': {
    'zh-CN': '已复习 {reviewed} / {goal} 张',
    en: '{reviewed} of {goal} reviewed',
  },
  'dashboard.chart.title': { 'zh-CN': '最近两周', en: 'Last two weeks' },
  'dashboard.chart.hint': {
    'zh-CN': '每天的收藏 + 复习次数',
    en: 'Words saved plus cards reviewed, per day',
  },
  'dashboard.chart.bar_title': {
    'zh-CN': '{date}：收藏 {saved} · 复习 {reviewed}',
    en: '{date} · {saved} saved · {reviewed} reviewed',
  },
  'dashboard.levels.title': { 'zh-CN': '熟悉度分布', en: 'Familiarity breakdown' },
  'dashboard.levels.hint': {
    'zh-CN': '越靠右说明掌握得越好',
    en: 'The further right, the better you know it',
  },
  'dashboard.levels.item_title': { 'zh-CN': '{label}：{count}', en: '{label}: {count}' },
  'dashboard.recent.title': { 'zh-CN': '最近收藏', en: 'Recently saved' },
  'dashboard.recent.all': { 'zh-CN': '查看全部 →', en: 'See all →' },
  'dashboard.recent.empty': {
    'zh-CN': '还没有记录。打开一篇英文文章，选中一个不认识的词就会出现在这里。',
    en: 'Nothing here yet. Open an English article, select a word you don\'t know, and it lands right here.',
  },
  'dashboard.recent.unknown_source': { 'zh-CN': '未知来源', en: 'Unknown source' },

  // ── 词卡列表与详情 ────────────────────────────────────────────────────
  'vocabulary.title': { 'zh-CN': '我的词卡', en: 'My Word Cards' },
  'vocabulary.loading': { 'zh-CN': '加载中…', en: 'Loading…' },
  'vocabulary.count': {
    'zh-CN': '共 {total} 个词条，当前显示 {shown} 个',
    en: '{total} cards · {shown} shown',
  },
  'vocabulary.search.placeholder': {
    'zh-CN': '搜索单词、释义或原句…',
    en: 'Search words, meanings or sentences…',
  },
  'vocabulary.filter.all': { 'zh-CN': '全部', en: 'All' },
  'vocabulary.filter.due': { 'zh-CN': '待复习', en: 'Due' },
  'vocabulary.sort.recent': { 'zh-CN': '最新', en: 'Recent' },
  'vocabulary.sort.due': { 'zh-CN': '复习顺序', en: 'Review order' },
  'vocabulary.export.json': { 'zh-CN': '导出 JSON', en: 'Export JSON' },
  'vocabulary.export.csv': { 'zh-CN': '导出 CSV', en: 'Export CSV' },
  'vocabulary.toast.deleted': { 'zh-CN': '已删除', en: 'Deleted' },
  'vocabulary.toast.exported_entries': { 'zh-CN': '已导出 {count} 个词条', en: 'Exported {count} cards' },
  'vocabulary.toast.exported_csv': {
    'zh-CN': '已导出 {count} 行 CSV',
    en: 'Exported {count} rows to CSV',
  },
  'vocabulary.empty.title': { 'zh-CN': '词卡还是空的', en: 'No word cards yet' },
  'vocabulary.empty.hint': {
    'zh-CN': '在任意英文网页上划词 → 点击「解释」→ 收藏，词条就会出现在这里。',
    en: 'Select a word on any English page, hit Explain, then save it — the card shows up here.',
  },
  'vocabulary.no_match.title': { 'zh-CN': '没有匹配的词条', en: 'No matching cards' },
  'vocabulary.no_match.hint': { 'zh-CN': '换一个关键词或筛选条件试试。', en: 'Try another keyword or filter.' },
  'vocabulary.source.unknown': { 'zh-CN': '未知来源', en: 'Unknown source' },
  'vocabulary.detail.aria': { 'zh-CN': '{word} 详情', en: '{word} details' },
  'vocabulary.detail.speak_word': { 'zh-CN': '朗读这个词', en: 'Read this word aloud' },
  'vocabulary.detail.close': { 'zh-CN': '关闭', en: 'Close' },
  'vocabulary.detail.meaning': { 'zh-CN': '基础释义', en: 'Meaning' },
  'vocabulary.detail.in_context': { 'zh-CN': '语境含义', en: 'In this context' },
  'vocabulary.detail.english': { 'zh-CN': 'English', en: 'In English' },
  'vocabulary.detail.examples': { 'zh-CN': '例句', en: 'Examples' },
  'vocabulary.detail.speak_example': { 'zh-CN': '朗读这句例句', en: 'Read this example aloud' },
  'vocabulary.detail.synonyms': { 'zh-CN': '近义词', en: 'Synonyms' },
  'vocabulary.detail.source': { 'zh-CN': '遇见它的地方', en: 'Where you met it' },
  'vocabulary.detail.no_context': { 'zh-CN': '（未记录原句）', en: '(No sentence captured)' },
  'vocabulary.detail.familiarity': { 'zh-CN': '熟悉程度', en: 'Familiarity' },
  'vocabulary.detail.review_stats': {
    'zh-CN': '已复习 {count} 次 · 遗忘 {lapses} 次 · 下次 {due}',
    en: 'Reviewed {count}× · forgotten {lapses}× · next {due}',
  },
  'vocabulary.detail.notes': { 'zh-CN': '我的笔记', en: 'My notes' },
  'vocabulary.detail.notes_placeholder': {
    'zh-CN': '记下你自己的理解、联想或易混词…',
    en: 'Your own reading of it, a mnemonic, words you keep confusing it with…',
  },
  'vocabulary.detail.notes_saving': { 'zh-CN': '保存中…', en: 'Saving…' },
  'vocabulary.detail.notes_save': { 'zh-CN': '保存笔记', en: 'Save notes' },
  'vocabulary.detail.origin': { 'zh-CN': '来源模型：{model}', en: 'Explained by {model}' },
  'vocabulary.detail.origin_offline': { 'zh-CN': '离线词典', en: 'Offline dictionary' },
  'vocabulary.detail.delete': { 'zh-CN': '删除词条', en: 'Delete card' },
  'vocabulary.cefr.a1': { 'zh-CN': '入门', en: 'Beginner' },
  'vocabulary.cefr.a2': { 'zh-CN': '基础', en: 'Elementary' },
  'vocabulary.cefr.b1': { 'zh-CN': '中级', en: 'Intermediate' },
  'vocabulary.cefr.b2': { 'zh-CN': '中高级', en: 'Upper-intermediate' },
  'vocabulary.cefr.c1': { 'zh-CN': '高级', en: 'Advanced' },
  'vocabulary.cefr.c2': { 'zh-CN': '精通', en: 'Proficient' },
  'vocabulary.familiarity.new': { 'zh-CN': '陌生', en: 'New' },
  'vocabulary.familiarity.learning': { 'zh-CN': '学习中', en: 'Learning' },
  'vocabulary.familiarity.familiar': { 'zh-CN': '熟悉', en: 'Familiar' },
  'vocabulary.familiarity.mastered': { 'zh-CN': '掌握', en: 'Mastered' },

  // ── 闪卡复习 ──────────────────────────────────────────────────────────
  'flashcard.title': { 'zh-CN': '闪卡复习', en: 'Flashcard review' },
  'flashcard.empty.title': { 'zh-CN': '还没有可复习的卡片', en: 'No cards to review yet' },
  'flashcard.empty.hint': {
    'zh-CN': '收藏的每个单词都会自动变成一张闪卡。',
    en: 'Every word you save becomes a flashcard automatically.',
  },
  'flashcard.empty.action': { 'zh-CN': '去看看词卡', en: 'Browse word cards' },
  'flashcard.start.due_sub': {
    'zh-CN': '有 {count} 张卡片到期了，本次最多复习 {limit} 张。',
    en: '{count} cards are due. This session covers up to {limit}.',
  },
  'flashcard.start.clear_sub': {
    'zh-CN': '今天没有到期的卡片——你可以提前复习最接近到期的那些。',
    en: 'Nothing is due today — you can review the cards closest to due ahead of time.',
  },
  'flashcard.start.begin': { 'zh-CN': '开始复习（{count} 张）', en: 'Start review ({count})' },
  'flashcard.start.ahead': { 'zh-CN': '提前复习', en: 'Review ahead' },
  'flashcard.start.shortcuts': {
    'zh-CN': '快捷键：空格翻面 · 回车确认（记得）· ← 上一张（撤销评分）· → 跳过 · 1 忘记 · 2 模糊 · 3 记得 · 4 掌握',
    en: 'Shortcuts: Space flips · Enter accepts (Good) · ← back (undoes the grade) · → skip · 1 Again · 2 Hard · 3 Good · 4 Easy',
  },
  'flashcard.done.title': {
    'zh-CN': '本轮完成，复习了 {count} 张',
    en: 'Session done — {count} cards reviewed',
  },
  'flashcard.done.empty_title': { 'zh-CN': '当前没有需要复习的卡片', en: 'Nothing to review right now' },
  'flashcard.done.hint': {
    'zh-CN': '记忆最牢的时机是刚好快要忘记的时候，明天再来。',
    en: 'Memory sticks best when you review just before you forget. Come back tomorrow.',
  },
  'flashcard.done.back': { 'zh-CN': '返回', en: 'Back' },
  'flashcard.done.dashboard': { 'zh-CN': '看看数据', en: 'View stats' },
  'flashcard.nav.previous': { 'zh-CN': '上一张', en: 'Previous card' },
  'flashcard.nav.previous_title': {
    'zh-CN': '上一张（←）——已评分的会撤销',
    en: 'Previous (←) — undoes the grade if you gave one',
  },
  'flashcard.nav.next': { 'zh-CN': '下一张', en: 'Next card' },
  'flashcard.nav.next_title': { 'zh-CN': '下一张（→）——跳过，不评分', en: 'Next (→) — skip without grading' },
  'flashcard.nav.end': { 'zh-CN': '结束', en: 'End' },
  'flashcard.card.speak': { 'zh-CN': '朗读', en: 'Play' },
  'flashcard.card.front_hint': {
    'zh-CN': '先想一想它在原句里的意思 · 空格或回车翻面',
    en: 'Try to recall what it meant in the sentence · Space or Enter to flip',
  },
  'flashcard.card.flip_hint': {
    'zh-CN': '空格 / 回车翻面 · ← 上一张 · → 跳过',
    en: 'Space / Enter to flip · ← back · → skip',
  },
  'flashcard.card.meaning': { 'zh-CN': '基础释义', en: 'Meaning' },
  'flashcard.card.no_meaning': { 'zh-CN': '（无）', en: '(none)' },
  'flashcard.card.context_meaning': { 'zh-CN': '语境含义', en: 'In context' },
  'flashcard.card.english': { 'zh-CN': 'English', en: 'English definition' },
  'flashcard.card.examples': { 'zh-CN': '例句', en: 'Examples' },
  'flashcard.card.source_context': { 'zh-CN': '当时的原文', en: 'Where you found it' },
  'flashcard.grade.forgot': { 'zh-CN': '忘记了', en: 'Again' },
  'flashcard.grade.hard': { 'zh-CN': '有点模糊', en: 'Hard' },
  'flashcard.grade.good': { 'zh-CN': '记得', en: 'Good' },
  'flashcard.grade.easy': { 'zh-CN': '完全掌握', en: 'Easy' },
  'flashcard.grade.shortcut': { 'zh-CN': '快捷键 {key}', en: 'Shortcut {key}' },

  // ── 网页上的划词卡 ────────────────────────────────────────────────────
  'card.aria.dialog': { 'zh-CN': '{word} 的解释', en: 'Explanation of {word}' },
  'card.meta.lemma': { 'zh-CN': '原形 {lemma}', en: 'base form {lemma}' },
  'card.action.speak': { 'zh-CN': '朗读', en: 'Pronounce' },
  'card.action.speak_word': { 'zh-CN': '朗读这个词', en: 'Pronounce this word' },
  'card.action.speak_sentence': { 'zh-CN': '朗读原句', en: 'Read the sentence aloud' },
  'card.action.speak_example': { 'zh-CN': '朗读这句例句', en: 'Read this example aloud' },
  'card.action.close': { 'zh-CN': '关闭', en: 'Close' },
  'card.action.close_title': { 'zh-CN': '关闭 (Esc)', en: 'Close (Esc)' },
  'card.section.meaning': { 'zh-CN': '基础释义', en: 'Meaning' },
  'card.section.english': { 'zh-CN': 'English', en: 'Definition' },
  'card.section.context': { 'zh-CN': '语境含义 · 本页', en: 'In this context' },
  'card.section.source': { 'zh-CN': '原文与翻译', en: 'Original & translation' },
  'card.section.extras': { 'zh-CN': '例句 · 近义词', en: 'Examples · Synonyms' },
  'card.section.examples': { 'zh-CN': '例句', en: 'Examples' },
  'card.section.synonyms': { 'zh-CN': '近义词', en: 'Synonyms' },
  'card.state.enriching': { 'zh-CN': '正在补充', en: 'Adding more' },
  'card.state.saving': { 'zh-CN': '收藏中…', en: 'Saving…' },
  'card.state.analyzing': { 'zh-CN': 'AI 正在结合上下文分析…', en: 'AI is reading the context…' },
  'card.state.reading_context': { 'zh-CN': '正在阅读这句话的语境', en: 'Working out what it means here' },
  'card.state.failed': { 'zh-CN': '查询失败', en: 'Lookup failed' },
  'card.action.save': { 'zh-CN': '收进词卡', en: 'Save word' },
  'card.action.saved': { 'zh-CN': '已在词卡', en: 'Saved' },
  'card.action.saved_title': { 'zh-CN': '已收藏', en: 'Saved to word cards' },
  'card.action.remove': { 'zh-CN': '移出词卡', en: 'Remove' },
  'card.action.remove_title': { 'zh-CN': '从词卡中移除', en: 'Remove from word cards' },
  'card.action.review': { 'zh-CN': '去复习', en: 'Review' },
  'card.tag.offline': { 'zh-CN': '离线词典', en: 'Offline dictionary' },
  'card.action.reload': { 'zh-CN': '刷新页面', en: 'Reload page' },
  'card.action.retry': { 'zh-CN': '重试', en: 'Retry' },
  /*
   * 英文比中文长得多，而这一排要塞三个按钮进一张 360px 的卡。
   * 「Use offline dictionary」在按钮上没有歧义可言——它旁边就是「Retry」，
   * 语境已经说清了这是在选一条出路，动词是多余的。
   */
  'card.action.use_offline': { 'zh-CN': '用离线词典', en: 'Offline dictionary' },
  'card.action.settings': { 'zh-CN': '去设置', en: 'Settings' },
  'card.trigger.explain': { 'zh-CN': '解释', en: 'Explain' },
  'card.notice.updated': {
    'zh-CN': '扩展已更新，刷新页面后继续使用',
    en: 'The extension was updated. Reload the page to keep going.',
  },
  'card.toast.translating_page': { 'zh-CN': '正在翻译整页…', en: 'Translating the page…' },
  'card.toast.restored': { 'zh-CN': '已还原原文', en: 'Original text restored' },
  'card.toast.saved': { 'zh-CN': '已收藏，进入复习队列', en: 'Saved — added to your review queue' },
  'card.toast.updated': { 'zh-CN': '已更新词卡中的这条记录', en: 'Word card updated' },
  'card.toast.save_failed': { 'zh-CN': '收藏失败', en: 'Could not save' },
  'card.toast.save_failed_reason': { 'zh-CN': '收藏失败：{reason}', en: 'Could not save: {reason}' },
  'card.toast.removed': { 'zh-CN': '已从词卡移除', en: 'Removed from word cards' },

  // ── YouTube 字幕 ──────────────────────────────────────────────
  'video.control.subtitles': { 'zh-CN': '双语字幕', en: 'Bilingual subtitles' },
  'video.control.status_loading': { 'zh-CN': '双语字幕（正在准备）', en: 'Bilingual subtitles (preparing)' },
  'video.control.status_on': { 'zh-CN': '双语字幕（已开启）', en: 'Bilingual subtitles (on)' },
  'video.control.status_error': { 'zh-CN': '双语字幕（暂时不可用）', en: 'Bilingual subtitles (unavailable)' },
  'video.control.status_track': { 'zh-CN': '双语字幕 · {track}', en: 'Bilingual subtitles · {track}' },
  'video.control.display': { 'zh-CN': '显示', en: 'Display' },
  'video.control.mode_bilingual': { 'zh-CN': '双语', en: 'Both' },
  'video.control.mode_translation': { 'zh-CN': '仅译文', en: 'Translation' },
  'video.control.font_size': { 'zh-CN': '字号', en: 'Text size' },
  'video.control.size_small': { 'zh-CN': '小', en: 'Small' },
  'video.control.size_normal': { 'zh-CN': '标准', en: 'Normal' },
  'video.control.size_large': { 'zh-CN': '大', en: 'Large' },
  'video.control.background': { 'zh-CN': '背景', en: 'Background' },
  'video.control.background_none': { 'zh-CN': '无', en: 'None' },
  'video.control.background_light': { 'zh-CN': '浅', en: 'Light' },
  'video.control.background_medium': { 'zh-CN': '中', en: 'Medium' },
  'video.control.background_dark': { 'zh-CN': '深', en: 'Dark' },
  'video.control.preparing': { 'zh-CN': '正在准备…', en: 'Preparing…' },
  'video.control.source': { 'zh-CN': '字幕来源：{track}', en: 'Source: {track}' },
  'video.status.ad_playing': {
    'zh-CN': '广告播放中，结束后自动开始',
    en: 'Ad playing — subtitles start when it ends',
  },
  'video.status.waiting_video': { 'zh-CN': '正在等待视频数据…', en: 'Waiting for video data…' },
  'video.status.loading_track': { 'zh-CN': '正在读取字幕…', en: 'Loading subtitles…' },
  'video.error.bridge_timeout': { 'zh-CN': '页面脚本没有响应', en: 'The page script did not respond' },
  'video.error.no_track': { 'zh-CN': '这个视频没有可用的字幕轨', en: 'No usable subtitle track on this video' },
  'video.error.empty_track': {
    'zh-CN': '取到的字幕是空的，稍后重试',
    en: 'The subtitles came back empty. Try again in a moment.',
  },
  'video.error.http_status': {
    'zh-CN': '字幕接口返回 {status}',
    en: 'The subtitle request returned {status}',
  },
  'video.error.blocked': {
    'zh-CN': '被 YouTube 拦下了，刷新页面重试',
    en: 'YouTube blocked the request. Refresh the page and try again.',
  },
  'video.error.empty_repeated': {
    'zh-CN': '字幕接口一直返回空内容，刷新页面后重试',
    en: 'The subtitle request keeps coming back empty. Refresh the page and try again.',
  },
  'video.error.orphaned': {
    'zh-CN': '扩展已更新，刷新页面后继续',
    en: 'The extension was updated. Refresh the page to continue.',
  },
  'video.track.auto_generated': { 'zh-CN': '{label}（自动生成）', en: '{label} (auto-generated)' },

  // ── 语言名 ────────────────────────────────────────────────────────────
  'language.source.auto': { 'zh-CN': '自动识别', en: 'Auto-detect' },
  'language.source.en': { 'zh-CN': '英语 English', en: 'English' },
  'language.source.ja': { 'zh-CN': '日语 日本語', en: 'Japanese' },
  'language.source.ko': { 'zh-CN': '韩语 한국어', en: 'Korean' },
  'language.source.de': { 'zh-CN': '德语 Deutsch', en: 'German' },
  'language.source.fr': { 'zh-CN': '法语 Français', en: 'French' },
  'language.source.es': { 'zh-CN': '西班牙语 Español', en: 'Spanish' },
  'language.source.ru': { 'zh-CN': '俄语 Русский', en: 'Russian' },
  'language.target.zh_cn': { 'zh-CN': '简体中文', en: 'Simplified Chinese' },
  'language.target.zh_tw': { 'zh-CN': '繁體中文', en: 'Traditional Chinese' },
  'language.target.en': { 'zh-CN': 'English', en: 'English' },
  'language.target.ja': { 'zh-CN': '日本語', en: 'Japanese' },
  'language.target.ko': { 'zh-CN': '한국어', en: 'Korean' },
  'language.target.de': { 'zh-CN': 'Deutsch', en: 'German' },
  'language.target.fr': { 'zh-CN': 'Français', en: 'French' },
  'language.target.es': { 'zh-CN': 'Español', en: 'Spanish' },
  'language.target.ru': { 'zh-CN': 'Русский', en: 'Russian' },

  // ── 错误与提示 ────────────────────────────────────────────────────────
  'error.ai.no_api_key': {
    'zh-CN': '还没有配置 API Key，正在使用离线词典模式',
    en: 'No API key yet — using the offline dictionary',
  },
  'error.ai.auth': {
    'zh-CN': 'API Key 无效或已过期，请到设置页检查',
    en: 'That API key is invalid or expired. Check it in Settings.',
  },
  'error.ai.rate_limit': {
    'zh-CN': '请求过于频繁，请稍后再试',
    en: 'Too many requests. Try again in a moment.',
  },
  'error.ai.network': {
    'zh-CN': '网络连接失败，请检查网络或代理',
    en: 'Could not connect. Check your network or proxy.',
  },
  'error.ai.timeout': { 'zh-CN': '请求超时，请重试', en: 'The request timed out. Try again.' },
  'error.ai.bad_response': {
    'zh-CN': 'AI 返回的内容无法解析，请重试',
    en: 'The model\'s reply could not be read. Try again.',
  },
  'error.ai.refused': { 'zh-CN': '模型拒绝解释这段内容', en: 'The model declined to explain this text' },
  'error.ai.aborted': { 'zh-CN': '请求已取消', en: 'Request cancelled' },
  'error.ai.stale_context': {
    'zh-CN': '扩展刚刚更新过，这个页面上的旧脚本已失效——刷新页面即可恢复',
    en: 'The extension was just updated, so this page is still running the old script. Reload the page to fix it.',
  },
  'error.ai.unknown': { 'zh-CN': '出现未知错误，请重试', en: 'Something went wrong. Try again.' },
  'error.sync.no_token': { 'zh-CN': '还没有填写 GitHub Token', en: 'No GitHub token yet' },
  'error.sync.auth': {
    'zh-CN': 'Token 无效或已过期，请重新生成',
    en: 'That token is invalid or expired. Generate a new one.',
  },
  'error.sync.forbidden': {
    'zh-CN': 'Token 权限不足：需要能创建仓库并读写内容（classic token 勾选 repo）',
    en: 'The token lacks permission: it needs to create repositories and read and write their contents (tick `repo` on a classic token).',
  },
  'error.sync.not_found': {
    'zh-CN': '找不到该仓库，或 Token 没有访问它的权限',
    en: 'Repository not found, or this token cannot reach it',
  },
  'error.sync.rate_limit': {
    'zh-CN': 'GitHub 接口调用过于频繁，请稍后再试',
    en: 'Too many GitHub API calls. Try again in a moment.',
  },
  'error.sync.conflict': {
    'zh-CN': '远端在同步过程中被改动了，请再同步一次',
    en: 'The remote changed mid-sync. Sync again.',
  },
  'error.sync.stale_head': {
    'zh-CN': '另一台设备刚刚推送过，正在基于最新内容重试',
    en: 'Another device just pushed. Retrying on top of the latest commit.',
  },
  'error.sync.network': {
    'zh-CN': '无法连接 GitHub，请检查网络或代理',
    en: 'Could not reach GitHub. Check your network or proxy.',
  },
  'error.sync.timeout': { 'zh-CN': '连接 GitHub 超时', en: 'The GitHub request timed out' },
  'error.sync.unknown': { 'zh-CN': 'GitHub 同步失败', en: 'GitHub sync failed' },
  'error.http.empty_body': {
    'zh-CN': '{provider} 返回了空的响应体（HTTP {status}）——通常是连接被中断',
    en: '{provider} returned an empty body (HTTP {status}) — usually a dropped connection',
  },
  'error.http.content_type_missing': { 'zh-CN': '未标注', en: 'not stated' },
  'error.http.html_instead_of_json': {
    'zh-CN': '返回的是网页而不是接口响应，通常意味着 API 地址填错了，或请求被网关/代理拦下',
    en: 'a web page came back instead of an API response, which usually means the API URL is wrong or a gateway or proxy blocked the request',
  },
  'error.http.not_json': {
    'zh-CN': '{provider} 的响应不是 JSON（{hint}）：{body}',
    en: '{provider} did not return JSON ({hint}): {body}',
  },
  'error.schema.field_mismatch': {
    'zh-CN': '模型返回的字段与约定不符：{body}',
    en: 'The model\'s fields do not match the agreed shape: {body}',
  },
  'error.host.invalid_url': { 'zh-CN': 'API 地址不是有效的网址', en: 'That API address is not a valid URL' },
  'error.host.https_required': {
    'zh-CN': 'API 地址必须使用 HTTPS；本机调试可使用 http://localhost',
    en: 'The API address must use HTTPS; http://localhost is allowed for local development',
  },
  'error.host.not_granted': {
    'zh-CN': '未授权访问 {origin}，无法连接这个 API 地址',
    en: 'Access to {origin} was not granted, so this API address cannot be used',
  },
  'error.provider.no_key_offline': {
    'zh-CN': '{provider} 尚未填写 API Key，已使用离线词典',
    en: 'No API key for {provider} yet — using the offline dictionary',
  },
  'error.provider.bad_config_offline': {
    'zh-CN': '{provider} 配置有误（{reason}），已使用离线词典',
    en: '{provider} is misconfigured ({reason}) — using the offline dictionary',
  },
  'error.provider.token_budget_spent': {
    'zh-CN': '模型在写出答案前就用尽了 {limit} 个输出 token（finish_reason=length，已生成 {used} 个）。这通常意味着该模型是推理型模型，请在设置页换一个更快的模型，或改用其它服务商。',
    en: 'The model used up all {limit} output tokens before writing an answer (finish_reason=length, {used} generated). That usually means it is a reasoning model — pick a faster model in Settings, or switch provider.',
  },
  'error.provider.no_content': {
    'zh-CN': '模型没有返回任何内容（finish_reason={reason}{note}）',
    en: 'The model returned nothing (finish_reason={reason}{note})',
  },
  'error.provider.reasoning_no_json': {
    'zh-CN': '，但返回了推理内容且其中没有 JSON',
    en: ', but sent reasoning content with no JSON in it',
  },
  'error.messaging.no_response': {
    'zh-CN': '扩展后台未响应，请刷新页面重试',
    en: 'The extension background did not respond. Reload the page and try again.',
  },
  'error.messaging.empty_reply': { 'zh-CN': '后台没有返回结果', en: 'The background returned no result' },
  'error.sync.repo_missing': {
    'zh-CN': '仓库 {repo} 不存在，请先点「连接并创建仓库」',
    en: 'Repository {repo} does not exist. Use "Connect and create repository" first.',
  },
  'error.sync.bad_json_pull': {
    'zh-CN': '远端 {path} 不是合法 JSON，已停止同步以免覆盖它',
    en: 'Remote {path} is not valid JSON. Sync stopped so it does not get overwritten.',
  },
  'error.sync.bad_json_force_pull': {
    'zh-CN': '远端 {path} 不是合法 JSON，已停止以免误删本地词卡',
    en: 'Remote {path} is not valid JSON. Stopped, so no local word cards are deleted by mistake.',
  },
  'error.sync.remote_empty': {
    'zh-CN': '远端仓库里没有读到任何词卡，已中止「用远端覆盖本地」以免清空本机。请先确认仓库内容，或改用「用本地覆盖远端」。',
    en: 'No word cards were found in the remote repository, so "Overwrite local with remote" was cancelled rather than emptying this device. Check what the repository holds, or use "Overwrite remote with local" instead.',
  },
  'error.sync.head_moved': {
    'zh-CN': '远端已前进，需要基于最新内容重新合并',
    en: 'The remote has moved on; the merge has to be redone against the latest commit',
  },

  // ── 时间 ──────────────────────────────────────────────────────────────
  'time.just_now': { 'zh-CN': '刚刚', en: 'Just now' },
  'time.minutes_ago': { 'zh-CN': '{count} 分钟前', en: '{count} min ago' },
  'time.hours_ago': { 'zh-CN': '{count} 小时前', en: '{count} hr ago' },
  'time.yesterday': { 'zh-CN': '昨天', en: 'Yesterday' },
  'time.days_ago': { 'zh-CN': '{count} 天前', en: '{count} days ago' },
  'time.due.now': { 'zh-CN': '待复习', en: 'Due now' },
  'time.due.later_today': { 'zh-CN': '今天稍后', en: 'Later today' },
  'time.due.tomorrow': { 'zh-CN': '明天', en: 'Tomorrow' },
  'time.due.in_days': { 'zh-CN': '{count} 天后', en: 'In {count} days' },

  // ── 服务商 ────────────────────────────────────────────────────────────
  'provider.badge.recommended': { 'zh-CN': '推荐', en: 'Recommended' },
  'provider.badge.free': { 'zh-CN': '免费', en: 'Free' },
  'provider.label.custom': { 'zh-CN': '自定义', en: 'Custom' },
  'provider.label.offline_dict': { 'zh-CN': '离线词典', en: 'Offline dictionary' },

  // ── 其它 ────────────────────────────────────────────────────────────────
  'reminder.notification.title': {
    'zh-CN': '有 {count} 张卡片等你复习',
    en: '{count} cards are due for review',
  },
  'reminder.notification.progress': {
    'zh-CN': '今天已复习 {done} 张，还差 {remaining} 张到目标。',
    en: '{done} reviewed today — {remaining} to go to hit your goal.',
  },
  'reminder.notification.start': {
    'zh-CN': '花几分钟，把今天遇到的词变成记得住的词。',
    en: 'Spend a few minutes turning the words you met today into words you remember.',
  },
  'background.menu.explain': { 'zh-CN': '用 {name} 解释「%s」', en: 'Explain “%s” with {name}' },
  'data.import.bad_format': {
    'zh-CN': '文件格式不正确：不是 {name} 导出的知识库',
    en: 'Wrong file format — this was not exported by {name}.',
  },
  'data.import.missing_entries': {
    'zh-CN': '文件缺少 entries 字段',
    en: 'The file is missing its “entries” field.',
  },

  // ── 翻翻模式 ────────────────────────────────────────────────────────────
  'fanfan.mode.title': { 'zh-CN': '翻翻模式', en: 'FanFan mode' },
  'fanfan.mode.aria': { 'zh-CN': '翻翻模式开关', en: 'FanFan mode' },
  'fanfan.mode.hint_on': {
    'zh-CN': '标出网页上你收藏过的词，点开就看',
    en: 'Marks words you have saved — click to review'
  },
  'fanfan.mode.hint_off': {
    'zh-CN': '开启后标出网页上你收藏过的词',
    en: 'Marks the words you have saved on any page'
  },
  /* 一排两个开关时用的短标题。 */
  'fanfan.mode.short': { 'zh-CN': '翻翻模式', en: 'FanFan mode' },
  'fanfan.mastered.title': { 'zh-CN': '标出已掌握的词', en: 'Mark mastered words' },
  'fanfan.mastered.aria': { 'zh-CN': '标出已掌握的词', en: 'Mark mastered words' },
  'fanfan.mastered.hint_on': {
    'zh-CN': '四个熟悉度都标：陌生最显眼，掌握只剩一层浅灰',
    en: 'All four levels are marked — boldest when new, a faint grey once mastered',
  },
  'fanfan.mastered.hint_off': {
    'zh-CN': '掌握了的词不再标出来，读得越久页面越干净',
    en: 'Mastered words are left alone, so pages get cleaner as you learn',
  },
  'fanfan.options.hint': {
    'zh-CN': '把你词库里的词在网页上标出来，点一下直接看释义、近义词和例句——都是收藏时就存好的，不再调用 AI，也不花额度。只认完全一样的词形：收藏了 migration，页面上的 migrations 不会标。',
    en: 'Marks words from your library on any page. Click one to see its meaning, synonyms and examples — all saved when you first looked it up, so nothing is sent to a model and nothing is billed. Exact forms only: saving “migration” will not mark “migrations”.'
  },
  'card.action.save_title': { 'zh-CN': '收进词卡', en: 'Save to word cards' },
  'card.action.unsave_title': { 'zh-CN': '从词卡里移出', en: 'Remove from word cards' },
  'fanfan.card.saved': { 'zh-CN': '已收藏', en: 'In your library' },
  /*
   * 「例句与翻译」，不是「原文与翻译」。
   *
   * 划词卡上那一段是**这一页此刻**的句子，所以叫原文。翻翻模式点开时，
   * 那句话来自当初收藏它的地方，和眼前这一页毫无关系——继续叫「原文」
   * 会让读者以为说的是他正在读的这句。
   */
  'fanfan.card.section.source': { 'zh-CN': '例句与翻译', en: 'Example & translation' },
  'fanfan.card.source_from': { 'zh-CN': '来自 {title}', en: 'From {title}' },
  'fanfan.card.open_book': { 'zh-CN': '在词卡里打开', en: 'Open in word cards' },
  'fanfan.card.enriching': { 'zh-CN': '正在补上缺的内容…', en: 'Filling in what is missing…' },
  'fanfan.card.enrich_failed': {
    'zh-CN': '这次没补到新内容。重新划一次这个词可以再试。',
    en: 'Nothing new came back. Look the word up again to retry.',
  },
  'fanfan.card.empty': {
    'zh-CN': '这张卡还没有释义、例句或近义词。',
    en: 'This card has no meaning, examples or synonyms yet.'
  },


  // ── 词性 ────────────────────────────────────────────────────────────────
  'pos.noun': { 'zh-CN': '名词', en: 'noun' },
  'pos.verb': { 'zh-CN': '动词', en: 'verb' },
  'pos.adjective': { 'zh-CN': '形容词', en: 'adjective' },
  'pos.adverb': { 'zh-CN': '副词', en: 'adverb' },
  'pos.pronoun': { 'zh-CN': '代词', en: 'pronoun' },
  'pos.preposition': { 'zh-CN': '介词', en: 'preposition' },
  'pos.conjunction': { 'zh-CN': '连词', en: 'conjunction' },
  'pos.interjection': { 'zh-CN': '感叹词', en: 'interjection' },
  'pos.determiner': { 'zh-CN': '限定词', en: 'determiner' },
  'pos.numeral': { 'zh-CN': '数词', en: 'numeral' },
  'pos.phrase': { 'zh-CN': '短语', en: 'phrase' },

} as const satisfies Record<string, Entry>

export type MessageKey = keyof typeof MESSAGES
