import { useCallback, useSyncExternalStore } from 'react'
import { currentLanguage, onLanguageChange, t } from './index.ts'
import type { MessageKey } from './messages.ts'
import type { ResolvedLanguage } from './types.ts'

/**
 * 让组件跟着界面语言重渲染。
 *
 * 用 `useSyncExternalStore` 而不是 useState + useEffect：语言是模块级的单一事实，
 * 切换的那一刻所有挂载中的组件必须一起变。走 effect 会出现「设置页已经是英文、
 * 后面那个面板还是中文」的半拉状态。
 */
export function useI18n(): {
  t: (key: MessageKey, params?: Record<string, string | number>) => string
  language: ResolvedLanguage
} {
  const language = useSyncExternalStore(onLanguageChange, currentLanguage, currentLanguage)
  // language 进依赖是故意的：它变了才需要一个新的 t，组件也才会重渲染。
  const translate = useCallback(
    (key: MessageKey, params?: Record<string, string | number>) => t(key, params),
    [language],
  )
  return { t: translate, language }
}
