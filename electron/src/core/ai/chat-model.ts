import { ChatOpenAI } from '@langchain/openai'
import { apiConfig } from '../api-config'

// 对标 LangChain4j ChatLanguageModel:DeepSeek(OpenAI 兼容)
// 运行时从 apiConfig 读 apiKey/baseUrl/model,配置变更时重建

let chatModel: ChatOpenAI | null = null
let cachedKey = ''

export function getChatModel(): ChatOpenAI {
  const key = `${apiConfig.llmApiKey}:${apiConfig.llmBaseUrl}:${apiConfig.llmModel}`
  if (chatModel && cachedKey === key) return chatModel
  chatModel = new ChatOpenAI({
    model: apiConfig.llmModel,
    apiKey: apiConfig.llmApiKey,
    configuration: { baseURL: apiConfig.llmBaseUrl },
    temperature: 0.7,
    maxTokens: 8192,
  })
  cachedKey = key
  return chatModel
}

/** 单次对话(无工具) */
export async function chat(systemPrompt: string, userMessage: string): Promise<string> {
  if (!apiConfig.isLlmConfigured()) {
    throw new Error('LLM API Key 未配置。请在前端「设置」页填入,或设置环境变量 LLM_API_KEY。')
  }
  const model = getChatModel()
  const res = await model.invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ])
  return typeof res.content === 'string' ? res.content : JSON.stringify(res.content)
}

/** 流式对话(SSE 等价):逐 token yield */
export async function* chatStream(systemPrompt: string, userMessage: string): AsyncGenerator<string> {
  if (!apiConfig.isLlmConfigured()) {
    throw new Error('LLM API Key 未配置。请在前端「设置」页填入。')
  }
  const model = getChatModel()
  const stream = await model.stream([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ])
  for await (const chunk of stream) {
    const text = typeof chunk.content === 'string' ? chunk.content : ''
    if (text) yield text
  }
}
