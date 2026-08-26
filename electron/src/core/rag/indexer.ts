import { embeddingStore, type TextSegment } from './embedding-store'
import { embedAll, embed } from './embedding-client'
import type { InterviewExperience } from '../store/types'

// 对标 RagService:按字段分块索引 + 多路召回(向量+关键词)+ 简单 rerank + 公司/部门过滤 + 同一经验限流

const MAX_CHARS_PER_CHUNK = 800
const MAX_CHUNKS_PER_EXPERIENCE = 2
const THROTTLE_MS = 500

const TYPE_OVERVIEW = '总述'
const TYPE_INTERNSHIP = '实习'
const TYPE_PROJECT = '项目'
const TYPE_BAGU_JAVA = '八股_Java'
const TYPE_BAGU_AI = '八股_AI'
const TYPE_ALGORITHM = '算法'

interface ChunkMeta { text: string; type: string }

function buildChunks(exp: InterviewExperience): ChunkMeta[] {
  const list: ChunkMeta[] = []
  const company = exp.company ?? ''
  const dept = exp.department ?? ''
  const pos = exp.position ?? ''

  const overview = `公司: ${company}\n部门: ${dept}\n岗位: ${pos}\n内容: ${exp.content ?? ''}`
  if (overview.trim()) list.push({ text: overview, type: TYPE_OVERVIEW })

  if (exp.internshipExperiences?.trim())
    list.push({ text: `公司: ${company}\n部门: ${dept}\n实习经历: ${exp.internshipExperiences}`, type: TYPE_INTERNSHIP })
  if (exp.projectExperiences?.trim())
    list.push({ text: `公司: ${company}\n部门: ${dept}\n项目经历: ${exp.projectExperiences}`, type: TYPE_PROJECT })
  if (exp.projectExperience?.trim())
    list.push({ text: `公司: ${company}\n部门: ${dept}\n项目经历: ${exp.projectExperience}`, type: TYPE_PROJECT })
  if (exp.baguQuestions?.trim())
    list.push({ text: `公司: ${company}\n部门: ${dept}\n八股: ${exp.baguQuestions}`, type: TYPE_BAGU_JAVA })
  if (exp.llmQuestions?.trim())
    list.push({ text: `公司: ${company}\n部门: ${dept}\n大模型八股: ${exp.llmQuestions}`, type: TYPE_BAGU_AI })
  if (exp.algorithmQuestions?.trim()) {
    let algo = `公司: ${company}\n部门: ${dept}\n算法题: ${exp.algorithmQuestions}`
    if (exp.algorithmLink?.trim()) algo += `\n算法原题链接: ${exp.algorithmLink}`
    list.push({ text: algo, type: TYPE_ALGORITHM })
  }
  return list
}

function truncate(text: string): string {
  if (text.length > MAX_CHARS_PER_CHUNK) return text.slice(0, MAX_CHARS_PER_CHUNK) + '...'
  return text
}

/** 索引单条面经 */
export async function indexExperience(exp: InterviewExperience): Promise<void> {
  if (exp.id != null) embeddingStore.removeByExperienceId(exp.id)
  const chunks = buildChunks(exp)

  const segments: TextSegment[] = chunks
    .filter((c) => c.text && c.text.trim())
    .map((c) => ({
      text: truncate(c.text),
      metadata: {
        experienceId: exp.id != null ? String(exp.id) : '',
        company: exp.company ?? '',
        department: exp.department ?? '',
        type: c.type,
      },
    }))
  if (!segments.length) return

  // 批量 embedding;失败降级逐条
  let vectors: number[][]
  try {
    vectors = await embedAll(segments.map((s) => s.text))
  } catch (batchErr) {
    console.warn('批量 embedding 失败,降级逐条:', batchErr)
    vectors = []
    for (const seg of segments) {
      try { vectors.push(await embed(seg.text)) } catch (e) { console.error('逐条 embed 失败,跳过:', e) }
    }
  }

  for (let i = 0; i < vectors.length && i < segments.length; i++) {
    embeddingStore.add(vectors[i], segments[i])
  }
}

