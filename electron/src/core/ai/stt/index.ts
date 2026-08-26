// STT Provider 工厂 + 类型
import { apiConfig } from '../../api-config'
import { WhisperProvider } from './whisper'
import { DoubaoProvider } from './doubao'
import { AliyunProvider } from './aliyun'
import type { SttProvider } from './base'

export type { SttProvider, AudioMeta, SttResult } from './base'

export type SttProviderName = 'whisper' | 'doubao' | 'aliyun' | 'auto'

const providers: Record<string, SttProvider> = {
  whisper: new WhisperProvider(),
  doubao: new DoubaoProvider(),
  aliyun: new AliyunProvider(),
}

/** 根据设置项返回当前应该使用的 provider（auto 时回退到第一个可用的） */
export function getActiveProvider(): { provider: SttProvider; name: string } {
  const configured = apiConfig.sttEngine
  if (configured && configured !== 'auto' && providers[configured]) {
    return { provider: providers[configured], name: configured }
  }
  // auto：按 doubao → aliyun → whisper 顺序找第一个配好的
  for (const n of ['doubao', 'aliyun', 'whisper']) {
    if (providers[n].isConfigured()) return { provider: providers[n], name: n }
  }
  // 都未配置：返回 doubao（会抛错由 UI 引导用户配置）
  return { provider: providers.doubao, name: 'doubao' }
}

/** 便利函数：转写 */
export async function transcribe(audioBase64: string, meta: { mimeType: string; sampleRate?: number; channels?: number }) {
  const { provider, name } = getActiveProvider()
  if (!provider.isConfigured()) {
    throw new Error(`未配置 STT（当前候选 ${name}）。请在设置页 → 语音转写 选择引擎并填入 API Key`)
  }
  return provider.transcribe(audioBase64, meta)
}
