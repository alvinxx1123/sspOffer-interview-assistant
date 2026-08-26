// AgentHarness —— 可复用的 Agent 运行容器
// 封装：流式输出、上下文窗口管理、可配置迭代上限、工具错误恢复、可观测性
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { getChatModel } from './chat-model'
import { newRunId, log } from './agent-log'

export interface HarnessEvent {
  type: 'start' | 'delta' | 'tool_call' | 'tool_result' | 'iteration' | 'done' | 'error'
  data: Record<string, unknown>
}

export interface HarnessConfig {
  systemPrompt: string
  tools?: StructuredToolInterface[]
  maxIterations?: number // 默认 6
  maxContextTokens?: number // 默认 6000，超出则截断历史
  maxHistoryMessages?: number // 默认 20，最多保留历史条数
  toolRetries?: number // 工具瞬时错误重试次数，默认 1
  temperature?: number
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

// 粗略 token 估算：英文 ~4 字符/token，中文 ~1.5 字符/token，取中间值 chars/3
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 3)
}

export function estimateMessagesTokens(messages: { content: string }[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content ?? ''), 0)
}

// 截断历史：保留 system + 最后 N 条，且总 token 不超预算
export function trimContext(
  messages: any[],
  opts: { maxTokens: number; maxMessages: number }
): any[] {
  if (messages.length <= 2) return messages
  const system = messages[0]
  const rest = messages.slice(1)
  let kept = [...rest]
  while (kept.length > opts.maxMessages || estimateMessagesTokens(kept) > opts.maxTokens) {
    if (kept.length <= 2) break
    kept = kept.slice(2) // 丢掉最早的一对(user/assistant)
  }
  return [system, ...kept]
}

// 批量格式化
export function finalFormatting(text: string): string {
  if (!text) return ''
  return text.replace(/ {2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

export function fixMalformedLinks(text: string): string {
  return text.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi, '[$2]($1)')
}

export class AgentHarness {
  readonly runId: string
  private cfg: Required<HarnessConfig>

  constructor(config: HarnessConfig) {
    this.runId = newRunId()
    this.cfg = {
      systemPrompt: config.systemPrompt,
      tools: config.tools ?? [],
      maxIterations: config.maxIterations ?? 6,
      maxContextTokens: config.maxContextTokens ?? 6000,
      maxHistoryMessages: config.maxHistoryMessages ?? 20,
      toolRetries: config.toolRetries ?? 1,
      temperature: config.temperature ?? 0.7,
    }
  }

  /** 流式运行：yield HarnessEvent，最终 done 携带完整文本 */
  async *stream(userMessage: string, history: ChatTurn[] = []): AsyncGenerator<HarnessEvent> {
    const model = getChatModel()
    const tools = this.cfg.tools
    const bound = tools.length ? model.bindTools(tools) : model

    // 构建初始 messages
    const messages: any[] = [new SystemMessage(this.cfg.systemPrompt)]
    for (const t of history) {
      if (t.role === 'user') messages.push(new HumanMessage(t.content))
      else messages.push(new AIMessage(t.content))
    }
    messages.push(new HumanMessage(userMessage))

    log(this.runId, 'start', { toolsCount: tools.length, historyLen: history.length })

    let finalText = ''

    for (let i = 0; i < this.cfg.maxIterations; i++) {
      log(this.runId, 'iteration', { iteration: i })
      yield { type: 'iteration', data: { iteration: i } }

      // 上下文窗口管理：每次迭代前截断
      const trimmed = trimContext(messages, {
        maxTokens: this.cfg.maxContextTokens,
        maxMessages: this.cfg.maxHistoryMessages,
      })
      if (trimmed.length < messages.length) messages.splice(1, messages.length - trimmed.length, ...trimmed.slice(1))

      // 流式调用模型
      let accContent = ''
      let accToolCalls: any[] = []
      try {
        const stream = await bound.stream(messages)
        for await (const chunk of stream) {
          const text = typeof chunk.content === 'string' ? chunk.content : ''
          if (text) {
            accContent += text
            yield { type: 'delta', data: { text } }
          }
          const tc = (chunk as any).tool_call_chunks ?? (chunk as any).additional_kwargs?.tool_calls
          if (tc) accToolCalls = accToolCalls.concat(tc)
        }
      } catch (e: any) {
        log(this.runId, 'error', { phase: 'stream', error: e?.message })
        yield { type: 'error', data: { message: e?.message ?? '模型调用失败' } }
        finalText = '抱歉，模型调用出错，请重试。'
        break
      }

      const aiMsg = new AIMessage(accContent)
      ;(aiMsg as any).tool_calls = accToolCalls
      messages.push(aiMsg)

      if (!accToolCalls.length) {
        finalText = fixMalformedLinks(finalFormatting(accContent))
        break
      }

      // 执行工具调用
      for (const call of accToolCalls) {
        const name = call.name ?? call.function?.name
        const args = call.args ?? (call.function?.arguments ? safeParse(call.function.arguments) : {})
        log(this.runId, 'tool_call', { name, args })
        yield { type: 'tool_call', data: { name, args, iteration: i } }

        const matched = tools.find((t) => t.name === name)
        if (!matched) {
          const msg = `工具 ${name} 不存在`
          log(this.runId, 'tool_result', { name, error: msg })
          messages.push(new ToolMessage({ tool_call_id: call.id ?? '', content: msg }))
          yield { type: 'tool_result', data: { name, error: msg } }
          continue
        }

        let resultText = ''
        let lastErr = ''
        for (let attempt = 0; attempt <= this.cfg.toolRetries; attempt++) {
          try {
            const result = await matched.invoke(args)
            resultText = typeof result === 'string' ? result : result?.content ?? JSON.stringify(result)
            lastErr = ''
            break
          } catch (e: any) {
            lastErr = e?.message ?? String(e)
            log(this.runId, 'tool_result', { name, attempt, error: lastErr })
            if (attempt >= this.cfg.toolRetries) break
          }
        }

        if (lastErr) {
          // 工具错误恢复：把错误信息回传给模型，让其自行调整
          const recovery = `工具 ${name} 执行失败: ${lastErr}。请检查参数或改用其他方式回答。`
          messages.push(new ToolMessage({ tool_call_id: call.id ?? '', content: recovery }))
          yield { type: 'tool_result', data: { name, error: lastErr } }
        } else {
          messages.push(new ToolMessage({ tool_call_id: call.id ?? '', content: resultText }))
          yield { type: 'tool_result', data: { name, result: resultText.slice(0, 200) } }
        }
      }
      // 继续下一轮迭代，让模型基于工具结果生成最终回复
    }

    if (!finalText) {
      // 达到最大迭代次数，做一次无工具的兜底调用
      try {
        const res = await model.invoke(messages)
        finalText = fixMalformedLinks(finalFormatting(typeof res.content === 'string' ? res.content : JSON.stringify(res.content)))
      } catch {
        finalText = '抱歉，处理超时，请重试。'
      }
    }

    log(this.runId, 'done', { length: finalText.length })
    yield { type: 'done', data: { text: finalText } }
  }

  /** 非流式运行：返回完整文本 */
  async run(userMessage: string, history: ChatTurn[] = []): Promise<string> {
    let text = ''
    for await (const ev of this.stream(userMessage, history)) {
      if (ev.type === 'done') text = (ev.data.text as string) ?? ''
      if (ev.type === 'error') text = ev.data.message as string
    }
    return text
  }
}

function safeParse(s: string): any {
  try { return JSON.parse(s) } catch { return {} }
}
