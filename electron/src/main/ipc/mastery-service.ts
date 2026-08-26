// 真实现的 Electron 端 Mastery 服务 — 完全独立运行,不依赖 Spring Boot
// 复用：
//   - pdf-parse (PDF 文字抽取)
//   - vision-client.callVision (多模态 LLM,消费用户配置的 visionApiKey)
//   - chat-model.chat / chatStream (LLM,消费用户配置的 llmApiKey)
//   - pdf-parser.parsePdf (Electron 内置 PDF 抽取)
//   - internshipProjectRepo (Electron 本地 SQLite)
//
// 流程：
//   createProject(meta, files)
//     → 逐文件解析(MD/TXT 直读、PDF 文字抽取、图片调 vision-client)
//     → 把成功的 sourceText 拼起来 + parseStatusJson(每个文件成败)
//     → 存 internshipProjectRepo 并返回
//   generate(id, emit)
//     → emit step 'outline' / 'experience' / 'graph'
//     → chat() 出 outline、chatStream() 流式产出 experienceText
//     → chat() 出 conceptGraphJson
//     → 写回 repo, emit result
//   diagnose(id, answers, emit)
//     → chat() 出 masteryMapJson
//     → 写回 repo, 返回

import { Buffer } from 'node:buffer'
import { internshipProjectRepo } from '../../core/store/repositories'
import type { InternshipProject } from '../../core/store/types'
import { parsePdf } from '../../core/ai/pdf-parser'
import { callVision } from '../../core/ai/vision-client'
import { chat, chatStream } from '../../core/ai/chat-model'
import { MASTERY_GENERATE_SYSTEM, MASTERY_DIAGNOSE_SYSTEM } from '../../core/prompts'

interface UploadedFile {
  fieldName?: string
  filename: string
  mimeType: string
  data: string // base64, no data:URL prefix
  sizeBytes?: number
}

interface CreateProjectInput {
  name?: string
  company?: string
  role?: string
  startDate?: string
  endDate?: string
  files: UploadedFile[]
}

type EmitFn = (type: string, data: unknown) => void

function safeJsonParse(s: string | null | undefined): any {
  if (!s) return null
  try { return JSON.parse(s) } catch { return null }
}

/** 把 llm JSON 输出里夹带的 markdown 代码块剥掉 */
function stripJsonFence(raw: string): string {
  let s = raw.trim()
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (m) s = m[1].trim()
  const first = s.indexOf('{')
  const last = s.lastIndexOf('}')
  if (first >= 0 && last > first) return s.slice(first, last + 1)
  return s
}

