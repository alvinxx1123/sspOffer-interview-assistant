import { useState, useEffect } from 'react'
import { api } from '../api/adapter'
import './Settings.css'

function engineLabel(e) {
  return {
    '': '未选择',
    webspeech: 'Web Speech（浏览器内置）',
    doubao: '字节豆包 ASR 2.0（WebSocket）',
    aliyun: '阿里云百炼 Paraformer（REST）',
    whisper: 'OpenAI Whisper（OpenAI 兼容）',
    auto: 'Auto（自动选择）',
  }[e] ?? '未选择'
}

export default function Settings() {
  const [llm, setLlm] = useState({ apiKey: '', baseUrl: '', model: '', configured: false })
  const [emb, setEmb] = useState({ apiKey: '', baseUrl: '', model: '', configured: false })
  const [vis, setVis] = useState({ apiKey: '', baseUrl: '', model: '', configured: false })
  const [stt, setStt] = useState({ engine: '', apiKey: '', baseUrl: '', model: '', configured: false })
  const [llmInput, setLlmInput] = useState({ apiKey: '', baseUrl: '', model: '' })
  const [embInput, setEmbInput] = useState({ apiKey: '', baseUrl: '', model: '' })
  const [visInput, setVisInput] = useState({ apiKey: '', baseUrl: '', model: '' })
  const [sttInput, setSttInput] = useState({ apiKey: '', baseUrl: '', model: '' })
  const [saving, setSaving] = useState(false)
  const [reindexing, setReindexing] = useState(false)
  const [msg, setMsg] = useState('')
  const [agentStats, setAgentStats] = useState(null)
  const [agentLogs, setAgentLogs] = useState([])
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const r = await api.getModelSettings()
      setLlm(r.llm || {})
      setEmb(r.embedding || {})
      setVis(r.vision || {})
      setLlmInput({ apiKey: '', baseUrl: r.llm?.baseUrl || '', model: r.llm?.model || '' })
      setEmbInput({ apiKey: '', baseUrl: r.embedding?.baseUrl || '', model: r.embedding?.model || '' })
      setVisInput({ apiKey: '', baseUrl: r.vision?.baseUrl || '', model: r.vision?.model || '' })
      setStt(r.stt || { engine: '', configured: false })
      setSttInput({ apiKey: '', baseUrl: r.stt?.baseUrl || '', model: r.stt?.model || '' })
      // 同步给 useVoiceInput
      try { localStorage.setItem('sspoffer:stt', JSON.stringify({ engine: r.stt?.engine || '' })) } catch {}
    } catch (e) { setErr(e.message) }
  }

  const save = async () => {
    setSaving(true); setMsg(''); setErr('')
    try {
      const r = await api.updateModelSettings(
        { apiKey: llmInput.apiKey, baseUrl: llmInput.baseUrl, model: llmInput.model },
        { apiKey: embInput.apiKey, baseUrl: embInput.baseUrl, model: embInput.model },
        { apiKey: visInput.apiKey, baseUrl: visInput.baseUrl, model: visInput.model },
        { engine: stt.engine, apiKey: sttInput.apiKey, baseUrl: sttInput.baseUrl, model: sttInput.model }
      )
      setLlm(r.llm || {}); setEmb(r.embedding || {}); setVis(r.vision || {})

      // 同步给 Spring Boot 后端（Mastery 上传 OCR 与 Unlimited-OCR 走 Spring Boot 的接口）。
      // 这层是兜底同步：如果上一行调的是 Electron IPC 频道（settings:models:update），
      // 这里再走 fetch 把同样的修改 POST 给 Spring Boot 的 PUT /api/settings/models。
      try {
        const VITE_API_BASE = (import.meta?.env?.VITE_API_BASE) || ''
        const url = (VITE_API_BASE.startsWith('http') ? VITE_API_BASE.replace(/\/$/, '') : 'http://127.0.0.1:8080/api') + '/settings/models'
        const pwd = localStorage.getItem('ssp_admin_pwd') || ''
        const syncRes = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...(pwd ? { 'X-Admin-Password': pwd } : {}) },
          body: JSON.stringify({
            llm: { apiKey: llmInput.apiKey, baseUrl: llmInput.baseUrl, model: llmInput.model },
            embedding: { apiKey: embInput.apiKey, baseUrl: embInput.baseUrl, model: embInput.model },
            vision: { apiKey: visInput.apiKey, baseUrl: visInput.baseUrl, model: visInput.model },
          }),
        })
        if (syncRes.ok) {
          const j = await syncRes.json()
          setVis(j.vision || {})
        }
      } catch (e) {
        console.warn('同步 Spring Boot 配置失败（可能 Spring Boot 未启动）:', e?.message)
      }
      setLlmInput(prev => ({ ...prev, apiKey: '' }))
      setEmbInput(prev => ({ ...prev, apiKey: '' }))
      setVisInput(prev => ({ ...prev, apiKey: '' }))
      setMsg('已保存，LLM 配置即时生效')
      // 同步 stt engine 到 localStorage 让 useVoiceInput 读取
      try { localStorage.setItem('sspoffer:stt', JSON.stringify({ engine: stt.engine })) } catch {}
      if (embInput.apiKey || embInput.model) {
        setMsg('已保存。Embedding 配置已变更，建议点击下方「重建 RAG 索引」')
      }
    } catch (e) {
      setErr(e?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const reindex = async () => {
    setReindexing(true); setMsg(''); setErr('')
    try {
      const r = await api.reindexRag()
      setMsg(`RAG 索引已重建，共 ${r.count} 条面经`)
    } catch (e) {
      setErr(e?.message || '重建失败')
    } finally {
      setReindexing(false)
    }
  }

  const loadAgentLogs = async () => {
    try {
      const stats = await api.getAgentStats()
      const logs = await api.getAgentLogs(50)
      setAgentStats(stats)
      setAgentLogs(logs || [])
    } catch (e) {
      setErr('加载 Agent 日志失败: ' + (e.message || ''))
    }
  }

  const clearAgentLogs = async () => {
    try {
      await api.clearAgentLogs()
      await loadAgentLogs()
    } catch (e) {
      setErr('清除失败: ' + (e.message || ''))
    }
  }

  useEffect(() => {
    loadAgentLogs()
  }, [])

  return (
    <div className="settings">
      <h1>模型设置</h1>
      <p className="page-desc">运行时切换大模型与 Embedding 的 API Key / Base URL / 模型。LLM 即时生效；Embedding 换配置后需重建索引。</p>

      {err && <div className="settings-error">{err}</div>}
      {msg && <div className="settings-msg">{msg}</div>}

      <section className="section">
        <h2>大模型（LLM · 文本对话）</h2>
        <div className="status-row">
          状态：<span className={llm.configured ? 'tag ok' : 'tag bad'}>{llm.configured ? '已配置' : '未配置'}</span>
          {llm.apiKey && <span className="muted">当前 key: {llm.apiKey}</span>}
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>API Key{llm.apiKey && <span className="muted">（已配置，留空不修改）</span>}</label>
            <input type="password" value={llmInput.apiKey} onChange={e => setLlmInput({ ...llmInput, apiKey: e.target.value })} placeholder="sk-..." />
          </div>
          <div className="form-group">
            <label>Base URL</label>
            <input value={llmInput.baseUrl} onChange={e => setLlmInput({ ...llmInput, baseUrl: e.target.value })} placeholder="https://api.deepseek.com" />
          </div>
          <div className="form-group">
            <label>模型名</label>
            <input value={llmInput.model} onChange={e => setLlmInput({ ...llmInput, model: e.target.value })} placeholder="deepseek-chat" />
          </div>
        </div>
      </section>

      <section className="section">
        <h2>多模态大模型（图片识别 · 面经截图 / 简历图片）</h2>
        <div className="status-row">
          状态：<span className={vis.configured ? 'tag ok' : 'tag bad'}>{vis.configured ? '已配置' : '未配置'}</span>
          {vis.apiKey && <span className="muted">当前 key: {vis.apiKey}</span>}
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>API Key{vis.apiKey && <span className="muted">（已配置，留空不修改）</span>}</label>
            <input type="password" value={visInput.apiKey} onChange={e => setVisInput({ ...visInput, apiKey: e.target.value })} placeholder="豆包/Volcengine Ark key" />
          </div>
          <div className="form-group">
            <label>Base URL</label>
            <input value={visInput.baseUrl} onChange={e => setVisInput({ ...visInput, baseUrl: e.target.value })} placeholder="https://ark.cn-beijing.volces.com/api/v3" />
          </div>
          <div className="form-group">
            <label>模型名（推理接入点 ID）</label>
            <input value={visInput.model} onChange={e => setVisInput({ ...visInput, model: e.target.value })} placeholder="doubao-1.5-vision-pro-32k 或 ep-xxx" />
          </div>
        </div>
        <p className="hint">用于面经截图 OCR、简历图片解析。需使用支持视觉/多模态的模型（如豆包视觉、GPT-4o、通义千问 VL）。与上方文本 LLM 可使用不同 provider。</p>
      </section>

      <section className="section">
        <h2>Embedding（向量 / RAG）</h2>
        <div className="status-row">
          状态：<span className={emb.configured ? 'tag ok' : 'tag bad'}>{emb.configured ? '已配置' : '未配置'}</span>
          {emb.apiKey && <span className="muted">当前 key: {emb.apiKey}</span>}
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>API Key{emb.apiKey && <span className="muted">（已配置，留空不修改）</span>}</label>
            <input type="password" value={embInput.apiKey} onChange={e => setEmbInput({ ...embInput, apiKey: e.target.value })} placeholder="..." />
          </div>
          <div className="form-group">
            <label>Base URL</label>
            <input value={embInput.baseUrl} onChange={e => setEmbInput({ ...embInput, baseUrl: e.target.value })} placeholder="https://open.bigmodel.cn/api/paas/v4" />
          </div>
          <div className="form-group">
            <label>模型名</label>
            <input value={embInput.model} onChange={e => setEmbInput({ ...embInput, model: e.target.value })} placeholder="embedding-3" />
          </div>
        </div>
        <p className="hint">换 Embedding provider 或模型会导致向量维度变化，旧索引作废，保存后请点下方重建。</p>
      </section>

      <section className="section">
        <h2>语音转写（面试口述输入）</h2>
        <div className="status-row">
          状态：<span className={stt.configured ? 'tag ok' : 'tag bad'}>{stt.configured ? '已配置' : '未配置'}</span>
          当前引擎：<span className="muted">{engineLabel(stt.engine)}</span>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>识别引擎</label>
            <select value={stt.engine} onChange={e => setStt({ ...stt, engine: e.target.value })}>
              <option value="">— 未选择 —</option>
              <option value="webspeech">Web Speech</option>
              <option value="doubao">字节豆包 ASR 2.0</option>
              <option value="aliyun">阿里云百炼 Paraformer</option>
              <option value="whisper">OpenAI Whisper</option>
              <option value="auto">Auto（自动选择）</option>
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>App Key / API Key</label>
            <input type="password" value={sttInput.apiKey} onChange={e => setSttInput({ ...sttInput, apiKey: e.target.value })} placeholder={stt.engine === 'doubao' ? '火山控制台 App Key（X-Api-Key）' : stt.engine === 'aliyun' ? 'DashScope API Key（百炼平台）' : 'sk-...（留空则复用 LLM API Key）'} />
          </div>
          {stt.engine === 'doubao' ? (
            <div className="form-group">
              <label>Resource 模式</label>
              <select
                value={sttInput.baseUrl === 'concurrent' ? 'concurrent' : 'duration'}
                onChange={e => setSttInput({ ...sttInput, baseUrl: e.target.value === 'duration' ? '' : e.target.value })}
              >
                <option value="duration">小时版（按录音时长）</option>
                <option value="concurrent">并发版（按 QPS）</option>
              </select>
            </div>
          ) : stt.engine === 'aliyun' || stt.engine === 'whisper' || stt.engine === '' ? (
            <div className="form-group">
              <label>Base URL</label>
              <input value={sttInput.baseUrl} onChange={e => setSttInput({ ...sttInput, baseUrl: e.target.value })} placeholder={stt.engine === 'aliyun' ? 'https://dashscope.aliyuncs.com/api/v1' : 'https://api.openai.com/v1'} />
            </div>
          ) : null}
          <div className="form-group">
            <label>模型名</label>
            <input value={sttInput.model} onChange={e => setSttInput({ ...sttInput, model: e.target.value })} placeholder={stt.engine === 'doubao' ? 'bigmodel' : stt.engine === 'aliyun' ? 'paraformer-v2' : 'whisper-1'} />
          </div>
        </div>
        <p className="hint">
          {stt.engine === '' && '请在「识别引擎」里选一个，然后填对应的 Key / Base URL / 模型名后保存。'}
          {stt.engine === 'doubao' && '豆包走 WebSocket + 自定义二进制协议（已在主进程实现），App Key 从火山控制台获取。首次申请永久免费额度 5 万 token/天。'}
          {stt.engine === 'aliyun' && '阿里云百炼走 REST + JSON，新用户永久 100 万 token 免费。音频上限 10MB / 60s。'}
          {stt.engine === 'whisper' && 'Whisper 走 OpenAI 兼容协议，海外/中转 key 即可。国内可直接填兼容中转 Base URL。'}
          {stt.engine === 'webspeech' && '浏览器内置，免费但国内网络可能不可用；仅作兜底。'}
          {stt.engine === 'auto' && 'Auto：桌面优先豆包 → 阿里 → Whisper；浏览器只走 Web Speech。建议选具体引擎固定使用。'}
        </p>
      </section>

      <div className="action-row">
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? '保存中...' : '保存配置'}</button>
        <button className="btn-secondary" onClick={reindex} disabled={reindexing}>{reindexing ? '重建中...' : '重建 RAG 索引'}</button>
      </div>

      <section className="section">
        <h3>Agent 可观测性</h3>
        <div className="status-row">
          <span className="status-label">运行统计</span>
          <span className="status-value">
            {agentStats ? `运行 ${agentStats.totalRuns} 次 | 工具调用 ${agentStats.totalToolCalls} 次 | 错误 ${agentStats.totalErrors} 次` : '加载中...'}
          </span>
          <button className="btn-secondary" onClick={loadAgentLogs}>刷新</button>
          <button className="btn-secondary" onClick={clearAgentLogs}>清空日志</button>
        </div>
        <div className="agent-log-list" style={{ maxHeight: '320px', overflow: 'auto', fontSize: '13px', marginTop: '12px' }}>
          {agentLogs.length === 0 && <p style={{ color: 'var(--text-muted)' }}>暂无 Agent 运行日志。去 AI 面试或面经搜索页对话后回到这里查看。</p>}
          {agentLogs.slice().reverse().map((e, i) => (
            <div key={i} style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', display: 'flex', gap: '8px' }}>
              <span style={{ color: 'var(--text-muted)', minWidth: 56 }}>{new Date(e.ts).toLocaleTimeString()}</span>
              <span style={{ color: 'var(--accent)', minWidth: 70 }}>{e.type}</span>
              <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{JSON.stringify(e.data)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
