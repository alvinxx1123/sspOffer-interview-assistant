import { apiConfig } from '../api-config'

// 对标 ZhipuEmbeddingModel:OpenAI 兼容 embedding 端点(智谱 embedding-3)
// 批量 + 指数退避(429) + 降级逐条 embed,与 Java 侧逻辑一致

const MAX_RETRY = 3

export async function embed(text: string): Promise<number[]> {
  const list = await embedAll([text])
  return list[0] ?? []
}

export async function embedAll(texts: string[]): Promise<number[][]> {
  if (!apiConfig.isEmbeddingConfigured()) {
    throw new Error('Embedding API Key 未配置。请在前端「设置」页填入,或设置环境变量 EMBEDDING_API_KEY。')
  }
  if (!texts.length) return []

  let lastErr: unknown = null
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      return await doRequest(texts)
    } catch (e: any) {
      lastErr = e
      const status = e?.status ?? e?.response?.status
      if (status === 429 && attempt < MAX_RETRY) {
        await sleepBackoff(attempt, '429 限流')
        continue
      }
      if (status >= 500 && attempt < MAX_RETRY) {
        await sleepBackoff(attempt, `${status} 服务端错误`)
        continue
      }
      throw new Error(`Embedding 调用失败: ${e?.message ?? e}`)
    }
  }
  throw new Error(`Embedding 调用失败(重试耗尽): ${(lastErr as any)?.message ?? 'unknown'}`)
}

async function doRequest(texts: string[]): Promise<number[][]> {
  const baseUrl = apiConfig.embeddingBaseUrl.replace(/\/$/, '')
  const url = baseUrl.endsWith('/embeddings')
    ? baseUrl
    : `${baseUrl}/embeddings`

  // 智谱/OpenAI 兼容:单条 input 可为 string,多条为数组
  const body: Record<string, unknown> = {
    model: apiConfig.embeddingModel,
    input: texts.length === 1 ? texts[0] : texts,
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiConfig.embeddingApiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err: any = new Error(`Embedding HTTP ${res.status}`)
    err.status = res.status
    throw err
  }

  const data = await res.json()
  const items: any[] = data?.data ?? []
  if (!items.length) throw new Error('Embedding 返回无 data')

  // 按 index 排序(批量返回可能乱序)
  items.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))

  return items.map((m) => {
    const vec: number[] = m.embedding ?? []
    return vec
  })
}

function sleepBackoff(attempt: number, reason: string): Promise<void> {
  const backoff = 1000 * Math.pow(2, attempt)
  console.warn(`Embedding ${reason},${backoff}ms 后重试(第${attempt + 1}次)`)
  return new Promise((r) => setTimeout(r, backoff))
}
