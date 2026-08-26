import { AgentHarness, type ChatTurn } from './harness'
import { getChatModel } from './chat-model'
import { allTools } from './tools'
import { TOOLS_ASSISTANT_SYSTEM, CHAT_SESSION_SYSTEM } from '../prompts'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { algorithmRepo, chatSessionRepo } from '../store/repositories'

// Agent 带 Function Calling 的面试助手
// 支持两种模式：
//   1. chatWithTools / chatWithToolsStream — 单轮，工具调用助手（面经搜索页用）
//   2. chatWithSession / chatWithSessionStream — 多轮，带历史记忆（AI 面试页用）
// 底层统一由 AgentHarness 驱动：流式输出 + 上下文截断 + 工具错误恢复 + 可观测性

const TOOL_TOOLS: StructuredToolInterface[] = allTools as unknown as StructuredToolInterface[]

// ── 单轮：工具调用助手 ──

export async function chatWithTools(userMessage: string): Promise<string> {
  if (!userMessage?.trim()) {
    return '请输入您的问题,例如:查一下字节后端的面经、给我一道中等难度的算法题、运行这段 Java 代码。'
  }
  const msg = userMessage.trim()
  if (isAlgorithmQuery(msg)) return handleAlgorithmQuery(msg)

  const harness = new AgentHarness({
    systemPrompt: TOOLS_ASSISTANT_SYSTEM,
    tools: TOOL_TOOLS,
    maxIterations: 6,
  })
  return harness.run(msg)
}

/** 流式单轮：逐 token yield delta */
export async function* chatWithToolsStream(userMessage: string): AsyncGenerator<{
  type: string
  data: Record<string, unknown>
}> {
  if (!userMessage?.trim()) {
    yield { type: 'done', data: { text: '请输入您的问题。' } }
    return
  }
  const msg = userMessage.trim()
  if (isAlgorithmQuery(msg)) {
    const text = handleAlgorithmQuery(msg)
    yield { type: 'delta', data: { text } }
    yield { type: 'done', data: { text } }
    return
  }
  const harness = new AgentHarness({
    systemPrompt: TOOLS_ASSISTANT_SYSTEM,
    tools: TOOL_TOOLS,
    maxIterations: 6,
  })
  for await (const ev of harness.stream(msg)) {
    yield ev
  }
}

// ── 多轮：带 Session 记忆的面试官 ──

interface SessionContext {
  questions?: string
  resume?: string
  company?: string
  department?: string
}

export async function chatWithSession(
  sessionId: string,
  userMessage: string,
  context?: SessionContext
): Promise<string> {
  const { history, numericId, nextSort, session } = await loadSession(sessionId, context)
  if (!userMessage?.trim()) return '请输入您的回答。'

  // 持久化用户消息
  chatSessionRepo.addMessage({ sessionId: numericId, role: 'user', content: userMessage, sortOrder: nextSort })

  const harness = new AgentHarness({
    systemPrompt: buildInterviewerSystemPrompt(context),
    tools: TOOL_TOOLS,
    maxIterations: 6,
    maxContextTokens: 6000,
    maxHistoryMessages: 20,
  })
  const reply = await harness.run(userMessage, history)

  // 持久化 assistant 回复
  chatSessionRepo.addMessage({ sessionId: numericId, role: 'assistant', content: reply, sortOrder: nextSort + 1 })

  // 更新 session 的 resume/company 等字段（首次）
  if (session && (!session.resume || !session.company)) {
    chatSessionRepo.endSession(session.id!, {
      resume: context?.resume ?? null,
      company: context?.company ?? null,
      department: context?.department ?? null,
      questions: context?.questions ?? null,
    })
  }

  return reply
}

