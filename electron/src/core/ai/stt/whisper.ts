/**
 * OpenAI Whisper / 兼容协议 STT Provider
 * 走标准 OpenAI audio.transcriptions 接口（multipart/form-data）
 * 兼容：OpenAI 官方、Azure OpenAI、one-api/new-api 中转、智谱、硅基流动等
 */
import { apiConfig } from '../../api-config'
import type { AudioMeta, SttProvider, SttResult } from './base'

export class WhisperProvider implements SttProvider {
  readonly name = 'whisper'

  isConfigured(): boolean {
    return !!apiConfig.llmApiKey.trim() || !!apiConfig.sttApiKey.trim()
  }

  async transcribe(audioBase64: string, meta: AudioMeta): Promise<SttResult> {
    if (!this.isConfigured()) {
      throw new Error('Whisper 未配置：请在设置页填入 API Key（或复用 LLM Key）')
    }
    const apiKey = apiConfig.sttApiKey.trim() || apiConfig.llmApiKey.trim()
    const baseUrl = apiConfig.sttBaseUrl.trim() || apiConfig.llmBaseUrl.trim() || 'https://api.openai.com/v1'
    const model = apiConfig.sttModel.trim() || 'whisper-1'
    const url = `${baseUrl.replace(/\/+$/, '')}/audio/transcriptions`

    const buf = Buffer.from(audioBase64, 'base64')
    const ext = pickExt(meta.mimeType)
    const blob = new Blob([buf], { type: meta.mimeType || 'audio/webm' })
    const form = new FormData()
    form.append('file', blob, 'audio.' + ext)
    form.append('model', model)
    form.append('language', 'zh')
    form.append('response_format', 'json')

    const t0 = Date.now()
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      throw new Error(`Whisper ${resp.status} ${resp.statusText}: ${errText.slice(0, 200)}`)
    }
    const json: any = await resp.json()
    const text = (json?.text || '').trim()
    return { text, durationMs: Date.now() - t0 }
  }
}

function pickExt(mime: string): string {
  const m = (mime || '').toLowerCase()
  if (m.includes('mp4') || m.includes('m4a')) return 'mp4'
  if (m.includes('ogg')) return 'ogg'
  if (m.includes('mp3') || m.includes('mpeg')) return 'mp3'
  if (m.includes('wav')) return 'wav'
  if (m.includes('flac')) return 'flac'
  return 'webm'
}
