// 桌面模式 IPC 实现 — 与 api/client.js 同接口
const ipc = (channel) => (...args) => {
  if (!window.electronAPI?.ipc) throw new Error('IPC 不可用:非桌面环境')
  return window.electronAPI.ipc(channel, ...args)
}

// File → base64 (IPC 无法直接传 File/Blob)
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      // readAsDataURL 返回完整 data URL: data:mime;base64,xxxx
      const dataUrl = reader.result
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
      if (!match) {
        reject(new Error('文件转 base64 失败'))
        return
      }
      resolve({ data: match[2], mimeType: match[1] })
    }
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

export const ipcApi = {
  isAvailable: () => Boolean(window.electronAPI?.ipc),

  // 设置
  getModelSettings: () => ipc('settings:models:get')(),
  updateModelSettings: (llm, embedding, vision, stt) => ipc('settings:models:update')({ llm, embedding, vision, stt }),
  reindexRag: () => ipc('settings:reindex')(),

  // AI 对话
  chatWithTools: async (message) => {
    const res = await ipc('ai:chat-with-tools')(message)
    if (res?.error) throw new Error(res.error)
    return { reply: res?.content ?? '', content: res?.content ?? '' }
  },
  // 多轮面试对话（带 session 记忆）
  chatSession: async (sessionId, userMessage, questions, resume, company, department) => {
    const res = await ipc('ai:chat-with-session')(sessionId, userMessage, { questions, resume, company, department })
    if (res?.error) throw new Error(res.error)
    return { reply: res?.reply ?? '', content: res?.reply ?? '' }
  },
  // 流式单轮对话（工具调用助手）— 逐 token 推送
  chatWithToolsStream: async (message, { onDelta, onToolCall, onToolResult, onDone, onError } = {}) => {
    const ch = 'ai:chat-stream'
    const off = window.electronAPI.on(ch, (payload) => {
      const { type, data } = payload || {}
      if (type === 'delta') onDelta?.(data?.text || '')
      else if (type === 'tool_call') onToolCall?.(data)
      else if (type === 'tool_result') onToolResult?.(data)
      else if (type === 'done') onDone?.(data?.text || '')
      else if (type === 'error') onError?.(data?.message || 'AI 调用失败')
    })
    try {
      const res = await ipc('ai:chat-stream')(message)
      if (res?.error) throw new Error(res.error)
      if (res?.content && !res?._streamed) onDone?.(res.content)
      return { reply: res?.content ?? '', content: res?.content ?? '' }
    } catch (e) {
      onError?.(e?.message || 'AI 调用失败')
      throw e
    } finally {
      off?.()
    }
  },
  // 流式多轮面试对话
  chatSessionStream: async (sessionId, userMessage, { questions, resume, company, department } = {}, { onDelta, onToolCall, onToolResult, onDone, onError } = {}) => {
    const ch = 'ai:session-stream'
    const off = window.electronAPI.on(ch, (payload) => {
      const { type, data } = payload || {}
      if (type === 'delta') onDelta?.(data?.text || '')
      else if (type === 'tool_call') onToolCall?.(data)
      else if (type === 'tool_result') onToolResult?.(data)
      else if (type === 'done') onDone?.(data?.text || '')
      else if (type === 'error') onError?.(data?.message || 'AI 调用失败')
    })
    try {
      const res = await ipc('ai:session-stream')(sessionId, userMessage, { questions, resume, company, department })
      if (res?.error) throw new Error(res.error)
      if (res?.content && !res?._streamed) onDone?.(res.content)
      return { reply: res?.reply ?? '', content: res?.content ?? '' }
    } catch (e) {
      onError?.(e?.message || 'AI 调用失败')
      throw e
    } finally {
      off?.()
    }
  },
  // STT 语音转写（OpenAI Whisper）
  transcribeAudio: async ({ audioBase64, mimeType, language }) => {
    const res = await ipc('stt:transcribe')({ audioBase64, mimeType, language })
    if (res?.error) throw new Error(res.error)
    return { text: res?.text || '' }
  },

  // Agent 可观测性日志
  getAgentLogs: (limit = 100) => ipc('ai:log:recent')(limit),
  getAgentStats: () => ipc('ai:log:stats')(),
  clearAgentLogs: () => ipc('ai:log:clear')(),
  // 结束面试 session + LLM 生成报告
  endChatSession: async (sessionId, questions, resume, company, department) => {
    const res = await ipc('chat:end')(sessionId, questions, resume, company, department)
    if (res?.error) throw new Error(res.error)
    return res
  },

  // 面经
  getCompanies: () => ipc('interview:companies')(),
  getDepartments: (company) => ipc('interview:departments')(company),
  searchInterviews: (company, department) => ipc('interview:search')(company, department),
  addExperiences: (exps) => ipc('interview:addExperiences')(exps),
  deleteExperience: async (id) => { ipc('interview:deleteExperience')(id); return true },
  getExperience: (id) => ipc('interview:getExperience')(id),
  // A1: 面经截图 OCR → 多模态 LLM
  parseImage: async (file) => {
    const { data, mimeType } = await fileToBase64(file)
    const res = await ipc('interview:parseImage')({ data, mimeType })
    if (res?.error) throw new Error(res.error)
    return res
  },

  // 会话
  getChatSessions: () => ipc('chat:list')(),
  getChatSession: (sid) => ipc('chat:bySid')(sid),
  getChatSessionById: (id) => ipc('chat:byId')(id),
  deleteChatSession: (sid) => ipc('chat:deleteBySid')(sid),
  deleteChatSessionById: (id) => ipc('chat:deleteById')(id),

  // 简历
  getResumes: () => ipc('resume:list')(),
  getResume: (id) => ipc('resume:get')(id),
  deleteResume: (id) => ipc('resume:delete')(id),
  uploadResume: (r) => ipc('resume:upload')(r),
  downloadResume: async (id) => {
    const res = await ipc('resume:download')(id)
    return { ok: !!res, blob: () => Promise.resolve(new Uint8Array(res?.fileData ?? [])), headers: { 'content-disposition': `attachment; filename="${res?.fileName ?? ''}"` } }
  },
  // A3: 简历解析 (PDF→文本提取, 图片→多模态 LLM, 文本→直接返回)
  parseResume: async (file) => {
    if (file && typeof file === 'string') {
      const res = await ipc('resume:parse')({ text: file })
      if (res?.error) throw new Error(res.error)
      return { content: res.content || '' }
    }
    if (file && file instanceof File) {
      const isPdf = file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf')
      const { data, mimeType } = await fileToBase64(file)
      const res = await ipc('resume:parse')({ data, mimeType, isPdf })
      if (res?.error) throw new Error(res.error)
      return { content: res.content || '' }
    }
    throw new Error('不支持的文件格式')
  },

  // 复盘
  getReplayRecords: () => ipc('replay:records')(),
  saveReplay: (r) => ipc('replay:save')(r),
  deleteReplayRecord: (id) => ipc('replay:delete')(id),
  analyzeReplay: async (company, department, content) => ipc('replay:analyze')(company, department, content),

  // IDE
  executeCode: (language, code, stdin, acmMode) => ipc('ide:execute')(language, code, stdin, acmMode),

  // 实习经历
  getMasteryProjects: () => ipc('mastery:list')(),
  getMasteryProject: (id) => ipc('mastery:get')(id),
  createMasteryProject: async (p) => {
    // Electron IPC 不能直接传 File / FormData — 把 File 转成 base64 后转交主进程解析
    if (p instanceof FormData) {
      const obj = { name: '', company: '', role: '', startDate: '', endDate: '', files: [] }
      const fileEntries = []
      for (const [k, v] of p.entries()) {
        if (v instanceof File) {
          fileEntries.push({ key: k, file: v })
        } else {
          obj[k] = v
        }
      }
      obj.files = await Promise.all(
        fileEntries.map(async ({ key, file }) => {
          const { data, mimeType } = await fileToBase64(file)
          return {
            fieldName: key,
            filename: file.name || 'untitled',
            mimeType: mimeType,
            data,
            sizeBytes: file.size,
          }
        })
      )
      return ipc('mastery:create')(obj)
    }
    // 兼容旧调用：p.files 已经是 [{filename, mimeType, data, sizeBytes}]
    return ipc('mastery:create')(p)
  },
  updateMasteryExperience: (id, exp) => ipc('mastery:updateExp')(id, exp),
  deleteMasteryProject: (id) => ipc('mastery:delete')(id),
  diagnoseMastery: (id, answers) => ipc('mastery:diagnose')(id, answers),

  // 算法
  getAlgorithms: (filter) => ipc('algorithm:list')(filter),
  getAlgorithm: (id) => ipc('algorithm:get')(id),
  createAlgorithm: (q) => ipc('algorithm:create')(q),
  updateAlgorithm: (id, q) => ipc('algorithm:update')(id, q),
  deleteAlgorithm: (id) => ipc('algorithm:delete')(id),

  // 实习经历 - 生成经历+概念图谱
  // 主进程在生成期间通过 mastery:generate:events:<id> 推送 step / delta / outline / graph 中间事件
  generateMasteryStream: async (id, { onStep, onDelta, onOutline, onGraph, onResult, onError }) => {
    const channel = 'mastery:generate:events:' + id
    const off = window.electronAPI?.on ? window.electronAPI.on(channel, (payload) => {
      if (!payload || !payload.type) return
      if (payload.type === 'step') onStep?.(payload.data)
      else if (payload.type === 'delta') onDelta?.(payload.data)
      else if (payload.type === 'outline') onOutline?.(payload.data)
      else if (payload.type === 'graph') onGraph?.(payload.data)
    }) : () => {}
    try {
      onStep?.({ title: '准备中', stage: 'prepare', status: 'in_progress' })
      const res = await ipc('mastery:generate')(id)
      if (res?.error) {
        onError?.(res.error)
        throw new Error(res.error)
      }
      onResult?.(res)
    } catch (e) {
      onError?.(e?.message || '生成失败')
      throw e
    } finally {
      off?.()
    }
  },

  // 题单流式生成(同上)
  generateQuestionsStream: async (company, department, resume, { onStep, onDelta, onResult, onError }) => {
    const streamChannel = 'interview:generateQuestions:stream'
    const off = window.electronAPI.on(streamChannel, (payload) => {
      const { type, data } = payload || {}
      if (type === 'step') onStep?.(data)
      else if (type === 'delta') onDelta?.(data)
      else if (type === 'result') onResult?.(data)
      else if (type === 'error') onError?.(data)
    })
    try {
      const res = await ipc('interview:generateQuestions')(company, department, resume)
      if (res?.error) throw new Error(res.error)
      // result 已通过流式事件推送;若未收到则用 invoke 返回值兜底
      if (res?.content) onResult?.(res.content)
    } catch (e) {
      onError?.(e?.message || '生成失败')
    } finally {
      off?.()
    }
  },
}
