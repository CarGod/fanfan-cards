import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/components/ui.css'
import { initI18n } from '@/i18n/bootstrap.ts'
import { Popup } from './Popup.tsx'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root')

/*
 * 先把界面语言定下来再渲染。
 *
 * 不等的话，选了英文的读者每次都会先看见一帧中文再跳过去——那一帧会让人以为
 * 设置没保存。这里多等的是一次 chrome.storage 读取，几毫秒。
 */
void initI18n().then(() => {
  createRoot(container).render(
    <StrictMode>
      <Popup />
    </StrictMode>,
  )
})
