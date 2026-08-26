import { ipcMain } from 'electron'
import { Channels } from '../../shared/ipc/channels'
import { applicationRepo, algorithmRepo } from '../../core/store/repositories'
import { initSchema } from '../../core/store/db'
import type { ApplicationRecord, AlgorithmQuestion } from '../../core/store/types'

/** 注册全部 IPC handler */
export function registerIpc(): void {
  initSchema()

  // ── 投递记录 ──
  ipcMain.handle(Channels.APPLICATION_LIST, () => applicationRepo.findAll())
  ipcMain.handle(Channels.APPLICATION_CREATE, (_e, a: ApplicationRecord) => applicationRepo.create(a))
  ipcMain.handle(Channels.APPLICATION_UPDATE, (_e, id: number, a: ApplicationRecord) => applicationRepo.update(id, a))
  ipcMain.handle(Channels.APPLICATION_DELETE, (_e, id: number) => {
    applicationRepo.remove(id)
    return true
  })

  // ── 算法题 ──
  ipcMain.handle(Channels.ALGORITHM_LIST, (_e, filter?: { company?: string; difficulty?: string; title?: string }) => {
    if (filter?.title) return algorithmRepo.findByTitleContainingIgnoreCase(filter.title)
    if (filter?.company) return algorithmRepo.findByCompany(filter.company)
    if (filter?.difficulty) return algorithmRepo.findByDifficulty(filter.difficulty)
    return algorithmRepo.findAll()
  })
  ipcMain.handle(Channels.ALGORITHM_GET, (_e, id: number) => algorithmRepo.findById(id))
  ipcMain.handle(Channels.ALGORITHM_CREATE, (_e, q: AlgorithmQuestion) => algorithmRepo.create(q))
  ipcMain.handle(Channels.ALGORITHM_UPDATE, (_e, id: number, q: AlgorithmQuestion) => algorithmRepo.update(id, q))
  ipcMain.handle(Channels.ALGORITHM_DELETE, (_e, id: number) => {
    algorithmRepo.remove(id)
    return true
  })
}

import { AI_CHANNELS } from '../../shared/ipc/channels'
import { chatWithTools, chatWithSession, chatWithToolsStream, chatWithSessionStream } from '../../core/ai/agent'
import { transcribe as sttTranscribe } from '../../core/ai/stt'
import { getRecentEntries, getStats, clearEntries } from '../../core/ai/agent-log'
import { indexExperiences, clearAll, storeSize } from '../../core/rag/indexer'
import { interviewExperienceRepo } from '../../core/store/repositories'

// ── AI / RAG ──
ipcMain.handle(AI_CHANNELS.CHAT_WITH_TOOLS, async (_e, message: string) => {
  try {
    return { content: await chatWithTools(message) }
  } catch (e: any) {
    return { error: e?.message ?? 'AI 调用失败' }
  }
})

ipcMain.handle(AI_CHANNELS.CHAT_WITH_SESSION, async (_e, sessionId: string, message: string, context?: { questions?: string; resume?: string; company?: string; department?: string }) => {
  try {
    const reply = await chatWithSession(sessionId, message, context)
    return { reply, content: reply }
  } catch (e: any) {
    return { error: e?.message ?? 'AI 调用失败' }
  }
})

// ── 流式对话（推送 delta/tool 事件到渲染端）──
function getSender(e: Electron.IpcMainInvokeEvent) {
  const wc = e.sender
  return (type: string, data: unknown) => wc.send(AI_CHANNELS.CHAT_STREAM, { type, data })
}

ipcMain.handle(AI_CHANNELS.CHAT_STREAM, async (e, message: string) => {
  const push = getSender(e)
  try {
    for await (const ev of chatWithToolsStream(message)) {
      push(ev.type, ev.data)
      if (ev.type === 'done') return { content: ev.data.text }
    }
    return { content: '' }
  } catch (err: any) {
    push('error', { message: err?.message ?? 'AI 调用失败' })
    return { error: err?.message ?? 'AI 调用失败' }
  }
})

ipcMain.handle(AI_CHANNELS.SESSION_STREAM, async (e, sessionId: string, message: string, context?: { questions?: string; resume?: string; company?: string; department?: string }) => {
  const wc = e.sender
  try {
    for await (const ev of chatWithSessionStream(sessionId, message, context)) {
      wc.send(AI_CHANNELS.SESSION_STREAM, { type: ev.type, data: ev.data })
      if (ev.type === 'done') return { reply: ev.data.text ?? '', content: ev.data.text ?? '' }
    }
    return { reply: '', content: '' }
  } catch (err: any) {
    wc.send(AI_CHANNELS.SESSION_STREAM, { type: 'error', data: { message: err?.message ?? 'AI 调用失败' } })
    return { error: err?.message ?? 'AI 调用失败' }
  }
})