/** 流式多轮面试对话 */
export async function* chatWithSessionStream(
  sessionId: string,
  userMessage: string,
  context?: SessionContext
): AsyncGenerator<{ type: string; data: Record<string, unknown> }> {
  const { history, numericId, nextSort, session } = await loadSession(sessionId, context)
  if (!userMessage?.trim()) {
    yield { type: 'done', data: { text: '请输入您的回答。' } }
    return
  }

  chatSessionRepo.addMessage({ sessionId: numericId, role: 'user', content: userMessage, sortOrder: nextSort })

  const harness = new AgentHarness({
    systemPrompt: buildInterviewerSystemPrompt(context),
    // 接通工具：面试官在对话中可调用面经检索/算法题/代码执行
    tools: TOOL_TOOLS,
    maxIterations: 6,
    maxContextTokens: 6000,
    maxHistoryMessages: 20,
  })

  let fullReply = ''
  for await (const ev of harness.stream(userMessage, history)) {
    if (ev.type === 'delta') fullReply += ev.data.text as string
    yield ev
  }

  // 从 done 事件取最终文本（经过格式化）
  const finalText = fullReply || '抱歉，未能生成回复。'
  chatSessionRepo.addMessage({ sessionId: numericId, role: 'assistant', content: finalText, sortOrder: nextSort + 1 })

  if (session && (!session.resume || !session.company)) {
    chatSessionRepo.endSession(session.id!, {
      resume: context?.resume ?? null,
      company: context?.company ?? null,
      department: context?.department ?? null,
      questions: context?.questions ?? null,
    })
  }
}

// ── Session 加载公共逻辑 ──

async function loadSession(sessionId: string, context?: SessionContext) {
  let session = chatSessionRepo.findBySessionId(sessionId)
  if (!session) {
    session = chatSessionRepo.create({
      sessionId,
      questions: context?.questions ?? null,
      resume: context?.resume ?? null,
      company: context?.company ?? null,
      department: context?.department ?? null,
    })
  }
  const numericId = session.id!
  const history = chatSessionRepo.findMessages(numericId)
  const recent = history.slice(-20)
  const nextSort = (history[history.length - 1]?.sortOrder ?? 0) + 1
  const chatTurns: ChatTurn[] = recent.map((m: any) => ({ role: m.role, content: m.content }))
  return { history: chatTurns, numericId, nextSort, session }
}

function buildInterviewerSystemPrompt(ctx?: SessionContext): string {
  let prompt = CHAT_SESSION_SYSTEM
  if (ctx?.company || ctx?.department) {
    prompt += `\n\n目标公司: ${ctx.company || '未指定'} / 部门: ${ctx.department || '未指定'}`
  }
  if (ctx?.resume) {
    prompt += `\n\n候选人简历摘要:\n${ctx.resume.slice(0, 2000)}`
  }
  if (ctx?.questions) {
    prompt += `\n\n参考面试题（可按此顺序提问，也可根据回答灵活调整）:\n${ctx.questions}`
  }
  prompt += `\n\n面试规则:
1. 每次只问一个问题，等候选人回答后再追问或换题
2. 候选人回答后，先简短评价（正确/部分正确/需补强），再追问或转下一题
3. 追问要基于候选人回答中的薄弱点深入
4. 全程用中文，语气专业友好
5. 不要一次性输出所有问题`
  return prompt
}

// ── 算法题直接处理分支 ──

function isAlgorithmQuery(message: string): boolean {
  if (!message) return false
  const m = message.trim().replace(/\s+/g, ' ')
  if (m.length <= 25 && (m.includes('算法题') || m.includes('一道题'))) return true
  return /(给|来|推荐).*(算法题|一道题|题目)/.test(m)
    || /(一道|来道).*题/.test(m)
    || m.includes('算法题')
    || m.includes('一道算法题')
}

function handleAlgorithmQuery(userQuery: string): string {
  const keyword = extractKeyword(userQuery)
  if (keyword) {
    const list = algorithmRepo.findByTitleContainingIgnoreCase(keyword)
    if (list.length) {
      const q = list[0]
      return `已查到: ${q.title}(${q.difficulty ?? 'medium'})\n做题链接: /#/ide?questionId=${q.id}`
    }
    return `本站题库无「${keyword}」。\n力扣搜索: https://leetcode.cn/problemset/all/?search=${encodeURIComponent(keyword)}`
  }
  const all = algorithmRepo.findAll()
  if (!all.length) return '题库暂无题目。'
  const q = all[Math.floor(Math.random() * all.length)]
  return `已随机抽取: ${q.title}(${q.difficulty ?? 'medium'})\n做题链接: /#/ide?questionId=${q.id}`
}

function extractKeyword(userQuery: string): string {
  const s = userQuery
    .replace(/(给我|来一道|推荐一道|一道|的|算法题|查询|搜索|一下)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return s || ''
}
