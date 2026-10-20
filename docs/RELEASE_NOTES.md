# Release notes

## 2.5.0

### 简体中文

- 修复升级后 AI 密钥、GitHub 连接等配置丢失：某一项设置无法读取时只影响这一项；保存和配置同步只写入实际改动，不再用默认值覆盖其他设置。
- 已在本机保存过 AI 密钥或 GitHub Token 的安装，升级后直接进入原有设置，不再显示首次设置引导。
- 每次升级前在本机保留一份设置副本；升级后如果 AI 密钥或 GitHub 连接缺失，设置页顶部可一键恢复升级前的配置。

### English

- Fix AI keys, the GitHub connection and other settings going missing after an update. A setting that cannot be read now affects only itself, and saves and configuration sync write only actual changes instead of overwriting other settings with defaults.
- Installations that already saved an AI key or GitHub token open their existing settings after an update instead of first-time setup.
- Settings are copied locally before each update. If an AI key or the GitHub connection is missing afterwards, the settings page offers to restore the settings from before the update.

### Permissions and privacy

No new extension permissions, host permissions, data categories, or data recipients. The pre-update copy of settings, including keys, stays in the browser's local extension storage: it is not written to the configuration file or browser sync, not exported, and not sent anywhere. The privacy policy now describes this copy.

## 2.4.1

### 简体中文

- 在「设置 → 视频翻译」新增「允许 AI 听译」开关，默认关闭；开启后仍需点击无字幕视频上的听译按钮才采集播放器音频。关闭开关会停止当前听译。
- AI 听译默认使用 Base 本地 GPU 识别（首次模型下载约 85 MB）；GPU 不可用时回退 Tiny 本地 CPU 识别。改进多线程性能，修复旧 GPU 运行时的数值异常，并避免下载失败反复切换模型。
- 视频字幕与语音按实际语言翻译，不再限制为英语。可靠识别为目标语言时静默跳过，保留手动字幕轨偏好。
- 修复全屏视频中长期残留或重复的「字幕准备中」提示，改进停止、重启和设置切换时的取消处理。

### English

- Add an opt-in Enable AI listening switch under Video subtitles. It is off by default; users must still click the listening button on a video without subtitles to capture player audio. Turning the setting off stops listening.
- Prefer local Base GPU speech recognition (about 85 MB on first model download), with local Tiny CPU fallback when GPU support is unavailable. Improve CPU threading, fix numerical errors in the previous GPU runtime, and avoid repeated model switching after download failures.
- Translate captions and speech in their actual language rather than restricting them to English. Silently skip content reliably identified as the target language while retaining preferred caption-track selection.
- Fix persistent or duplicate preparing-subtitles indicators in full-screen video, and improve cancellation when stopping, restarting, or changing settings.

### Review and privacy notes

Player audio stays in local memory and is recognized locally; no microphone is used. Recognition text, recent textual context and the page title may be sent to the user's configured AI service for correction and translation. Fixed-revision model data is fetched from Hugging Face and cached; executable JavaScript and WebAssembly are packaged with the extension. The feature is disabled by default and requires an explicit player action after enabling. Existing host/extension permissions are retained relative to the repository's 2.4.0 manifest; reviewers comparing an older store version should review `offscreen` and the Hugging Face model-download hosts. Speech recognition can still make errors, especially on short or mixed-language clips; no universal accuracy or real-time guarantee is claimed.

## 2.3.3

### 简体中文

- 首次设置先选择配置目录：已有配置自动恢复，空目录进入初次配置；后续修改自动保存。浏览器账号同步、文件导入和仅本机配置仍可在「其他方式」中选择，已有安装保留原配置方式。
- 双语字幕按同一组完整原文与译文配对显示，保留原字幕时间窗和静音间隙，并修正重叠字幕边界。
- 防止 AI 译文重复附带整段原文，并修复已有翻译缓存中的此类重复，无需再次请求模型。

### English

- First-time setup starts with choosing a configuration folder: restore existing settings or configure a new empty folder, then save changes automatically. Browser account sync, file import, and local-only setup remain available under Other methods. Existing installations retain their selected mode.
- Bilingual captions now pair each translated group with the same complete source text, preserving caption windows and silent gaps while correcting overlapping boundaries.
- Prevent complete source passages from being repeated beside AI translations and repair affected cached translations without another model request.

### Permissions and privacy

No new extension permissions, host permissions, data categories, or data recipients. First-time setup now asks users to choose a configuration destination instead of enabling browser account sync by default. The privacy documentation and store copy reflect this behavior; existing sync choices are preserved.

## 2.3.2

### 简体中文

- 保留 X 等页面通过 CSS 显示的文本换行和空行，修复两段原文被压成一行译文的问题；可见分段变化也会触发译文更新。
- 译文跟随原文的字号和行高；原有网址恢复为可点击链接，并保留页面显示的链接文字。仅使用原文中的安全链接，不将模型返回内容当作 HTML 执行。

### English

- Preserve visible text newlines and blank lines on pages such as X, including updates that only change paragraph breaks.
- Match source typography and restore existing safe links with their original display labels. Model output remains text, never executable HTML.

## 2.3.1

### 简体中文

- X / Twitter 整页和段落翻译跳过作者名、推荐用户和直播主持人的身份标签，保留帖子正文、短评论和正文中的提及。
- 不再插入仅多出批次编号的重复译文，例如 `[1] Tibo`。
- 整页翻译遇到临时消息通道中断时最多重试一次；扩展重载导致旧页面脚本失效时停止请求并提示刷新，不将临时断连误判为永久失效。

### English

- Skip identity labels for authors, suggested users, and live hosts on X / Twitter while preserving post text, short replies, and inline mentions.
- Suppress duplicate translations that only add a batch number, such as `[1] Tibo`.
- Retry interrupted page-translation messaging once while the extension context remains valid. Stop and request a refresh when an extension reload invalidates the old page script.

## 2.3.0

### 简体中文

- 双语字幕默认显示英语原文和简体中文译文，可在视频翻译设置或播放器菜单中修改源语言和目标语言。YouTube 缺少所选语言字幕时会明确提示，避免误选其他语言。
- 改进跨设备配置接收：设置页可见时约每 15 秒检查所选目录，后台约每分钟检查，切回浏览器也会检查。iCloud 下载和浏览器休眠仍可能延迟更新。
- 新增恢复已有目录授权入口；授权恢复后自动同步待保存的修改，并明确区分目录同步与一次性文件导入。

### English

- Bilingual subtitles now default to English with Simplified Chinese translation. Choose source and target languages in video settings or the player menu. YouTube clearly reports when subtitles in the selected language are unavailable instead of choosing another language.
- Configuration updates from other devices are checked about every 15 seconds while settings are visible, every minute in the background, and when returning to the browser. iCloud downloads and browser sleep may still delay updates.
- Restore access to a previously selected folder and resume saving pending changes. Folder synchronization and one-time file imports are now clearly distinguished.

### Permissions and privacy

No new extension permissions, host permissions, data categories, or data recipients. Folder access remains user-authorized; iCloud file transfer is handled by the operating system. The existing privacy policy continues to apply.
