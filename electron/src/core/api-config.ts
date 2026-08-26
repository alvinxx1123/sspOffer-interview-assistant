import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

// 对标 ModelConfigHolder:运行时模型配置,持久化到 userData/model-config.json
// 优先级:持久化文件 > 环境变量 > 默认值

const DEFAULT_LLM_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_EMBEDDING_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'
const DEFAULT_LLM_MODEL = 'deepseek-chat'
const DEFAULT_EMBEDDING_MODEL = 'embedding-3'
const DEFAULT_VISION_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
const DEFAULT_VISION_MODEL = ''

interface ModelConfig {
  llmApiKey: string
  llmBaseUrl: string
  llmModel: string
  embeddingApiKey: string
  embeddingBaseUrl: string
  embeddingModel: string
  visionApiKey: string
  visionBaseUrl: string
  visionModel: string
  // 语音转写
  sttEngine: '' | 'webspeech' | 'doubao' | 'aliyun' | 'whisper' | 'auto'
  sttApiKey: string          // 为空时回退到 llmApiKey（Whisper 兼容 OpenAI 格式）
  sttBaseUrl: string          // 为空时回退到 llmBaseUrl
  sttModel: string           // whisper-1 等
}

class ApiConfigHolder {
  private cfg: ModelConfig = {
    llmApiKey: '',
    llmBaseUrl: DEFAULT_LLM_BASE_URL,
    llmModel: DEFAULT_LLM_MODEL,
    embeddingApiKey: '',
    embeddingBaseUrl: DEFAULT_EMBEDDING_BASE_URL,
    embeddingModel: DEFAULT_EMBEDDING_MODEL,
    visionApiKey: '',
    visionBaseUrl: DEFAULT_VISION_BASE_URL,
    visionModel: DEFAULT_VISION_MODEL,
    sttEngine: '',
    sttApiKey: '',
    sttBaseUrl: '',
    sttModel: 'whisper-1',
  }

  constructor() {
    this.load()
  }

  private configPath(): string {
    return join(app.getPath('userData'), 'model-config.json')
  }

  private load(): void {
    let loaded = false
    const path = this.configPath()
    if (existsSync(path)) {
      try {
        const data = JSON.parse(readFileSync(path, 'utf-8'))
        this.cfg = { ...this.cfg, ...data }
        loaded = true
        // 旧版 model-config.json 没 sttEngine 字段 → cfg.sttEngine 已是默认值 ''，不需要迁移
        // 已配置过 sttEngine 的用户：保留他们之前的值（不强制覆盖）
      } catch (e) {
        console.warn('读取 model-config.json 失败,回退默认:', e)
      }
    }
    if (!loaded) {
      this.cfg.llmApiKey = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || ''
      this.cfg.llmBaseUrl = this.cfg.llmBaseUrl || DEFAULT_LLM_BASE_URL
      this.cfg.llmModel = this.cfg.llmModel || DEFAULT_LLM_MODEL
      this.cfg.embeddingApiKey = process.env.EMBEDDING_API_KEY || process.env.ZHIPU_API_KEY || ''
      this.cfg.embeddingBaseUrl = this.cfg.embeddingBaseUrl || DEFAULT_EMBEDDING_BASE_URL
      this.cfg.embeddingModel = this.cfg.embeddingModel || DEFAULT_EMBEDDING_MODEL
      this.cfg.visionApiKey = process.env.VISION_API_KEY || ''
      this.cfg.visionBaseUrl = this.cfg.visionBaseUrl || DEFAULT_VISION_BASE_URL
      this.cfg.visionModel = this.cfg.visionModel || DEFAULT_VISION_MODEL
    }
  }

  private persist(): void {
    try {
      const dir = app.getPath('userData')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(this.configPath(), JSON.stringify(this.cfg, null, 2))
    } catch (e) {
      console.warn('持久化 model-config.json 失败:', e)
    }
  }

  updateLlm(apiKey?: string, baseUrl?: string, model?: string): void {
    let changed = false
    if (apiKey && apiKey.trim()) { this.cfg.llmApiKey = apiKey.trim(); changed = true }
    if (baseUrl && baseUrl.trim()) { this.cfg.llmBaseUrl = baseUrl.trim(); changed = true }
    if (model && model.trim()) { this.cfg.llmModel = model.trim(); changed = true }
    if (changed) this.persist()
  }

