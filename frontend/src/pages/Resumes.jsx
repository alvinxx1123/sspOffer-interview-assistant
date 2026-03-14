import { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'
import './Resumes.css'

const STATUS_OPTIONS = [
  '已投递',
  '简历筛选',
  '笔试',
  '一面',
  '二面',
  '三面',
  'HR面',
  'Offer',
  '已拒绝',
  '未通过',
]

function formatTime(d) {
  if (!d) return ''
  const dt = new Date(d)
  return dt.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatDate(d) {
  if (!d) return ''
  const dt = new Date(d)
  return dt.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export default function Resumes() {
  const [resumes, setResumes] = useState([])
  const [applications, setApplications] = useState([])
  const [uploading, setUploading] = useState(false)

  const [appCompany, setAppCompany] = useState('')
  const [appDate, setAppDate] = useState(() => {
    const d = new Date()
    return d.toISOString().slice(0, 10)
  })
  const [appStatus, setAppStatus] = useState('已投递')
  const [appNotes, setAppNotes] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const appFormRef = useRef(null)

  useEffect(() => {
    loadResumes()
    loadApplications()
  }, [])

  useEffect(() => {
    if (editingId != null && appFormRef.current) {
      appFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [editingId])

  const loadResumes = () => api.getResumes().then(setResumes).catch(console.error)
  const loadApplications = () => api.getApplications().then(setApplications).catch(console.error)

  const onUpload = async (e) => {
    const file = e?.target?.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await api.uploadResume(file)
      loadResumes()
    } catch (err) {
      console.error(err)
      alert(err?.message || '上传失败')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const download = async (r) => {
    if (!r.fileName && !r.fileData) {
      alert('该简历无文件，无法下载')
      return
    }
    try {
      await api.downloadResume(r.id)
    } catch (e) {
      alert(e?.message || '下载失败')
    }
  }

  const preview = async (r) => {
    if (!r.fileName && !r.fileData) {
      alert('该简历无文件，无法预览')
      return
    }
    try {
      await api.previewResume(r.id)
    } catch (e) {
      alert(e?.message || '预览失败')
    }
  }

  const removeResume = async (id) => {
    if (!confirm('确定删除？')) return
    try {
      await api.deleteResume(id)
      loadResumes()
    } catch (e) {
      console.error(e)
    }
  }

  const hasFile = (r) => r.fileName != null && r.fileName !== ''

  const saveApplication = async () => {
    if (!appCompany.trim() || !appStatus.trim()) {
      alert('请填写投递公司和投递进度')
      return
    }
    setSaving(true)
    try {
      if (editingId) {
        await api.updateApplication(editingId, {
          company: appCompany.trim(),
          appliedAt: appDate,
          status: appStatus,
          notes: appNotes.trim(),
        })
        setEditingId(null)
      } else {
        await api.createApplication({
          company: appCompany.trim(),
          appliedAt: appDate,
          status: appStatus,
          notes: appNotes.trim(),
        })
      }
      loadApplications()
      setAppCompany('')
      setAppDate(new Date().toISOString().slice(0, 10))
      setAppStatus('已投递')
      setAppNotes('')
    } catch (e) {
      console.error(e)
      alert(e?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const editApplication = (a) => {
    setEditingId(a.id)
    setAppCompany(a.company)
    setAppDate(a.appliedAt ? a.appliedAt.slice(0, 10) : new Date().toISOString().slice(0, 10))
    setAppStatus(a.status || '已投递')
    setAppNotes(a.notes || '')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setAppCompany('')
    setAppDate(new Date().toISOString().slice(0, 10))
    setAppStatus('已投递')
    setAppNotes('')
  }

  const deleteApplication = async (id) => {
    if (!confirm('确定删除该投递记录？')) return
    try {
      await api.deleteApplication(id)
      loadApplications()
      if (editingId === id) cancelEdit()
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <div className="resumes">
      <h1>简历 + 投递</h1>
      <p className="page-desc">管理简历与投递进度，清晰追踪各公司投递状态</p>

      <section className="section">
        <h2>简历管理</h2>
        <div className="upload-section">
          <label className="upload-zone">
            <input type="file" accept=".pdf,image/jpeg,image/png,image/gif,image/webp" onChange={onUpload} disabled={uploading} />
            <span className="upload-icon">📄</span>
            <span className="upload-text">{uploading ? '上传中...' : '点击上传 PDF 或图片'}</span>
          </label>
        </div>
        <div className="resume-list">
          <h3>已保存的简历</h3>
          {resumes.map((r) => (
            <div key={r.id} className="resume-card">
              <div className="resume-info">
                <span className="resume-name">{r.fileName || r.name || '未命名简历'}</span>
                <span className="resume-time">{formatTime(r.updatedAt)}</span>
              </div>
              <div className="card-actions">
                <button className="btn-primary btn-sm" onClick={() => preview(r)} disabled={!hasFile(r)}>预览</button>
                <button className="btn-secondary btn-sm" onClick={() => download(r)} disabled={!hasFile(r)}>下载</button>
                <button className="btn-small" onClick={() => removeResume(r.id)}>删除</button>
              </div>
            </div>
          ))}
          {resumes.length === 0 && <p className="empty">暂无简历，请上方上传</p>}
        </div>
      </section>

      <section className="section" ref={appFormRef}>
        <h2>投递进度</h2>
        {editingId != null && (
          <p className="editing-hint">正在编辑：{appCompany || '当前记录'}</p>
        )}
        <div className="app-form">
          <div className="form-row">
            <div className="form-group">
              <label>投递公司</label>
              <input
                value={appCompany}
                onChange={(e) => setAppCompany(e.target.value)}
                placeholder="如：字节跳动、阿里"
              />
            </div>
            <div className="form-group">
              <label>投递时间</label>
              <input type="date" value={appDate} onChange={(e) => setAppDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label>投递进度</label>
              <select value={appStatus} onChange={(e) => setAppStatus(e.target.value)}>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group form-group-flex">
              <label>备注（选填）</label>
              <input
                value={appNotes}
                onChange={(e) => setAppNotes(e.target.value)}
                placeholder="如：内推、官网投递"
              />
            </div>
            <div className="form-actions">
              {editingId ? (
                <>
                  <button type="button" className="btn-primary" onClick={saveApplication} disabled={saving}>{saving ? '保存中...' : '更新'}</button>
                  <button type="button" className="btn-secondary" onClick={cancelEdit}>取消</button>
                </>
              ) : (
                <button type="button" className="btn-primary" onClick={saveApplication} disabled={saving}>{saving ? '保存中...' : '添加记录'}</button>
              )}
            </div>
          </div>
        </div>
        <div className="app-list">
          <h3>投递记录（按时间倒序）</h3>
          {applications.map((a) => (
            <div key={a.id} className={`app-card ${editingId === a.id ? 'editing' : ''}`}>
              <div className="app-info">
                <span className="app-company">{a.company}</span>
                <span className="app-meta">{formatDate(a.appliedAt)} · {a.status}{a.notes ? ` · ${a.notes}` : ''}</span>
              </div>
              <div className="card-actions">
                <button type="button" className="btn-secondary btn-sm" onClick={() => editApplication(a)}>编辑</button>
                <button type="button" className="btn-small" onClick={() => deleteApplication(a.id)}>删除</button>
              </div>
            </div>
          ))}
          {applications.length === 0 && <p className="empty">暂无投递记录</p>}
        </div>
      </section>
    </div>
  )
}
