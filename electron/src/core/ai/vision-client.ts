import { apiConfig } from '../api-config'

// OpenAI 兼容的多模态 LLM 调用
// 支持两种 API 格式:
//   1. Chat Completions (标准 OpenAI: /chat/completions, image_url/text)
//   2. Responses API (Volcengine Ark 新模型: /responses, input_image/input_text)
// 自动回退: 先试 Chat Completions, 404/失败则试 Responses API

interface VisionResult {
  content: string
}

export async function callVision(imageBase64: string, mimeType: string, prompt: string): Promise<string> {
  if (!apiConfig.isVisionConfigured()) {
    throw new Error('多模态 LLM API Key 未配置。请在「设置」页填入多模态模型配置。')
  }

  const baseUrl = apiConfig.visionBaseUrl.replace(/\/$/, '')
  const dataUrl = `data:${mimeType};base64,${imageBase64}`

  // 先试 Chat Completions API (兼容 OpenAI / 通义 / 旧版 Ark 视觉模型)
  try {
    const result = await tryChatCompletions(baseUrl, dataUrl, prompt)
    if (result) return result
  } catch (e: any) {
    // 404 或 endpoint not found → 回退到 Responses API
    if (!isEndpointError(e)) throw e
  }

  // 回退: Responses API (Volcengine Ark 新模型如 doubao-seed-2-0-mini)
  try {
    const result = await tryResponsesApi(baseUrl, dataUrl, prompt)
    if (result) return result
  } catch (e: any) {
    throw new Error(`多模态 LLM 调用失败: ${e?.message || '未知错误'}`)
  }

  throw new Error('多模态 LLM 返回空内容')
}

function isEndpointError(e: any): boolean {
  const msg = String(e?.message || '')
  return msg.includes('404') || msg.includes('Not Found') || msg.includes('not found') || msg.includes('unsupported')
}

async function tryChatCompletions(baseUrl: string, dataUrl: string, prompt: string): Promise<string | null> {
  const url = baseUrl.endsWith('/chat/completions')
    ? baseUrl
    : `${baseUrl}/chat/completions`

  const body = {
    model: apiConfig.visionModel,
    max_tokens: 8192,
    temperature: 0.3,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiConfig.visionApiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    let msg = `${res.status} ${res.statusText}`
    try {
      const errJson = JSON.parse(errText)
      if (errJson?.error?.message) msg = errJson.error.message
    } catch {}
    throw new Error(`Chat Completions: ${msg}`)
  }

  const json = await res.json()
  const content = json?.choices?.[0]?.message?.content
  if (!content) return null
  return typeof content === 'string' ? content : JSON.stringify(content)
}

async function tryResponsesApi(baseUrl: string, dataUrl: string, prompt: string): Promise<string | null> {
  const url = baseUrl.endsWith('/responses')
    ? baseUrl
    : `${baseUrl}/responses`

  const body = {
    model: apiConfig.visionModel,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_image', image_url: dataUrl },
          { type: 'input_text', text: prompt },
        ],
      },
    ],
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiConfig.visionApiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    let msg = `${res.status} ${res.statusText}`
    try {
      const errJson = JSON.parse(errText)
      if (errJson?.error?.message) msg = errJson.error.message
    } catch {}
    throw new Error(`Responses API: ${msg}`)
  }

  const json = await res.json()
  // Responses API 返回格式: json.output[0].content[0].text
  const output = json?.output
  if (Array.isArray(output)) {
    for (const item of output) {
      if (item?.content && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c?.text) return c.text
          if (c?.type === 'output_text' && c?.text) return c.text
        }
      }
    }
  }
  // 某些实现可能直接返回 choices 格式
  const choices = json?.choices
  if (Array.isArray(choices) && choices[0]?.message?.content) {
    const c = choices[0].message.content
    return typeof c === 'string' ? c : JSON.stringify(c)
  }
  return null
}

/** 从 LLM 返回文本中提取 JSON(兼容 markdown 代码块包裹) */
export function extractJson(text: string): any {
  if (!text) return null
  let s = text.trim()
  // 去掉 ```json ... ``` 包裹
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) s = fenceMatch[1].trim()
  try {
    return JSON.parse(s)
  } catch {
    // 尝试找第一个 { 到最后一个 }
    const first = s.indexOf('{')
    const last = s.lastIndexOf('}')
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(s.slice(first, last + 1))
      } catch {}
    }
    return null
  }
}