  updateEmbedding(apiKey?: string, baseUrl?: string, model?: string): void {
    let changed = false
    if (apiKey && apiKey.trim()) { this.cfg.embeddingApiKey = apiKey.trim(); changed = true }
    if (baseUrl && baseUrl.trim()) { this.cfg.embeddingBaseUrl = baseUrl.trim(); changed = true }
    if (model && model.trim()) { this.cfg.embeddingModel = model.trim(); changed = true }
    if (changed) this.persist()
  }

  updateVision(apiKey?: string, baseUrl?: string, model?: string): void {
    let changed = false
    if (apiKey && apiKey.trim()) { this.cfg.visionApiKey = apiKey.trim(); changed = true }
    if (baseUrl && baseUrl.trim()) { this.cfg.visionBaseUrl = baseUrl.trim(); changed = true }
    if (model && model.trim()) { this.cfg.visionModel = model.trim(); changed = true }
    if (changed) this.persist()
  }

  updateStt(engine?: 'webspeech' | 'whisper', apiKey?: string, baseUrl?: string, model?: string): void {
    let changed = false
    if (engine !== undefined && ['','webspeech','doubao','aliyun','whisper','auto'].includes(engine)) { this.cfg.sttEngine = engine as any; changed = true }
    if (apiKey !== undefined) { this.cfg.sttApiKey = (apiKey || '').trim(); changed = true }
    if (baseUrl !== undefined) { this.cfg.sttBaseUrl = (baseUrl || '').trim(); changed = true }
    if (model && model.trim()) { this.cfg.sttModel = model.trim(); changed = true }
    if (changed) this.persist()
  }

  get llmApiKey() { return this.cfg.llmApiKey }
  get llmBaseUrl() { return this.cfg.llmBaseUrl || DEFAULT_LLM_BASE_URL }
  get llmModel() { return this.cfg.llmModel || DEFAULT_LLM_MODEL }
  get embeddingApiKey() { return this.cfg.embeddingApiKey }
  get embeddingBaseUrl() { return this.cfg.embeddingBaseUrl || DEFAULT_EMBEDDING_BASE_URL }
  get embeddingModel() { return this.cfg.embeddingModel || DEFAULT_EMBEDDING_MODEL }
  get visionApiKey() { return this.cfg.visionApiKey }
  get visionBaseUrl() { return this.cfg.visionBaseUrl || DEFAULT_VISION_BASE_URL }
  get visionModel() { return this.cfg.visionModel || DEFAULT_VISION_MODEL }
  get sttEngine(): '' | 'webspeech' | 'doubao' | 'aliyun' | 'whisper' | 'auto' { return (this.cfg.sttEngine || '') as any }
  get sttApiKey(): string { return this.cfg.sttApiKey.trim() || this.cfg.llmApiKey.trim() }
  get sttBaseUrl(): string { return this.cfg.sttBaseUrl.trim() || '' }
  get sttModel(): string { return this.cfg.sttModel.trim() || 'whisper-1' }
  isSttConfigured(): boolean {
    const e = this.cfg.sttEngine || ''
    if (e === '') return false // 用户未选择任何引擎
    if (e === 'webspeech') return true // 浏览器内置，不需要 key（但可能受网络限制）
    if (e === 'auto') {
      // auto：只要任一 provider 配置过 key 就算 OK
      return !!this.sttApiKey.trim() || !!this.llmApiKey.trim()
    }
    return !!this.sttApiKey.trim() || (e === 'whisper' && !!this.llmApiKey.trim())
  }

  isLlmConfigured(): boolean { return !!this.cfg.llmApiKey && !!this.cfg.llmApiKey.trim() }
  isEmbeddingConfigured(): boolean { return !!this.cfg.embeddingApiKey && !!this.cfg.embeddingApiKey.trim() }
  isVisionConfigured(): boolean { return !!this.cfg.visionApiKey && !!this.cfg.visionApiKey.trim() }

  snapshot(): ModelConfig { return { ...this.cfg } }
}

export const apiConfig = new ApiConfigHolder()