// ── 可观测性日志 ──
ipcMain.handle(AI_CHANNELS.LOG_RECENT, (_e, limit = 100) => getRecentEntries(limit))
ipcMain.handle(AI_CHANNELS.LOG_STATS, () => getStats())
ipcMain.handle(AI_CHANNELS.LOG_CLEAR, () => { clearEntries(); return { ok: true } })

// ── STT 语音转写（OpenAI Whisper） ──
ipcMain.handle(
  AI_CHANNELS.STT_TRANSCRIBE,
  async (_e, payload: { audioBase64: string; mimeType?: string; language?: string; sampleRate?: number; channels?: number }) => {
    try {
      if (!payload?.audioBase64) return { error: 'audio data is empty' }
      const result = await sttTranscribe(
        payload.audioBase64,
        {
          mimeType: payload.mimeType || 'audio/webm',
          sampleRate: payload.sampleRate,
          channels: payload.channels,
        }
      )
      return { text: result.text, durationMs: result.durationMs }
    } catch (e: any) {
      return { error: e?.message || 'STT 转写失败' }
    }
  }
)

ipcMain.handle(AI_CHANNELS.RAG_STATS, () => ({ size: storeSize() }))

ipcMain.handle(AI_CHANNELS.REINDEX, async () => {
  try {
    clearAll()
    const all = interviewExperienceRepo.findAll()
    await indexExperiences(all)
    return { ok: true, indexed: all.length, size: storeSize() }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? '重建索引失败' }
  }
})

import { SETTINGS_CHANNELS } from '../../shared/ipc/channels'
import { apiConfig } from '../../core/api-config'

function maskKey(key: string): string {
  return key ? key.slice(0, 8) + '...' : ''
}

// ── Settings ──
ipcMain.handle(SETTINGS_CHANNELS.GET, () => {
  const snap = apiConfig.snapshot()
  return {
    llm: {
      apiKey: maskKey(snap.llmApiKey),
      baseUrl: snap.llmBaseUrl,
      model: snap.llmModel,
      configured: apiConfig.isLlmConfigured(),
    },
    embedding: {
      apiKey: maskKey(snap.embeddingApiKey),
      baseUrl: snap.embeddingBaseUrl,
      model: snap.embeddingModel,
      configured: apiConfig.isEmbeddingConfigured(),
    },
    vision: {
      apiKey: maskKey(snap.visionApiKey),
      baseUrl: snap.visionBaseUrl,
      model: snap.visionModel,
      configured: apiConfig.isVisionConfigured(),
    },
    stt: {
      engine: snap.sttEngine,
      apiKey: maskKey(snap.sttApiKey || snap.llmApiKey),
      baseUrl: snap.sttBaseUrl || snap.llmBaseUrl,
      model: snap.sttModel,
      configured: apiConfig.isSttConfigured(),
    },
  }
})

ipcMain.handle(SETTINGS_CHANNELS.UPDATE, (_e, body: {
  llm?: { apiKey?: string; baseUrl?: string; model?: string }
  embedding?: { apiKey?: string; baseUrl?: string; model?: string }
  vision?: { apiKey?: string; baseUrl?: string; model?: string }
  stt?: { engine?: 'webspeech' | 'whisper'; apiKey?: string; baseUrl?: string; model?: string }
}) => {
  const { llm, embedding, vision, stt } = body
  if (llm) apiConfig.updateLlm(llm.apiKey, llm.baseUrl, llm.model)
  if (embedding) apiConfig.updateEmbedding(embedding.apiKey, embedding.baseUrl, embedding.model)
  if (vision) apiConfig.updateVision(vision.apiKey, vision.baseUrl, vision.model)
  if (stt) apiConfig.updateStt(stt.engine, stt.apiKey, stt.baseUrl, stt.model)
  const snap = apiConfig.snapshot()
  return {
    llm: { baseUrl: snap.llmBaseUrl, model: snap.llmModel, configured: apiConfig.isLlmConfigured(), apiKey: maskKey(snap.llmApiKey) },
    embedding: { baseUrl: snap.embeddingBaseUrl, model: snap.embeddingModel, configured: apiConfig.isEmbeddingConfigured(), apiKey: maskKey(snap.embeddingApiKey) },
    vision: { baseUrl: snap.visionBaseUrl, model: snap.visionModel, configured: apiConfig.isVisionConfigured(), apiKey: maskKey(snap.visionApiKey) },
    stt: { engine: snap.sttEngine, baseUrl: snap.sttBaseUrl || snap.llmBaseUrl, model: snap.sttModel, configured: apiConfig.isSttConfigured(), apiKey: maskKey(snap.sttApiKey || snap.llmApiKey) },
  }
})

ipcMain.handle(SETTINGS_CHANNELS.REINDEX, async () => {
  try {
    clearAll()
    const all = interviewExperienceRepo.findAll()
    await indexExperiences(all)
    return { ok: true, count: all.length, size: storeSize() }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? '重建索引失败' }
  }
})