export const masteryService = {
  async createProject(input: CreateProjectInput): Promise<InternshipProject> {
    const sourceParts: string[] = []
    const fileStatus: any[] = []
    let success = 0, failed = 0
    const unlimitedOcrEnabled = false // TODO: 后续接 SGLang/vLLM

    for (const f of input.files || []) {
      const entry: any = { filename: f.filename, parser: 'unknown' }
      const ext = (f.filename.match(/\.[^.]+$/) || [''])[0].toLowerCase()
      const buffer = (() => {
        try { return Buffer.from(f.data, 'base64') }
        catch { return null as any }
      })()

      if (!buffer) {
        entry.status = 'failed'
        entry.error = '文件读取失败（非 base64）'
        fileStatus.push(entry)
        failed++
        continue
      }

      if (ext === '.md' || ext === '.markdown' || /\.(md|markdown)$/.test(ext)) {
        try {
          const text = buffer.toString('utf8').replace(/\r\n?/g, '\n').trim()
          if (text) {
            sourceParts.push(`===== 文件: ${f.filename} =====\n${text}\n\n`)
            entry.status = 'success'
            entry.parser = 'markdown_plain'
            entry.textLength = text.length
            fileStatus.push(entry)
            success++
          } else {
            entry.status = 'failed'
            entry.error = 'Markdown 内容为空'
            fileStatus.push(entry)
            failed++
          }
        } catch (e: any) {
          entry.status = 'failed'
          entry.error = e?.message || '解析失败'
          fileStatus.push(entry)
          failed++
        }
        continue
      }

      if (ext === '.txt' || ext === '.text' || ext === '.log') {
        try {
          const text = buffer.toString('utf8').replace(/\r\n?/g, '\n').trim()
          if (text) {
            sourceParts.push(`===== 文件: ${f.filename} =====\n${text}\n\n`)
            entry.status = 'success'
            entry.parser = 'plain_text'
            entry.textLength = text.length
            fileStatus.push(entry)
            success++
          } else {
            entry.status = 'failed'
            entry.error = '文本内容为空'
            fileStatus.push(entry)
            failed++
          }
        } catch (e: any) {
          entry.status = 'failed'
          entry.error = e?.message || '解析失败'
          fileStatus.push(entry)
          failed++
        }
        continue
      }

      if (ext === '.pdf') {
        try {
          const { text } = await parsePdf(buffer)
          const trimmed = (text || '').trim()
          if (trimmed) {
            const charsPerPage = trimmed.length // 不知道页数，先按总字符估
            if (charsPerPage < 20) {
              entry.status = 'failed'
              entry.error = `PDF 仅 ${charsPerPage} 个字符，疑似扫描件。请另存为图片或先 OCR 后以 .md 上传。`
              fileStatus.push(entry)
              failed++
            } else {
              sourceParts.push(`===== 文件: ${f.filename} =====\n${trimmed}\n\n`)
              entry.status = 'success'
              entry.parser = 'pdfbox_text'
              entry.textLength = trimmed.length
              fileStatus.push(entry)
              success++
            }
          } else {
            entry.status = 'failed'
            entry.error = 'PDF 没有可抽取的文字（疑似扫描件），请以图片或 .md 上传'
            fileStatus.push(entry)
            failed++
          }
        } catch (e: any) {
          entry.status = 'failed'
          entry.error = e?.message || 'PDF 解析失败'
          fileStatus.push(entry)
          failed++
        }
        continue
      }

      // 图片：调多模态 LLM
      if (/\.(png|jpg|jpeg|gif|webp)$/.test(ext)) {
        try {
          // 调用 vision-client；它使用用户配置的 visionApiKey/BaseUrl/Model
          const RESUME_IMAGE_PROMPT = `这是一份项目文档图片，请提取全部文字内容并按原样输出。不要添加任何结构化标注或开场白，保持段落换行。`
          const content = await callVision(f.data, f.mimeType, RESUME_IMAGE_PROMPT)
          if (content && content.trim()) {
            sourceParts.push(`===== 文件: ${f.filename} =====\n${content.trim()}\n\n`)
            entry.status = 'success'
            entry.parser = 'llm_vision'
            entry.textLength = content.trim().length
            fileStatus.push(entry)
            success++
          } else {
            entry.status = 'failed'
            entry.error = '视觉模型返回空。请检查「设置 → 多模态大模型」是否配置正确，并确认模型支持图片'
            fileStatus.push(entry)
            failed++
          }
        } catch (e: any) {
          entry.status = 'failed'
          entry.error = e?.message || '图片解析失败'
          fileStatus.push(entry)
          failed++
        }
        continue
      }

      // 未知扩展名
      entry.status = 'failed'
      entry.error = `暂不支持的文件类型：${ext || '(无后缀)'}。请用 PDF / MD / TXT / 图片`
      fileStatus.push(entry)
      failed++
    }

    const summary = {
      files: fileStatus,
      successCount: success,
      failedCount: failed,
      totalCount: fileStatus.length,
    }

    if (fileStatus.length > 0 && failed === fileStatus.length) {
      // 全部失败：把首条错误暴露给前端
      const firstError = fileStatus.find(x => x.status !== 'success')?.error || '未知错误'
      throw new Error(
        `全部 ${failed} 个文档解析失败，无法生成。原因（第一条）：${firstError}。` +
        `请到「设置 → 多模态大模型」确认视觉 API Key 与模型配置是否正确。`,
      )
    }

    const project = internshipProjectRepo.create({
      name: input.name || '未命名项目',
      company: input.company || null,
      role: input.role || null,
      startDate: input.startDate || null,
      endDate: input.endDate || null,
      sourceText: sourceParts.join(''),
      parseStatusJson: JSON.stringify(summary),
    } as any)
    return project
  },

  async generate(id: number, emit: EmitFn): Promise<{ experienceText: string; conceptGraph: any; outline: any }> {
    const project = internshipProjectRepo.findById(id)
    if (!project) throw new Error('项目不存在')
    const source = (project as any).sourceText || (project as any).experienceText || ''
    if (!source || !source.trim()) {
      const sts = safeJsonParse((project as any).parseStatusJson)
      const failedList = sts?.files?.filter((f: any) => f.status !== 'success') || []
      const detail = failedList.slice(0, 3).map((f: any) => `  · ${f.filename} → ${f.error}`).join('\n')
      throw new Error(
        `该项目无可用文档内容，无法生成。共 ${sts?.totalCount ?? 0} 个文档，成功 ${sts?.successCount ?? 0}，` +
        `失败 ${sts?.failedCount ?? 0}。\n${detail}` +
        `\n建议：到「设置」确认 LLM 和视觉 API Key 配置，或先单独上传 1 张图片验证。`,
      )
    }

    emit('step', { stage: 'outline', status: 'in_progress', title: '文档归类与项目识别', detail: '正在通读文档识别项目骨架' })
    let outlineRaw = ''
    try {
      outlineRaw = await chat(
        `你是一位资深简历顾问。通读这份实习/项目文档，识别其中包含的项目并按项目归类整理事实。\n` +
        `严格输出 JSON（不要 markdown），结构：{"projects":[{"name":"","documentTypes":[],"background":"","techStack":"","myContributions":"","achievements":""}]}`,
        `【全部项目文档】\n${source.slice(0, 12000)}\n\n只输出 JSON。`
      )
    } catch (e: any) {
      emit('step', { stage: 'outline', status: 'failed', title: '骨架生成失败', detail: e?.message || 'LLM 调用失败' })
      throw e
    }
    const outline = safeJsonParse(stripJsonFence(outlineRaw)) || {}
    internshipProjectRepo.updateFields(id, { projectOutlineJson: JSON.stringify(outline) } as any)
    emit('outline', JSON.stringify(outline))
    emit('step', { stage: 'outline', status: 'completed', title: '项目识别完成', detail: `共识别 ${(outline.projects || []).length} 个项目` })

    emit('step', { stage: 'experience', status: 'in_progress', title: '生成实习经历', detail: '正在按项目骨架流式生成 STAR 经历' })
    const expPrompt = `你是资深技术简历顾问。从候选人提供的实习/项目文档中，提取可写进简历的 STAR 格式实习经历，分条输出。\n` +
      `原则：只基于文档真实内容，不编造量化指标；区分个人贡献与团队成果；无数据时用"参与/支持"等可验证措辞。\n` +
      `格式：每条经历以"· "开头，先 STAR 一句概述，再紧跟要点；条目之间空行分隔；用中文；不要 markdown 加粗或除"·"外的符号。\n` +
      `各条经历开头用「【项目：xxx】」标注所属项目。直接输出经历正文。`
    const expUser = `项目信息：${project.company || ''} / ${project.role || ''} / ${project.name}\n时间：${project.startDate || ''} ~ ${project.endDate || ''}\n\n` +
      `【项目骨架】\n${JSON.stringify(outline).slice(0, 4000)}\n\n` +
      `【项目文档原文】\n${source.slice(0, 8000)}`
    let experienceText = ''
    try {
      for await (const chunk of chatStream(expPrompt, expUser)) {
        experienceText += chunk
        emit('delta', chunk)
      }
    } catch (e: any) {
      emit('step', { stage: 'experience', status: 'failed', title: '经历生成失败', detail: e?.message || 'LLM 调用失败' })
      throw e
    }
    experienceText = experienceText.trim()
    emit('step', { stage: 'experience', status: 'completed', title: '实习经历生成完成', detail: '' })

    emit('step', { stage: 'graph', status: 'in_progress', title: '提取概念图谱', detail: '正在把经历拆成面试官会深挖的底层概念树' })
    const graphPrompt = `你是资深大厂技术面试官。基于候选人的实习经历，为每条经历列出面试官最可能深挖的底层概念图谱。\n` +
      `严格输出 JSON（不要 markdown、不要代码块），结构：\n` +
      `{"conceptGraph":[{"experienceRef":"对应经历的关键描述","concepts":[{"concept":"概念名","category":"原理|故障|一致性|选型|边界","depthLevel":"表层|中层|底层","whyItMatters":"面试官会怎么拷打","probeQuestion":"开放式诊断题"}]}]}`
    let graphRaw = ''
    try {
      graphRaw = await chat(graphPrompt, `【生成的实习经历】\n${experienceText.slice(0, 3000)}\n\n【原始文档片段】\n${source.slice(0, 4000)}\n\n只输出 JSON。`)
    } catch (e: any) {
      emit('step', { stage: 'graph', status: 'failed', title: '图谱生成失败', detail: e?.message || 'LLM 调用失败' })
      throw e
    }
    const parsed = safeJsonParse(stripJsonFence(graphRaw))
    const graph = parsed?.conceptGraph ? parsed : (parsed ? { conceptGraph: parsed } : { conceptGraph: [] })
    internshipProjectRepo.updateFields(id, {
      experienceText,
      conceptGraphJson: JSON.stringify(graph),
    } as any)
    emit('graph', JSON.stringify(graph))
    emit('step', { stage: 'graph', status: 'completed', title: '概念图谱完成', detail: `共提取 ${(graph.conceptGraph || []).reduce((n: number, g: any) => n + (g.concepts || []).length, 0)} 个底层概念` })
    emit('step', { stage: 'done', status: 'completed', title: '全部完成', detail: '经历与概念图谱已生成' })

    return { experienceText, conceptGraph: graph, outline }
  },

  async diagnose(id: number, answers: { concept: string; question: string; answer: string }[]): Promise<{ masteryMap: any }> {
    const project = internshipProjectRepo.findById(id)
    if (!project) throw new Error('项目不存在')
    if (!(project as any).conceptGraphJson || !(project as any).conceptGraphJson.trim()) {
      throw new Error('该项目尚未生成概念图谱，请先生成经历与图谱。')
    }
    const answerText = answers
      .map(a => `概念: ${a.concept}\n问题: ${a.question}\n回答: ${a.answer || '未作答'}`)
      .join('\n\n')
    const userMsg =
      `项目背景: ${(project as any).experienceText || (project as any).sourceText || '无'}\n\n` +
      `以下是候选人对各概念探测题的回答:\n\n${answerText}\n\n请逐概念判定掌握度等级。`
    const raw = await chat(MASTERY_DIAGNOSE_SYSTEM, userMsg)
    const parsed = safeJsonParse(stripJsonFence(raw))
    const masteryMap = parsed || { assessments: [], summary: '', weakFocus: [] }
    internshipProjectRepo.updateFields(id, { masteryMapJson: JSON.stringify(masteryMap) } as any)
    return { masteryMap }
  },
}

export type MasteryService = typeof masteryService
