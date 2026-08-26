import { useState, useEffect } from 'react'
import { api } from '../api/client'
import './Settings.css'

export default function Settings() {
  const [llm, setLlm] = useState({ apiKey: '', baseUrl: '', model: '', configured: false })
  const [emb, setEmb] = useState({ apiKey: '', baseUrl: '', model: '', configured: false })
  const [vis, setVis] = useState({ apiKey: '', baseUrl: '', model: '', configured: false })
  const [llmInput, setLlmInput] = useState({ apiKey: '', baseUrl: '', model: '' })
  const [embInput, setEmbInput] = useState({ apiKey: '', baseUrl: '', model: '' })
  const [visInput, setVisInput] = useState({ apiKey: '', baseUrl: '', model: '' })
  const [saving, setSaving] = useState(false)
  const [reindexing, setReindexing] = useState(false)
  const [msg, setMsg] = useState('')
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
    } catch (e) { setErr(e.message) }
  }

  const save = async () => {
    setSaving(true); setMsg(''); setErr('')
    try {
      const r = await api.updateModelSettings(
        { apiKey: llmInput.apiKey, baseUrl: llmInput.baseUrl, model: llmInput.model },
        { apiKey: embInput.apiKey, baseUrl: embInput.baseUrl, model: embInput.model },
        { apiKey: visInput.apiKey, baseUrl: visInput.baseUrl, model: visInput.model }
      )
      setLlm(r.llm || {}); setEmb(r.embedding || {}); setVis(r.vision || {})
      setLlmInput(prev => ({ ...prev, apiKey: '' }))
      setEmbInput(prev => ({ ...prev, apiKey: '' }))
      setVisInput(prev => ({ ...prev, apiKey: '' }))
      setMsg('已保存，LLM 配置即时生效')
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

  return (
    <div className="settings">
      <h1>模型设置</h1>
      <p className="page-desc">运行时切换大模型与 Embedding 的 API Key / Base URL / 模型。LLM 即时生效；Embedding 换配置后需重建索引。</p>

      {err && <div className="settings-error">{err}</div>}
      {msg && <div className="settings-msg">{msg}</div>}

      <section className="section">
        <h2>大模型（LLM）</h2>
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
            <input value={llmInput.model} onChange={e => setLlmInput({ ...llmInput, model: e.target.value })} placeholder="deepseek-v4-flash" />
          </div>
        </div>
      </section>

      <section className="section">
        <h2>多模态大模型（图片识别 · 面经截图 / 简历图片）</h2>
        <div className="status-row">
          状态：<span className={vis.configured ? 'tag ok' : 'tag bad'}>{vis.configured ? '已配置' : '未配置（回退 LLM）'}</span>
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
            <input value={visInput.model} onChange={e => setVisInput({ ...visInput, model: e.target.value })} placeholder="doubao-1.5-vision-pro-32k" />
          </div>
        </div>
        <p className="hint">用于实习项目文档上传里的图片 OCR 与面经截图 OCR。可与文本 LLM 用不同 provider。未配置时自动回退到文本 LLM。</p>
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
            <input value={embInput.model} onChange={e => setEmbInput({ ...embInput, model: e.target.value })} placeholder="embedding-2" />
          </div>
        </div>
        <p className="hint">换 Embedding provider 或模型会导致向量维度变化，旧索引作废，保存后请点下方重建。</p>
      </section>

      <div className="action-row">
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? '保存中...' : '保存配置'}</button>
        <button className="btn-secondary" onClick={reindex} disabled={reindexing}>{reindexing ? '重建中...' : '重建 RAG 索引'}</button>
      </div>
    </div>
  )
}
