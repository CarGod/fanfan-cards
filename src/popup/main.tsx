import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/components/ui.css'
import { Popup } from './Popup.tsx'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root')

createRoot(container).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
)
