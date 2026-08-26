/**
 * 阿里云百炼 Paraformer 语音识别 Provider
 * - REST API：https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription
 * - 走 OpenAI 兼容模式（Paraformer ASR 的 REST 端点）
 * - 文档：https://help.aliyun.com/zh/model-studio/paraformer-speech-recognition-api
 * 音频要求：PCM/WAV/MP3/OPUS/SPEEX/AMR，≤ 10MB，≤ 60s
 */
import { apiConfig } from '../../api-config'
import { Buffer } from 'node:buffer'
import type { AudioMeta, SttProvider, SttResult } from './base'

const DEFAULT_BASE = 'https://dashscope.aliyuncs.com/api/v1'

export class AliyunProvider implements SttProvider {
  readonly name = 'aliyun'

  isConfigured(): boolean {
    return !!apiConfig.sttApiKey.trim()
  }

  async transcribe(audioBase64: string, meta: AudioMeta): Promise<SttResult> {
    if (!this.isConfigured()) {
      throw new Error('阿里云百炼未配置：请在设置页填入 DashScope API Key')
    }
    const apiKey = apiConfig.sttApiKey.trim()
    const baseUrl = (apiConfig.sttBaseUrl.trim() || DEFAULT_BASE).replace(/\/+$/, '')
    const model = apiConfig.sttModel.trim() || 'paraformer-v2'

    const buf = Buffer.from(audioBase64, 'base64')
    if (buf.length > 10 * 1024 * 1024) {
      throw new Error('阿里云 Paraformer 单次音频上限 10MB，请使用更短的录音')
    }

    const url = `${baseUrl}/services/audio/asr/transcription`
    const t0 = Date.now()
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: { file_urls: undefined, file_base64: audioBase64 },
        parameters: {
          language_hints: ['zh', 'en'],
          format: 'pcm',  // 兼容 PCM / WAV / MP3
          sample_rate: 16000,
        },
      }),
    })
    if (!resp.ok) {
      const t = await resp.text().catch(() => '')
      throw new Error(`阿里云 Paraformer ${resp.status}: ${t.slice(0, 200)}`)
    }
    const json: any = await resp.json()
    // 响应结构：output.text / output.words / output.sentences
    const text: string = json?.output?.text
      || (Array.isArray(json?.output?.sentences)
          ? json.output.sentences.map((s: any) => s.text || '').join('')
          : '')
      || (Array.isArray(json?.output?.words)
          ? json.output.words.map((w: any) => w.text || '').join('')
          : '')
    if (!text) {
      throw new Error('阿里云 Paraformer 返回为空：' + JSON.stringify(json).slice(0, 200))
    }
    return { text: text.trim(), durationMs: Date.now() - t0 }
  }
}
