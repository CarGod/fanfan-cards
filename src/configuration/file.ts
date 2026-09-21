import { downloadText } from '@/services/exportService.ts'
import { CONFIG_FILENAME, MAX_FILE_BYTES, getDocument, parseConfigText } from './document.ts'
import { importConfiguration } from './service.ts'

/** Both settings entry points use exactly the same settings-only JSON format. */
export async function downloadConfiguration(): Promise<void> {
  downloadText(`fanfan-${CONFIG_FILENAME}`, JSON.stringify(await getDocument(), null, 2))
}

export async function importConfigurationFile(file: File): Promise<void> {
  if (file.size > MAX_FILE_BYTES) throw new Error('Configuration file too large')
  await importConfiguration(parseConfigText(await file.text()))
}
