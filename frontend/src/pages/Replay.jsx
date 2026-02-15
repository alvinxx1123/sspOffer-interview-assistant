import { useState, useEffect } from 'react'
import { api } from '../api/client'
import './Replay.css'

/** 去掉复盘结果里过多的 * 与 **，便于阅读 */
function formatReplayResult(text) {
  if (!text || typeof text !== 'string') return text
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\n)\s*\*\s+/gm, '$1  · ')
    .replace(/^#{1,6}\s*/gm, '')
}

export default function Replay() {
  const [company, setCompany] = useState('')
  const [department, setDepartment] = useState('')
  const [content, setContent] = useState('')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [records, setRecords] = useState([])
  const [editingId, setEditingId] = useState(null)  // 当前编辑的面经 id，保存时用于更新而非新建

  useEffect(() => {
    api.getReplayRecords().then(setRecords).catch(console.error)
  }, [])

  const analyze = async () => {
    if (!content.trim()) return
    setLoading(true)
    setResult('')
    try {
      const text = await api.analyzeReplay(company, department, content)
      if (text != null && String(text).trim() !== '') {
        setResult(String(text))
      } else {
        setResult('未返回分析内容，请重试或检查智谱 API 配置')
      }
    } catch (e) {
      console.error(e)
      const raw = e?.message || ''
      const msg = raw.replace(/^\d+\s*/, '')
      if (raw.includes('abort') || raw.includes('Abort') || raw.includes('超时')) {
        setResult('请求超时（3 分钟），请稍后重试或适当缩短面经内容后再分析')
      } else if (raw.includes('Failed to fetch') || raw.includes('NetworkError') || raw.includes('Load failed')) {
        setResult('分析失败：无法连接后端。请确认已启动后端（mvn spring-boot:run），前端使用 npm run dev 时 /api 会转发到 8080。确认无误后刷新页面再试。')
      } else {
        setResult('分析失败：' + (msg || '请检查智谱 API 配置与网络'))
      }
    } finally {
      setLoading(false)
    }
  }

  const loadRecord = (r) => {
    setEditingId(r.id)
    setCompany(r.company || '')
    setDepartment(r.department || '')
    setContent(r.content || '')
    setResult('')
  }

  const newRecord = () => {
    setEditingId(null)
    setCompany('')
    setDepartment('')
    setContent('')
    setResult('')
  }

  const deleteRecord = async (id) => {
    try {
      await api.deleteReplayRecord(id)
      setRecords((prev) => prev.filter((r) => r.id !== id))
    } catch (e) {
      console.error(e)
    }
  }

  const save = async () => {
    if (!content.trim()) return
    try {
      const payload = { company, department, content }
      if (editingId) payload.id = editingId
      const record = await api.saveReplay(payload)
      setRecords((prev) => {
        if (editingId) {
          return prev.map((r) => (r.id === editingId ? record : r))
        }
        return [record, ...prev]
      })
      setEditingId(record.id)
      alert(editingId ? '已更新' : '已保存')
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <div className="replay">
      <h1>面试复盘</h1>
      <p className="page-desc">上传你的面试经历，AI 进行深度复盘分析</p>

      {records.length > 0 && (
        <div className="saved-records">
          <h3>已保存的面经</h3>
          <button type="button" className="btn-link" onClick={newRecord}>+ 新建面经</button>
          <ul>
            {records.map((r) => (
              <li key={r.id}>
                <span onClick={() => loadRecord(r)} className={`record-link ${editingId === r.id ? 'active' : ''}`}>
                  {r.company || '未知'} / {r.department || '-'}
                </span>
                <button className="btn-small" onClick={() => deleteRecord(r.id)}>删除</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="form-section">
        <div className="form-row">
          <div className="form-group">
            <label>公司</label>
            <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="如：字节跳动" />
          </div>
          <div className="form-group">
            <label>部门</label>
            <input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="如：基础架构" />
          </div>
        </div>
        <div className="form-group">
          <label>面经内容</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={12}
            placeholder="粘贴面经：可只贴面试官的问题（AI 分析侧重点与准备建议），或贴问题+你的回答（AI 会评估回答并给改进建议）"
          />
        </div>
        <div className="actions">
          <button className="btn-primary" onClick={analyze} disabled={loading || !content.trim()}>
            {loading ? '分析中...' : 'AI 复盘分析'}
          </button>
          <button className="btn-secondary" onClick={save} disabled={!content.trim()}>
            {editingId ? '更新面经' : '保存面经'}
          </button>
        </div>
      </div>

      {result && (
        <div className="result-section">
          <h2>复盘结果</h2>
          <pre className="result-text">{formatReplayResult(result)}</pre>
        </div>
      )}
    </div>
  )
}
