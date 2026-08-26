import { ipcMain } from 'electron'

// 临时 logger：只用到 warn，避免额外依赖
const log = { warn: (...args: unknown[]) => console.warn('[Mastery]', ...args) }
import { INTERVIEW_CHANNELS, CHAT_SESSION_CHANNELS, RESUME_CHANNELS, REPLAY_CHANNELS, IDE_CHANNELS, MASTERY_CHANNELS } from '../../shared/ipc/channels'
import {
  interviewExperienceRepo, algorithmRepo, userResumeRepo, userInterviewRecordRepo,
  internshipProjectRepo, chatSessionRepo,
} from '../../core/store/repositories'
import { executeCodeRemote } from '../../core/ai/code-exec'
import { DEEP_QUESTIONS_SYSTEM, REPLAY_SYSTEM, MASTERY_GENERATE_SYSTEM, MASTERY_DIAGNOSE_SYSTEM, IMAGE_PARSE_PROMPT, RESUME_PARSE_PROMPT, INTERVIEW_REPORT_SYSTEM } from '../../core/prompts'
import { chat } from '../../core/ai/chat-model'
import { chatWithSession } from '../../core/ai/agent'
import { chatStream } from '../../core/ai/chat-model'
import { callVision, extractJson } from '../../core/ai/vision-client'
import { parsePdf } from '../../core/ai/pdf-parser'
import { masteryService } from './mastery-service'
import type { InterviewExperience, UserResume, UserInterviewRecord, InternshipProject } from '../../core/store/types'

