import { useState, useEffect, useRef, useCallback } from 'react'

// 语音转文字多引擎：
//   - Web Speech API（默认，浏览器内置，免费，需联网 Google STT，国内受限）
//   - 字节豆包 ASR（WebSocket + 二进制 PCM，国产推荐，永久免费额度）
//   - 阿里云百炼 Paraformer（REST + JSON，国产，免费额度大）
//   - OpenAI Whisper（OpenAI 兼容协议，海外/中转）
//
// 录音格式策略：
//   - Web Speech：浏览器实时识别，无中间格式
//   - 其他三个：MediaRecorder 录 webm/opus → Web Audio API 解码 → 重采样 16kHz/mono/Int16 PCM
//     （豆包要求 PCM；阿里云/Whisper 接受 base64，自动透传）

const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI?.ipc)

function ipcInvoke(channel, payload) {
  if (!window.electronAPI?.ipc) return Promise.reject(new Error('IPC 不可用'))
  return window.electronAPI.ipc(channel, payload)
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const r = reader.result || ''
      const m = /^data:([^;]+);base64,(.*)$/.exec(r)
      if (!m) return reject(new Error('base64 解析失败'))
      resolve({ mimeType: m[1], data: m[2] })
    }
    reader.onerror = () => reject(new Error('读取录音失败'))
    reader.readAsDataURL(blob)
  })
}

// 用 OfflineAudioContext 把任意 webm/opus/mp3 解码并重采样为 16kHz/mono/Int16 PCM
async function decodeToPcm16kMono(blob) {
  if (typeof window === 'undefined' || typeof (window.AudioContext || window.webkitAudioContext) !== 'function') {
    throw new Error('当前环境不支持 Web Audio API（Electron 内核应该自带）')
  }
  const arrayBuf = await blob.arrayBuffer()
  const AC = window.AudioContext || window.webkitAudioContext
  const tmpCtx = new AC()
  let audio
  try {
    audio = await tmpCtx.decodeAudioData(arrayBuf.slice(0))
  } catch (e) {
    try { tmpCtx.close() } catch (_) {}
    throw new Error('音频解码失败：' + (e?.message || '未知') + '（浏览器无法解析这段录音，可能是格式问题）')
  }
  try { tmpCtx.close() } catch (_) {}

  const targetRate = 16000
  const channels = 1
  const duration = audio.duration
  const frameCount = Math.ceil(duration * targetRate)
  const offCtx = new OfflineAudioContext(channels, frameCount, targetRate)
  const src = offCtx.createBufferSource()
  src.buffer = audio
  src.connect(offCtx.destination)
  src.start(0)
  const rendered = await offCtx.startRendering()
  // Float32 → Int16 PCM little-endian
  const f32 = rendered.getChannelData(0)
  const pcm = new Int16Array(f32.length)
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]))
    pcm[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
  }
  // Int16Array → base64
  const bytes = new Uint8Array(pcm.buffer)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  const base64 = btoa(bin)
  return {
    mimeType: 'audio/pcm',  // 标准 PCM MIME (s16le 16kHz mono)
    sampleRate: targetRate,
    channels: 1,
    base64,
    durationMs: Math.round(duration * 1000),
  }
}

