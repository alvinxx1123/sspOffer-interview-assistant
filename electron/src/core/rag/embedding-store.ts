// 对标 InterviewEmbeddingStore:内存向量库(CopyOnWriteArrayList 等价)
// 非持久化,启动时 reindex 重建(与 Java 侧行为一致)

export interface TextSegment {
  text: string
  metadata: Record<string, string>
}

export interface EmbeddingMatch {
  score: number
  id: string
  embedding: number[]
  segment: TextSegment
}

interface Entry {
  id: string
  vector: number[]
  segment: TextSegment
}

class InMemoryEmbeddingStore {
  private entries: Entry[] = []

  add(vector: number[], segment: TextSegment): string {
    const id = crypto.randomUUID()
    this.entries.push({ id, vector, segment })
    return id
  }

  addAll(items: { vector: number[]; segment: TextSegment }[]): string[] {
    return items.map((item) => this.add(item.vector, item.segment))
  }

  allSegments(): TextSegment[] {
    return this.entries.map((e) => e.segment).filter(Boolean)
  }

  removeByExperienceId(experienceId: string | number): void {
    const idStr = String(experienceId)
    this.entries = this.entries.filter((e) => e.segment.metadata?.experienceId !== idStr)
  }

  clear(): void {
    this.entries = []
  }

  findRelevant(queryVector: number[], maxResults: number, minScore: number): EmbeddingMatch[] {
    return this.entries
      .map((e) => ({
        score: cosineScore(queryVector, e.vector),
        id: e.id,
        embedding: e.vector,
        segment: e.segment,
      }))
      .filter((m) => m.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
  }

  size(): number {
    return this.entries.length
  }
}

function cosineScore(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export const embeddingStore = new InMemoryEmbeddingStore()
