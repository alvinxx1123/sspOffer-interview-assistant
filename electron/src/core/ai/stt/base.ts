// STT Provider 抽象接口
// - transcribe: 一次性转写整段音频
// - audioMeta: 提示 provider 音频格式（mimeType / sampleRate / channels）
export interface AudioMeta {
  /** 音频 MIME，如 audio/webm、audio/ogg、audio/wav、audio/mp3 */
  mimeType: string
  /** 原始音频采样率（Hz）。原始 PCM 时必填；压缩格式可不填 */
  sampleRate?: number
  /** 声道数（1=mono, 2=stereo） */
  channels?: number
}

export interface SttResult {
  text: string
  /** 调试用：识别耗时 ms */
  durationMs?: number
}

export interface SttProvider {
  readonly name: string  // 'whisper' | 'doubao' | 'aliyun'
  /** 该 provider 是否已配置好（key/URL 等） */
  isConfigured(): boolean
  /** 转写整段音频 */
  transcribe(audioBase64: string, meta: AudioMeta): Promise<SttResult>
}
