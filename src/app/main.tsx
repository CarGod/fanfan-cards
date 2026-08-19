import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/components/ui.css'
import { warmUpVoices } from '@/services/speech.ts'
import { initStorage } from '@/storage/migrations.ts'
import { App } from './App.tsx'

void initStorage()
warmUpVoices()

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
