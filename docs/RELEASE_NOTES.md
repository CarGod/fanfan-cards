# Release notes

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
