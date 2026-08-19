import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/components/ui.css'
import { initStorage } from '@/storage/migrations.ts'
import { Options } from './Options.tsx'

void initStorage()

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root')

createRoot(container).render(
  <StrictMode>
    <Options />
  </StrictMode>,
)