export function useVoiceInput({
  lang = 'zh-CN',
  onText,
  requireNetwork = false,
  engine = 'auto', // 'webspeech' | 'doubao' | 'aliyun' | 'whisper' | 'auto'(Electron 优先国产)
} = {}) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState(null)
  const [phase, setPhase] = useState('idle') // idle | requesting | listening | transcribing

  const recRef = useRef(null)
  const mediaRef = useRef(null)
  const chunksRef = useRef([])
  const onTextRef = useRef(onText)
  const engineRef = useRef(engine)

  useEffect(() => { onTextRef.current = onText }, [onText])
  useEffect(() => { engineRef.current = engine }, [engine])

  const webspeechSupported = typeof window !== 'undefined'
    && !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  const mediaRecorderSupported = typeof window !== 'undefined'
    && !!window.MediaRecorder

  const ERR_MSG = {
    'not-allowed': '麦克风权限被拒绝，请在系统设置中允许本应用使用麦克风',
    'service-not-allowed': '系统语音识别服务被禁用（macOS：系统设置 → 键盘 → 听写）',
    'audio-capture': '未检测到麦克风设备',
    'no-speech': '没有检测到语音，请重试',
    'network': '网络错误（Web Speech 需联网访问 Google STT，国内网络可能受限）',
    'aborted': '',
    'language-not-supported': '当前语言不支持语音识别',
  }

  const stop = useCallback(() => {
    const rec = recRef.current
    if (rec) { try { rec.stop() } catch (_) {} }
    const media = mediaRef.current
    if (media && media.state !== 'inactive') {
      try { media.stop() } catch (_) {}
    }
    setListening(false)
    setInterim('')
  }, [])

  const startWebSpeech = useCallback(() => {
    if (!webspeechSupported) return false
    if (requireNetwork && typeof navigator !== 'undefined' && navigator.onLine === false) {
      setError('当前离线，Web Speech 需联网访问 Google STT')
      return false
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    setError(null)
    setPhase('requesting')
    const rec = new SR()
    rec.lang = lang
    rec.continuous = true
    rec.interimResults = true
    rec.onstart = () => { setListening(true); setPhase('listening') }
    rec.onresult = (e) => {
      let finalChunk = '', interimChunk = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const txt = e.results[i][0].transcript
        if (e.results[i].isFinal) finalChunk += txt
        else interimChunk += txt
      }
      if (finalChunk && onTextRef.current) onTextRef.current(finalChunk)
      setInterim(interimChunk)
    }
    rec.onerror = (e) => {
      const code = e?.error
      const msg = (code && ERR_MSG[code]) || ('语音识别失败：' + (code || '未知错误'))
      if (code && code !== 'no-speech' && code !== 'aborted') setError(msg)
      setListening(false); setInterim(''); setPhase('idle')
    }
    rec.onend = () => { setListening(false); setInterim(''); setPhase('idle') }
    recRef.current = rec
    try {
      rec.start()
      return true
    } catch (e) {
      setError('启动语音识别失败：' + (e?.message || '未知'))
      setPhase('idle'); setListening(false)
      return false
    }
  }, [webspeechSupported, lang, requireNetwork])

  const startRecorder = useCallback(async () => {
    if (!mediaRecorderSupported) {
      setError('当前环境不支持录音（需 MediaRecorder + 麦克风权限）')
      return false
    }
    if (!isElectron) {
      setError('豆包/阿里云/Whisper 仅在桌面端可用')
      return false
    }
    setError(null)
    setPhase('requesting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '')
      const media = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      media.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data) }
      media.onstart = () => { setListening(true); setPhase('listening') }
      media.onstop = async () => {
        try { stream.getTracks().forEach((t) => t.stop()) } catch (_) {}
        setListening(false)
        setPhase('transcribing')
        try {
          const blob = new Blob(chunksRef.current, { type: media.mimeType || 'audio/webm' })
          if (blob.size === 0) {
            setError('录音为空，请重试')
            setPhase('idle')
            return
          }
          const e = engineRef.current
          let payload
          if (e === 'doubao') {
            // 豆包 WebSocket 流式识别要求 PCM s16le 16kHz mono，先 Web Audio 解码重采样
            payload = await decodeToPcm16kMono(blob)
          } else {
            // 阿里云 / Whisper：直接发原始录音 base64（服务端能识别 webm/opus/mp3 等）
            const ab = await blobToBase64(blob)
            payload = {
              mimeType: ab.mimeType,
              sampleRate: undefined,
              channels: undefined,
              base64: ab.data,
              durationMs: 0,
            }
          }
          const res = await ipcInvoke('stt:transcribe', {
            audioBase64: payload.base64,
            mimeType: payload.mimeType,
            sampleRate: payload.sampleRate,
            channels: payload.channels,
          })
          if (res?.error) throw new Error(res.error)
          const text = (res?.text || '').trim()
          if (text && onTextRef.current) onTextRef.current(text)
          setPhase('idle')
        } catch (e) {
          setError('语音转写失败：' + (e?.message || '未知'))
          setPhase('idle')
        }
      }
      media.onerror = () => { setError('录音失败'); setPhase('idle'); setListening(false) }
      mediaRef.current = media
      media.start(250)
      return true
    } catch (e) {
      const name = e?.name
      const msg = name === 'NotAllowedError' ? '麦克风权限被拒绝' : '启动录音失败：' + (e?.message || name || '未知')
      setError(msg)
      setPhase('idle')
      return false
    }
  }, [mediaRecorderSupported])

  const start = useCallback(() => {
    if (listening) return
    const e = engineRef.current
    if (e === 'webspeech') {
      startWebSpeech()
      return
    }
    if (e === 'doubao' || e === 'aliyun' || e === 'whisper') {
      startRecorder()
      return
    }
    // auto: Electron 优先豆包（国产、永久免费），其它回退 Web Speech
    if (isElectron) {
      startRecorder()
    } else {
      startWebSpeech()
    }
  }, [listening, startWebSpeech, startRecorder])

  const toggle = useCallback(() => {
    if (listening) stop()
    else start()
  }, [listening, start, stop])

  const clearError = useCallback(() => setError(null), [])

  useEffect(() => () => stop(), [stop])

  const supported = webspeechSupported || (mediaRecorderSupported && isElectron)

  return {
    listening, interim, error, phase, supported,
    start, stop, toggle, clearError,
    engine,
  }
}
