// Agent 可观测性：内存环形缓冲区，记录每次 agent 运行的工具调用、token 用量、迭代、错误
// 可通过 IPC 查询，供设置页调试面板展示

export interface AgentLogEntry {
  ts: number
  runId: string
  type: 'start' | 'iteration' | 'tool_call' | 'tool_result' | 'delta' | 'done' | 'error'
  data: Record<string, unknown>
}

const MAX_ENTRIES = 500
const buffer: AgentLogEntry[] = []
let runCounter = 0

function nextRunId(): string {
  runCounter += 1
  return `run-${Date.now()}-${runCounter}`
}

export function newRunId(): string {
  return nextRunId()
}

export function log(runId: string, type: AgentLogEntry['type'], data: Record<string, unknown> = {}): void {
  buffer.push({ ts: Date.now(), runId, type, data })
  if (buffer.length > MAX_ENTRIES) buffer.shift()
}

export function getRecentEntries(limit = 100): AgentLogEntry[] {
  return buffer.slice(-limit)
}

export function clearEntries(): void {
  buffer.length = 0
}

export function getStats(): { totalRuns: number; totalToolCalls: number; totalErrors: number } {
  let toolCalls = 0
  let errors = 0
  const runs = new Set<string>()
  for (const e of buffer) {
    if (e.type === 'tool_call') toolCalls++
    if (e.type === 'error') errors++
    if (e.runId) runs.add(e.runId)
  }
  return { totalRuns: runs.size, totalToolCalls: toolCalls, totalErrors: errors }
}