/** 注册剩余模块 IPC handler */
export function registerModuleIpc(): void {

  // ── 面经 ──
  ipcMain.handle(INTERVIEW_CHANNELS.COMPANIES, () => interviewExperienceRepo.findDistinctCompanies())
  ipcMain.handle(INTERVIEW_CHANNELS.DEPARTMENTS, (_e, company: string) => interviewExperienceRepo.findDistinctDepartmentsByCompany(company))
  ipcMain.handle(INTERVIEW_CHANNELS.SEARCH, (_e, company: string, department?: string) => {
    if (department) return interviewExperienceRepo.findByCompanyAndDepartment(company, department)
    return interviewExperienceRepo.findByCompany(company)
  })
  ipcMain.handle(INTERVIEW_CHANNELS.GET_EXPERIENCE, (_e, id: number) => interviewExperienceRepo.findById(id))
  ipcMain.handle(INTERVIEW_CHANNELS.ADD_EXPERIENCES, (_e, experiences: InterviewExperience[]) => {
    const saved = experiences.map((e) => interviewExperienceRepo.create(e))
    return saved
  })
  ipcMain.handle(INTERVIEW_CHANNELS.DELETE_EXPERIENCE, (_e, id: number) => {
    interviewExperienceRepo.remove(id)
    return true
  })

  // ── A1: 面经截图 OCR (多模态 LLM) ──
  ipcMain.handle(INTERVIEW_CHANNELS.PARSE_IMAGE, async (_e, payload: { data: string; mimeType: string }) => {
    if (!payload?.data) return { error: '图片数据为空' }
    try {
      const raw = await callVision(payload.data, payload.mimeType || 'image/jpeg', IMAGE_PARSE_PROMPT)
      const parsed = extractJson(raw) || {}
      return parsed
    } catch (e: any) {
      return { error: e?.message ?? '图片解析失败' }
    }
  })

  // ── 会话 ──
  ipcMain.handle(CHAT_SESSION_CHANNELS.LIST, () => chatSessionRepo.findAll())
  ipcMain.handle(CHAT_SESSION_CHANNELS.GET_BY_ID, (_e, id: number) => {
    const s = chatSessionRepo.findById(id)
    if (!s) return null
    return { ...s, messages: chatSessionRepo.findMessages(id) }
  })
  ipcMain.handle(CHAT_SESSION_CHANNELS.GET_BY_SID, (_e, sid: string) => {
    const s = chatSessionRepo.findBySessionId(sid)
    if (!s) return null
    return { ...s, messages: chatSessionRepo.findMessages(s.id!) }
  })
  ipcMain.handle(CHAT_SESSION_CHANNELS.DELETE_BY_ID, (_e, id: number) => { chatSessionRepo.remove(id); return true })
  ipcMain.handle(CHAT_SESSION_CHANNELS.DELETE_BY_SID, (_e, sid: string) => {
    const s = chatSessionRepo.findBySessionId(sid)
    if (s) chatSessionRepo.remove(s.id!)
    return true
  })

  // ── 结束面试 session + 生成报告 ──
  ipcMain.handle(CHAT_SESSION_CHANNELS.END, async (_e, sid: string, questions: string, resume: string, company: string, department: string) => {
    const s = chatSessionRepo.findBySessionId(sid)
    if (!s) return { error: '会话不存在' }
    const numericId = s.id!
    const messages = chatSessionRepo.findMessages(numericId)

    // 标记结束
    chatSessionRepo.endSession(numericId, { questions, resume, company, department })

    // 生成面试报告
    if (messages.length > 0) {
      try {
        const transcript = messages.map(m => `${m.role === 'user' ? '候选人' : '面试官'}: ${m.content}`).join('\n\n')
        const userMsg = `公司: ${company || '未指定'} / 部门: ${department || '未指定'}
简历摘要: ${(resume || '').slice(0, 1000)}

面试对话记录:
${transcript}`
        const reportText = await chat(INTERVIEW_REPORT_SYSTEM, userMsg)
        // 尝试解析 JSON
        try {
          const parsed = JSON.parse(reportText)
          chatSessionRepo.endSession(numericId, {
            overallScore: parsed.overallScore ?? null,
            reportSummary: parsed.summary ?? '',
            reportJson: JSON.stringify(parsed),
          })
        } catch {
          chatSessionRepo.endSession(numericId, {
            reportSummary: reportText.slice(0, 500),
            reportJson: reportText,
          })
        }
      } catch (e: any) {
        console.error('生成面试报告失败:', e)
      }
    }
    return { ok: true }
  })

  // ── 简历 ──
  ipcMain.handle(RESUME_CHANNELS.LIST, () => userResumeRepo.findAll())
  ipcMain.handle(RESUME_CHANNELS.GET, (_e, id: number) => userResumeRepo.findById(id))
  ipcMain.handle(RESUME_CHANNELS.DELETE, (_e, id: number) => { userResumeRepo.remove(id); return true })
  ipcMain.handle(RESUME_CHANNELS.UPLOAD, (_e, r: Partial<UserResume>) => userResumeRepo.create(r))
  ipcMain.handle(RESUME_CHANNELS.DOWNLOAD, (_e, id: number) => {
    const r = userResumeRepo.findById(id)
    if (!r) return null
    return { fileName: r.fileName, contentType: r.contentType, fileData: r.fileData ? Array.from(r.fileData) : null }
  })

  // ── A3: 简历解析 (PDF→文本提取, 图片→多模态 LLM, 文本→直接返回) ──
  ipcMain.handle(RESUME_CHANNELS.PARSE, async (_e, payload: { data?: string; mimeType?: string; text?: string; isPdf?: boolean }) => {
    // 纯文本直接返回
    if (payload?.text && !payload?.data) {
      return { content: payload.text }
    }
    if (!payload?.data) {
      return { error: '简历数据为空' }
    }
    const mime = payload.mimeType || ''
    const isPdf = payload.isPdf || mime === 'application/pdf'
    // PDF: 先用 pdf-parse 提取文本
    if (isPdf) {
      try {
        const pdfBuffer = Buffer.from(payload.data, 'base64')
        const pdfData = await parsePdf(pdfBuffer)
        const text = (pdfData?.text || '').trim()
        // 文本足够长 → 直接返回
        if (text.length > 50) {
          return { content: text }
        }
        // 扫描版 PDF (无文本) → 回退到 vision (需转图片, 此处提示用户)
        return { error: '该 PDF 为扫描版(无可提取文本)，请将简历导出为图片后上传' }
      } catch (e: any) {
        return { error: 'PDF 解析失败: ' + (e?.message || '未知错误') }
      }
    }
    // 图片 → 多模态 LLM
    try {
      const raw = await callVision(payload.data, mime || 'image/jpeg', RESUME_PARSE_PROMPT)
      return { content: raw }
    } catch (e: any) {
      return { error: e?.message ?? '简历解析失败' }
    }
  })

  // ── 复盘 ──
  ipcMain.handle(REPLAY_CHANNELS.RECORDS, () => userInterviewRecordRepo.findAll())
  ipcMain.handle(REPLAY_CHANNELS.SAVE, (_e, record: UserInterviewRecord) => userInterviewRecordRepo.create(record))
  ipcMain.handle(REPLAY_CHANNELS.DELETE, (_e, id: number) => { userInterviewRecordRepo.remove(id); return true })
  ipcMain.handle(REPLAY_CHANNELS.ANALYZE, async (_e, company: string, department: string, content: string) => {
    const userMsg = `公司: ${company} / 部门: ${department}\n面经内容:\n${content}`
    const result = await chat(REPLAY_SYSTEM, userMsg)
    try { return JSON.parse(result) } catch { return { analysis: result } }
  })

  // ── IDE 执行 ──
  ipcMain.handle(IDE_CHANNELS.EXECUTE, async (_e, language: string, code: string, stdin: string, acmMode: boolean) => {
    return executeCodeRemote(language, code, stdin, acmMode)
  })

  // ── 实习经历 ──
  // Electron 桌面应用独立运行：Mastery 全部由 Electron 主进程处理。
  // 直接用用户在设置页配的多模态 LLM（apiConfig.visionApiKey/BaseUrl/Model）。
  ipcMain.handle(MASTERY_CHANNELS.LIST, () => internshipProjectRepo.findAll())
  ipcMain.handle(MASTERY_CHANNELS.GET, (_e, id: number) => internshipProjectRepo.findById(id))
  ipcMain.handle(
    MASTERY_CHANNELS.CREATE,
    async (_e, p: { name?: string; company?: string; role?: string; startDate?: string; endDate?: string; files: Array<{filename: string; mimeType: string; data: string}> }) => {
      try {
        const project = await masteryService.createProject(p)
        return { ok: true, project }
      } catch (e: any) {
        return { error: e?.message ?? '创建项目失败' }
      }
    }
  )
  ipcMain.handle(MASTERY_CHANNELS.UPDATE_EXP, (_e, id: number, exp: string) => { internshipProjectRepo.updateExperience(id, exp); return true })
  ipcMain.handle(MASTERY_CHANNELS.DELETE, (_e, id: number) => { internshipProjectRepo.remove(id); return true })

  // ── A4: 生成经历+概念图谱 ──
  // 主进程内调 masteryService；中间步骤通过 _e.sender.send 推到 renderer。
  // 注意：ipcMain.handle 回调签名是 (event: IpcMainInvokeEvent, ...args)，
  //       event 即 _e，不要再多收一个 event 参数(否则 event 是 undefined)
  ipcMain.handle(
    MASTERY_CHANNELS.GENERATE,
    async (_e: Electron.IpcMainInvokeEvent, id: number) => {
      const emit = (type: string, data: unknown) => {
        try { _e.sender.send('mastery:generate:events:' + id, { type, data }) } catch {}
      }
      emit('step', { stage: 'prepare', status: 'in_progress', title: '准备', detail: '读取项目文档' })
      try {
        const result = await masteryService.generate(id, emit)
        emit('step', { stage: 'done', status: 'completed', title: '全部完成', detail: '' })
        return result
      } catch (e: any) {
        const msg = e?.message ?? '生成失败'
        emit('step', { stage: 'error', status: 'failed', title: '生成失败', detail: msg })
        return { error: msg }
      }
    }
  )

  // ── 诊断 ──
  ipcMain.handle(
    MASTERY_CHANNELS.DIAGNOSE,
    async (_e, id: number, answers: Array<{ concept: string; question: string; answer: string }>) => {
      try {
        const res = await masteryService.diagnose(id, answers)
        return res
      } catch (e: any) {
        return { error: e?.message ?? '诊断失败' }
      }
    }
  )

  ipcMain.handle(INTERVIEW_CHANNELS.GENERATE_QUESTIONS, async (e, company: string, department: string, resume: string) => {
    // 主进程流式推送 step/delta/result/error 事件到渲染进程
    const streamChannel = `${INTERVIEW_CHANNELS.GENERATE_QUESTIONS}:stream`
    const send = (type: string, data: any) => {
      try { e.sender.send(streamChannel, { type, data }) } catch {}
    }
    const userMsg = `公司: ${company} / 部门: ${department}\n候选人简历摘要:\n${resume || '无'}\n请生成 8 道面试问题。`
    try {
      send('step', { title: '分析简历与面经要点', detail: '结合目标公司面经与候选人简历定位考察方向', stage: 'analyze', status: 'in_progress' })
      await new Promise((r) => setTimeout(r, 200))
      send('step', { title: '分析简历与面经要点', detail: '结合目标公司面经与候选人简历定位考察方向', stage: 'analyze', status: 'completed' })
      send('step', { title: '生成深挖问题', detail: '流式生成项目深挖、系统设计、八股与算法题目', stage: 'generate', status: 'in_progress' })
      let full = ''
      for await (const chunk of chatStream(DEEP_QUESTIONS_SYSTEM, userMsg)) {
        full += chunk
        send('delta', chunk)
      }
      send('step', { title: '生成深挖问题', detail: '流式生成项目深挖、系统设计、八股与算法题目', stage: 'generate', status: 'completed' })
      send('result', full)
      return { content: full }
    } catch (err: any) {
      const msg = err?.message ?? '生成失败'
      send('error', msg)
      return { error: msg }
    }
  })

}
