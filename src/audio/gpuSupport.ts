/** Network/model fetch failures must not trigger a second model download. */
export function isGPUInitializationFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  if (/fetch|network|download|HTTP|status code|ERR_|not found|unauthorized|forbidden/i.test(message)) return false
  return /webgpu|GPUDevice|GPUAdapter|shader|adapter|device lost|device was lost|GPU validation|no available backend/i.test(message)
}

export type ASRGPUAdapter = { features: { has(name: string): boolean } }
export async function getASRGPUAdapter(gpu: { requestAdapter(): Promise<ASRGPUAdapter | null> } | undefined): Promise<ASRGPUAdapter | null> {
  if (!gpu) return null
  try {
    const adapter = await gpu.requestAdapter()
    return adapter?.features.has('shader-f16') ? adapter : null
  } catch { return null }
}
