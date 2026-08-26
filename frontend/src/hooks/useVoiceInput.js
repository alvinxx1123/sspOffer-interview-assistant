import { useState, useEffect, useRef, useCallback } from 'react'

/**
 * 浏览器语音转文字（Web Speech API）。
 * - start()：开始识别，识别到的 final 文本通过 onText(finalChunk) 回调逐段返回，由组件追加到输入框
 * - interim：当前未确认的中间结果，用于按钮旁实时预览
 * - supported：浏览器不支持时为 false，调用方应禁用按钮
 * 互斥：同一时刻只允许一个识别实例。
 */
export function useVoiceInput({ lang = 'zh-CN', onText } = {}) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const recRef = useRef(null)
  const onTextRef = useRef(onText)

  useEffect(() => { onTextRef.current = onText }, [onText])

  const supported = typeof window !== 'undefined'
    && (window.SpeechRecognition || window.webkitSpeechRecognition)

  const stop = useCallback(() => {
    const rec = recRef.current
    if (rec) { try { rec.stop() } catch (_) {} }
    setListening(false)
    setInterim('')
  }, [])

  const start = useCallback(() => {
    if (!supported) return
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (listening) return
    const rec = new SR()
    rec.lang = lang
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e) => {
      let finalChunk = ''
      let interimChunk = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const txt = e.results[i][0].transcript
        if (e.results[i].isFinal) finalChunk += txt
        else interimChunk += txt
      }
      if (finalChunk && onTextRef.current) {
        onTextRef.current(finalChunk)
      }
      setInterim(interimChunk)
    }
    rec.onerror = (e) => {
      setListening(false)
      setInterim('')
      if (e.error && e.error !== 'no-speech' && e.error !== 'aborted') {
        console.warn('语音识别错误:', e.error)
      }
    }
    rec.onend = () => {
      setListening(false)
      setInterim('')
    }
    recRef.current = rec
    try {
      rec.start()
      setListening(true)
    } catch (e) {
      setListening(false)
    }
  }, [supported, listening, lang])

  const toggle = useCallback(() => {
    if (listening) stop()
    else start()
  }, [listening, start, stop])

  useEffect(() => () => stop(), [stop])

  return { listening, interim, supported, start, stop, toggle }
}
