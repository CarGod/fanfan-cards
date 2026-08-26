import { getSettings, watchSettings } from '@/storage/repositories/settingsRepo.ts'
import { setLanguage } from './index.ts'

/**
 * 把界面语言接到设置上。
 *
 * 每个入口（popup / options / app / 内容脚本 / background）在渲染之前 await 一次。
 * 不 await 的话，选了英文的读者每次开面板都会先看见一帧中文再跳过去——那一帧
 * 会让人以为设置没保存。
 *
 * 之后交给 `watchSettings`：设置页改一下，已经开着的词卡页和网页上的划词卡
 * 同时跟着变，不用刷新。
 */
export async function initI18n(): Promise<void> {
  try {
    const settings = await getSettings()
    setLanguage(settings.uiLanguage)
  } catch {
    // 读不到设置就先用浏览器语言顶着，别让整个入口卡在这里。
  }
  watchSettings((settings) => setLanguage(settings.uiLanguage))
}