/** 批量索引(带节流) */
export async function indexExperiences(experiences: InterviewExperience[]): Promise<void> {
  for (let i = 0; i < experiences.length; i++) {
    await indexExperience(experiences[i])
    if (i < experiences.length - 1) await new Promise((r) => setTimeout(r, THROTTLE_MS))
  }
}

export function clearAll(): void {
  embeddingStore.clear()
}

export function storeSize(): number {
  return embeddingStore.size()
}

// ── 检索:多路召回 + rerank ──

function tokenize(q: string): string[] {
  if (!q) return []
  const cleaned = q.replace(/\s+/g, ' ').trim()
  if (!cleaned) return []
  const parts = cleaned.split(/[\s,，;；/|]+/)
  return parts.map((p) => p.trim()).filter((t) => t.length >= 2)
}

function keywordScore(tokens: string[], seg: TextSegment): number {
  if (!tokens.length || !seg) return 0
  const text = seg.text ?? ''
  const company = seg.metadata?.company ?? ''
  const dept = seg.metadata?.department ?? ''
  const type = seg.metadata?.type ?? ''
  const hay = `${company} ${dept} ${type} ${text}`.toLowerCase()
  let hit = 0
  for (const t of tokens) {
    if (hay.includes(t.toLowerCase())) hit++
  }
  return tokens.length ? hit / tokens.length : 0
}

interface Hit { score: number; seg: TextSegment }

/** 按 company/department 过滤,同一 experienceId 最多取 MAX_CHUNKS 块,取 top maxResults */
export async function search(query: string, company: string | null, department: string | null, maxResults: number): Promise<string[]> {
  const tokens = tokenize(query)

  // 1) 向量召回
  const queryVec = await embed(query)
  const fetchN = Math.max(maxResults * 3, 20)
  const vecMatches = embeddingStore.findRelevant(queryVec, fetchN, 0.4)

  // 2) 关键词召回
  const all = embeddingStore.allSegments()
  const keywordHits: Hit[] = []
  if (tokens.length && all.length) {
    for (const seg of all) {
      const ks = keywordScore(tokens, seg)
      if (ks <= 0) continue
      keywordHits.push({ score: 0.35 + ks * 0.25, seg })
    }
  }

  // 3) 融合 rerank(IdentityHashMap → 用 text 作 key 近似)
  const merged = new Map<string, { score: number; seg: TextSegment }>()
  const key = (seg: TextSegment) => `${seg.metadata?.experienceId ?? ''}:${seg.text.slice(0, 40)}`
  for (const m of vecMatches) {
    const seg = m.segment
    if (!seg) continue
    const s = m.score + keywordScore(tokens, seg) * 0.25
    const k = key(seg)
    const prev = merged.get(k)?.score ?? 0
    merged.set(k, { score: Math.max(prev, s), seg })
  }
  for (const h of keywordHits) {
    const k = key(h.seg)
    const prev = merged.get(k)?.score ?? 0
    merged.set(k, { score: Math.max(prev, h.score), seg: h.seg })
  }

  const candidates = [...merged.values()].sort((a, b) => b.score - a.score)

  // 4) 过滤(公司/部门)+ 同一经验限流
  const expCount = new Map<string, number>()
  const result: string[] = []
  for (const { seg } of candidates) {
    if (!seg.metadata) continue
    if (company) {
      const c = seg.metadata.company
      if (!c || company !== c) continue
    }
    if (department) {
      const d = seg.metadata.department
      if (!d || department !== d) continue
    }
    const eid = seg.metadata.experienceId ?? ''
    const cnt = expCount.get(eid) ?? 0
    if (cnt >= MAX_CHUNKS_PER_EXPERIENCE) continue
    expCount.set(eid, cnt + 1)
    result.push(seg.text)
    if (result.length >= maxResults) break
  }
  return result
}
