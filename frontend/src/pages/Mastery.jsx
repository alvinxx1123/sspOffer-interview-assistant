import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useVoiceInput } from '../hooks/useVoiceInput'
import './Mastery.css'

export default function Mastery() {
  const [projects, setProjects] = useState([])
  const [current, setCurrent] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [steps, setSteps] = useState([])
  const [experience, setExperience] = useState('')
  const [graph, setGraph] = useState(null)
  const [outline, setOutline] = useState(null)
  const [probes, setProbes] = useState([])
  const [answers, setAnswers] = useState({})
  const [diagnosing, setDiagnosing] = useState(false)
  const [mastery, setMastery] = useState(null)
  const [error, setError] = useState('')
  const [uploadStatus, setUploadStatus] = useState(null)
  const expRef = useRef(null)
  const navigate = useNavigate()

  const voiceConceptRef = useRef(null)
  const voice = useVoiceInput({
    onText: (chunk) => {
      const concept = voiceConceptRef.current
      if (!concept) return
      setAnswers(prev => ({ ...prev, [concept]: (prev[concept] || '') + chunk }))
    },
  })

  useEffect(() => { loadProjects() }, [])
  useEffect(() => {
    if (current) {
      setExperience(current.experienceText || '')
      setGraph(current.conceptGraphJson ? safeParse(current.conceptGraphJson) : null)
      setOutline(current.projectOutlineJson ? safeParse(current.projectOutlineJson) : null)
      setMastery(current.masteryMapJson ? safeParse(current.masteryMapJson) : null)
      setProbes(current.conceptGraphJson ? extractProbes(safeParse(current.conceptGraphJson)) : [])
      setAnswers({})
      setSteps([])
      setError('')
      setUploadStatus(current.parseStatusJson ? safeParse(current.parseStatusJson) : null)
    }
  }, [current])

  // 把后端抛出的多行错误拆成「主文 + 项目列表」，便于渲染时分行展示
  const parseErrorDetail = (msg) => {
    if (!msg) return { head: '', lines: [] }
    const parts = msg.split(/\n\s*·\s*/)
    return { head: parts[0], lines: parts.slice(1) }
  }

  // 把后端的 parser 标识翻译成中文展示
  const parserLabel = (p) => ({
    pdfbox_text: 'PDFBox 文字抽取',
    markdown_plain: 'Markdown 直读',
    plain_text: 'TXT 直读',
    unlimited_ocr: 'Unlimited-OCR 视觉-语言 OCR',
    llm_vision: '多模态大模型视觉',
    llm_vision_fallback: '多模态大模型视觉 (OCR 回退)',
    unknown: '未知路径',
  })[p] || p || '未知路径' 

  const loadProjects = () => api.getMasteryProjects().then(setProjects).catch(e => setError(e.message))
  const selectProject = (id) => api.getMasteryProject(id).then(setCurrent).catch(e => setError(e.message))

  const onUpload = async (e) => {
    const files = Array.from(e?.target?.files || [])
    if (files.length === 0) return
    const form = e.target.closest('form')
    const fd = new FormData()
    files.forEach(f => fd.append('files', f))
    fd.append('name', form.name.value || '未命名项目')
    fd.append('company', form.company.value)
    fd.append('role', form.role.value)
    fd.append('startDate', form.startDate.value)
    fd.append('endDate', form.endDate.value)
    setUploading(true)
    setError('')
    setUploadStatus(null)
    try {
      const p = await api.createMasteryProject(fd)
      await loadProjects()
      setCurrent(p)
      // 把后端返回的解析摘要推到 UI 上
      const st = p?.parseStatusJson ? safeParse(p.parseStatusJson) : null
      setUploadStatus(st)
      if (st && st.failedCount > 0) {
        const failed = (st.files || []).filter(f => f.status !== 'success').slice(0, 5)
        const tail = failed.map(f => `· ${f.filename || '(未命名)'}：${f.error || '未知原因'}`).join('\n')
        setError(`共 ${st.totalCount} 个文档，成功 ${st.successCount}，失败 ${st.failedCount}。请重点检查失败文件：\n${tail}`)
      } else if (st && st.totalCount > 0) {
        setError(`上传成功：${st.successCount}/${st.totalCount} 个文档已解析。`)
      }
    } catch (err) {
      // 上传就被拒（比如全部解析失败），错误信息直接从后端抛出
      setError(err?.message || '上传失败')
      await loadProjects()
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const generate = async () => {
    if (!current) return
    setGenerating(true); setSteps([]); setExperience(''); setGraph(null); setProbes([]); setMastery(null); setOutline(null); setError('')
    try {
      await api.generateMasteryStream(current.id, {
        onStep: (s) => setSteps(prev => [...prev, s]),
        onDelta: (d) => setExperience(prev => prev + d),
        onOutline: (o) => setOutline(safeParse(o)),
        onGraph: (g) => {
          const parsed = safeParse(g)
          setGraph(parsed)
          setProbes(extractProbes(parsed))
        },
        onResult: () => { loadProjects(); if (current) selectProject(current.id) },
        onError: (e) => setError(e),
      })
    } catch (e) {
      setError(e?.message || '生成失败')
    } finally {
      setGenerating(false)
    }
  }

  const saveExperience = async () => {
    try {
      await api.updateMasteryExperience(current.id, experience)
      loadProjects()
    } catch (e) { setError(e?.message || '保存失败') }
  }

  const runDiagnose = async () => {
    if (!probes.length) { setError('无可诊断的概念，请先生成概念图谱'); return }
    setDiagnosing(true); setError(''); setMastery(null)
    const payload = probes.map(p => ({ concept: p.concept, question: p.probeQuestion, answer: answers[p.concept] || '' }))
    try {
      const res = await api.diagnoseMastery(current.id, payload)
      setMastery(safeParse(res.masteryMap))
      loadProjects()
    } catch (e) {
      setError(e?.message || '诊断失败')
    } finally {
      setDiagnosing(false)
    }
  }

  const removeProject = async (id) => {
    if (!confirm('确定删除该项目？')) return
    try { await api.deleteMasteryProject(id); if (current?.id === id) setCurrent(null); loadProjects() }
    catch (e) { setError(e?.message || '删除失败') }
  }

  return (
    <div className="mastery">
      <h1>实习经历掌握度</h1>
      <p className="page-desc">上传项目文档 → 生成 STAR 经历与底层概念图谱 → 逐概念诊断掌握度，从底层懂到经得住深挖</p>

      {error && (
        <div className="mastery-error">
          {(() => {
            const { head, lines } = parseErrorDetail(error)
            return (
              <>
                <div className="mastery-error-head">{head}</div>
                {lines.length > 0 && (
                  <ul className="mastery-error-list">
                    {lines.map((l, i) => <li key={i}>{l.trim()}</li>)}
                  </ul>
                )}
              </>
            )
          })()}
        </div>
      )}

      <section className="section card-section">
        <h2>新建项目</h2>
        <form className="mastery-form" onSubmit={(e) => e.preventDefault()}>
          <div className="form-row">
            <div className="form-group"><label>项目名</label><input name="name" placeholder="如：订单服务缓存优化" /></div>
            <div className="form-group"><label>公司</label><input name="company" placeholder="如：字节跳动" /></div>
            <div className="form-group"><label>角色</label><input name="role" placeholder="如：后端实习生" /></div>
            <div className="form-group"><label>开始</label><input name="startDate" placeholder="2025.03" /></div>
            <div className="form-group"><label>结束</label><input name="endDate" placeholder="2025.06" /></div>
          </div>
          <div className="form-group upload-group">
            <label>项目文档</label>
            <label className="upload-zone">
              <input type="file" multiple accept=".pdf,image/jpeg,image/png,image/gif,image/webp" onChange={onUpload} disabled={uploading} />
              <span className="upload-icon">📄</span>
              <span className="upload-text">{uploading ? '解析中...' : '点击选择项目文档（可多选 PDF / 图片）'}</span>
            </label>
            <span className="upload-hint">支持技术方案、优化日报、周报等多个文档混合上传，系统会自动按项目归类</span>
          </div>
        </form>
      </section>

      {projects.length > 0 && (
        <section className="section card-section">
          <h2>项目列表</h2>
          <div className="project-list">
            {projects.map(p => (
              <div key={p.id} className={`project-card ${current?.id === p.id ? 'active' : ''}`}>
                <div className="project-info" onClick={() => selectProject(p.id)}>
                  <span className="project-name">{p.name}</span>
                  <span className="project-meta">{[p.company, p.role, p.startDate, p.endDate].filter(Boolean).join(' · ') || '未填写'}</span>
                  <span className="project-status">
                    {p.projectOutlineJson ? '✓骨架' : '·骨架'} {p.experienceText ? '✓经历' : '·经历'} {p.conceptGraphJson ? '✓图谱' : '·图谱'} {p.masteryMapJson ? '✓诊断' : '·诊断'}
                  </span>
                </div>
                <button className="btn-small" onClick={() => removeProject(p.id)}>删除</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {current && (
        <section className="section card-section">
          <h2>{current.name}</h2>
          {uploadStatus && uploadStatus.totalCount > 0 && (
            <div className={`parse-summary ${uploadStatus.failedCount > 0 ? 'has-failed' : 'all-ok'}`}>
              <div className="parse-summary-head">
                已上传 {uploadStatus.totalCount} 个文档 ·
                <span className={uploadStatus.successCount > 0 ? 'ok' : 'bad'}> 成功 {uploadStatus.successCount}</span> ·
                <span className={uploadStatus.failedCount > 0 ? 'bad' : 'ok'}> 失败 {uploadStatus.failedCount}</span>
              </div>
              {uploadStatus.failedCount > 0 && (
                <details className="parse-summary-details">
                  <summary>展开失败原因（{uploadStatus.failedCount} 个）</summary>
                  <ul className="parse-summary-list">
                    {(uploadStatus.files || [])
                      .filter(f => f.status !== 'success')
                      .map((f, i) => (
                        <li key={i}>
                          <span className="parse-summary-name">{f.filename || '(未命名)'}</span>
                          {f.parser && <span className={`parse-summary-parser tag-${f.parser}`}>{parserLabel(f.parser)}</span>}
                          <span className="parse-summary-err">{f.error || '未知原因'}</span>
                        </li>
                      ))}
                  </ul>
                </details>
              )}
              {uploadStatus.totalCount > 0 && (
                <details className="parse-summary-details" style={{ marginTop: 6 }}>
                  <summary>查看每个文件走了哪条解析路径（{uploadStatus.totalCount} 个）</summary>
                  <ul className="parse-summary-list">
                    {(uploadStatus.files || []).map((f, i) => (
                      <li key={i}>
                        <span className="parse-summary-name">{f.filename || '(未命名)'}</span>
                        <span className={`parse-summary-parser tag-${f.parser || 'unknown'}`}>{parserLabel(f.parser)}</span>
                        {f.status === 'success' && f.textLength != null && (
                          <span className="parse-summary-meta">{f.textLength} 字符</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          <div className="action-row">
            <button className="btn-primary" onClick={generate} disabled={generating}>
              {generating ? '生成中...' : (current.experienceText ? '重新生成经历+图谱' : '生成经历+概念图谱')}
            </button>
          </div>

          {(steps.length > 0 || generating) && (
            <div className="steps">
              {steps.map((s, i) => (
                <div key={i} className={`step step-${s.status || 'info'}`}>
                  <span className="step-title">{s.title}</span>
                  {s.detail && <span className="step-detail">{s.detail}</span>}
                </div>
              ))}
            </div>
          )}

          {outline && (
            <div className="outline-block">
              <h3>项目骨架（识别出 {(outline.projects || []).length} 个项目）</h3>
              <div className="outline-grid">
                {(outline.projects || []).map((pr, i) => (
                  <div key={i} className="outline-card">
                    <div className="outline-head">
                      <span className="outline-name">{pr.name || '未命名'}</span>
                      {(pr.documentTypes || []).map((t, j) => <span key={j} className="outline-tag">{t}</span>)}
                    </div>
                    {pr.background && <div className="outline-row"><b>背景：</b>{pr.background}</div>}
                    {pr.techStack && <div className="outline-row"><b>技术栈：</b>{pr.techStack}</div>}
                    {pr.myContributions && <div className="outline-row"><b>个人贡献：</b>{pr.myContributions}</div>}
                    {pr.achievements && <div className="outline-row"><b>成果：</b>{pr.achievements}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {experience && (
            <div className="experience-block">
              <div className="block-head">
                <h3>实习经历（可编辑）</h3>
                <button className="btn-secondary btn-sm" onClick={saveExperience}>保存</button>
                <button className="btn-primary btn-sm" onClick={() => navigate(`/ai-interview?resume=${encodeURIComponent(experience)}${current.company ? `&company=${encodeURIComponent(current.company)}` : ''}${current.role ? `&department=${encodeURIComponent(current.role)}` : ''}`)} disabled={!experience.trim()}>拿去 AI 面试</button>
              </div>
              <textarea ref={expRef} value={experience} onChange={(e) => setExperience(e.target.value)} rows={10} className="experience-textarea" />
            </div>
          )}

          {probes.length > 0 && (
            <div className="probes-block">
              <div className="block-head">
                <h3>底层概念诊断（共 {probes.length} 个）</h3>
                <button className="btn-primary btn-sm" onClick={runDiagnose} disabled={diagnosing}>
                  {diagnosing ? '诊断中...' : '提交诊断'}
                </button>
              </div>
              <p className="hint">逐概念作答诊断题（可填"不懂"），系统判定 solid / shallow / unknown 并给薄弱清单。</p>
              {probes.map((pr, i) => (
                <div key={i} className="probe-card">
                  <div className="probe-head">
                    <span className="probe-concept">{pr.concept}</span>
                    <span className="probe-tag">{pr.category} · {pr.depthLevel}</span>
                  </div>
                  <div className="probe-q">{pr.probeQuestion}</div>
                  {pr.whyItMatters && <div className="probe-why">考察点：{pr.whyItMatters}</div>}
                  <textarea
                    placeholder="作答（或填 不懂）"
                    value={answers[pr.concept] || ''}
                    onChange={(e) => setAnswers(prev => ({ ...prev, [pr.concept]: e.target.value }))}
                    rows={2}
                    className="probe-answer"
                  />
                </div>
              ))}
            </div>
          )}

          {mastery && (
            <div className="mastery-block">
              <h3>知识掌握地图</h3>
              {mastery.summary && <div className="mastery-summary">{mastery.summary}</div>}
              <div className="mastery-grid">
                {(mastery.assessments || []).map((a, i) => (
                  <div key={i} className={`mastery-card level-${a.level}`}>
                    <div className="mastery-head">
                      <span className="mastery-concept">{a.concept}</span>
                      <span className={`level-badge level-${a.level}`}>{zhLevel(a.level)}</span>
                    </div>
                    {a.gap && <div className="mastery-gap"><b>缺口：</b>{a.gap}</div>}
                    {a.drillSuggestion && <div className="mastery-drill"><b>补强：</b>{a.drillSuggestion}</div>}
                  </div>
                ))}
              </div>
              {mastery.weakFocus?.length > 0 && (
                <div className="weak-focus">
                  <b>薄弱概念（后续施压演练重点）：</b>{mastery.weakFocus.join('、')}
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function safeParse(s) { try { return JSON.parse(s) } catch { return null } }
function extractProbes(graph) {
  if (!graph?.conceptGraph) return []
  const out = []
  for (const entry of graph.conceptGraph) {
    for (const c of (entry.concepts || [])) {
      out.push({ ...c, experienceRef: entry.experienceRef })
    }
  }
  return out
}
function zhLevel(l) { return { solid: '扎实', shallow: '偏浅', unknown: '不懂' }[l] || l }
