/**
 * 界面语言。
 *
 * 和 `targetLanguage` 是两件事，别混：`targetLanguage` 决定 AI 把解释**写成**哪种语言，
 * 是内容；这里决定按钮上印的是「收藏」还是「Save」，是外壳。一个读者完全可能想要
 * 英文界面配中文解释——他在练英语，但不想在界面上练。
 */
export type UiLanguage = 'auto' | 'zh-CN' | 'en'

/** `auto` 解析之后只剩这两种。 */
export type ResolvedLanguage = 'zh-CN' | 'en'

export const UI_LANGUAGES: ReadonlyArray<{ code: UiLanguage; label: string }> = [
  { code: 'auto', label: '跟随浏览器 / Follow browser' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'en', label: 'English' },
]
