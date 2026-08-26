// tsx --import 入口:注册 electron stub + 从项目 data/model-config.json 注入 API Key 到 env
import { register } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const __dirname = dirname(fileURLToPath(import.meta.url))
register('./electron-stub.mjs', import.meta.url)

try {
  const { readFileSync } = await import('node:fs')
  const cfgPath = resolve(__dirname, '../../../data/model-config.json')
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'))
  if (cfg.llmApiKey) process.env.LLM_API_KEY = cfg.llmApiKey
  if (cfg.embeddingApiKey) process.env.EMBEDDING_API_KEY = cfg.embeddingApiKey
  console.log('[test] 注入 Key: LLM=' + (cfg.llmApiKey ? cfg.llmApiKey.slice(0, 8) + '...' : '(空)') + ' EMB=' + (cfg.embeddingApiKey ? cfg.embeddingApiKey.slice(0, 8) + '...' : '(空)'))
  console.log('[test] model 用默认 deepseek-chat(避开 v4-flash 工具调用坑)')
} catch (e) {
  console.warn('[test] 未读到 data/model-config.json,改用 env:', e.message)
}
