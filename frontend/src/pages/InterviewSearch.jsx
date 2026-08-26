import { useState, useEffect } from 'react'
import { api } from '../api/client'
import './InterviewSearch.css'

export default function InterviewSearch() {
  const [companies, setCompanies] = useState([])
  const [departments, setDepartments] = useState([])
  const [company, setCompany] = useState('')
  const [department, setDepartment] = useState('')
  const [experiences, setExperiences] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [parsingImage, setParsingImage] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')

  const [form, setForm] = useState({
    source: '牛客',
    sourceCustom: '',
    company: '',
    department: '',
    position: '后端',
    type: '校招',
    content: '',
    internshipExperiences: [''],
    projectExperiences: [''],
    baguQuestions: '',
    llmQuestions: '',
    algorithmItems: [{ q: '', link: '' }]
  })

  const [selectedExp, setSelectedExp] = useState(null)
  const [editingExp, setEditingExp] = useState(null)
  const [editBaguQA, setEditBaguQA] = useState([])
  const [editInternshipQA, setEditInternshipQA] = useState([])
  const [editProjectQA, setEditProjectQA] = useState([])
  const [editAlgorithmQA, setEditAlgorithmQA] = useState([])

  const parseToList = (s) => {
    if (!s) return []
    // 优先尝试 JSON 数组；JSON 解析失败时，把多行字符串按 \n 拆分
    try {
      const v = JSON.parse(s)
      if (Array.isArray(v)) return v.filter(Boolean).map(String)
      if (v != null) return [String(v)]
    } catch {
      const str = String(s).trim()
      if (!str) return []
      return str.split(/\n+/).map(x => x.trim()).filter(Boolean)
    }
    return []
  }

  // 匹配纯【xxx】分块标题行（无题目正文）
  const BAGU_CATEGORY_LINE = /^【[^【】]+】\s*$/
  // 匹配【xxx】题目正文前缀
  const BAGU_LINE_PREFIX = /^【([^【】]+)】\s*(.*)$/
  const isBaguCategoryLine = (line) => BAGU_CATEGORY_LINE.test((line || '').trim())
  const parseBaguLine = (line) => {
    const t = (line || '').trim()
    const m = t.match(BAGU_LINE_PREFIX)
    if (!m) return { category: null, text: t }
    return { category: m[1].trim(), text: m[2].trim() }
  }
  // 计算真实题数（过滤掉纯分块标题行），用于「八股 N 题」展示与详情页 index
  const countRealBaguQuestions = (s) => {
    if (!s) return 0
    return parseToList(s).filter(l => !isBaguCategoryLine(l)).length
  }

  const truncate = (str, len = 80) => {
    if (!str) return ''
    const s = String(str)
    return s.length <= len ? s : s.slice(0, len) + '...'
  }

  useEffect(() => {
    api.getCompanies().then(setCompanies).catch(console.error)
  }, [])

  useEffect(() => {
    if (!company) {
      setDepartments([])
      setDepartment('')
      return
    }
    api.getDepartments(company).then(setDepartments).catch(console.error)
  }, [company])

  const addItem = (field) => {
    setForm(f => ({ ...f, [field]: [...(f[field] || []), ''] }))
  }
  const removeItem = (field, idx) => {
    setForm(f => ({ ...f, [field]: f[field].filter((_, i) => i !== idx) }))
  }
  const updateItem = (field, idx, value) => {
    setForm(f => {
      const arr = [...(f[field] || [])]
      arr[idx] = value
      return { ...f, [field]: arr }
    })
  }

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setParsingImage(true)
    setUploadMsg('')
    try {
      const parsed = await api.parseImage(file)
      const internships = Array.isArray(parsed.internshipExperiences) ? parsed.internshipExperiences : (parsed.internshipExperiences ? [parsed.internshipExperiences] : [])
      const projects = Array.isArray(parsed.projectExperiences) ? parsed.projectExperiences : (parsed.projectExperiences ? [parsed.projectExperiences] : [])
      setForm({
        source: form.source === '其他' ? (form.sourceCustom?.trim() || '其他') : form.source,
        company: parsed.company || '',
        department: parsed.department || '',
        position: parsed.position || '后端',
        type: parsed.type || '校招',
        content: parsed.content || '',
        internshipExperiences: internships.length ? internships : [''],
        projectExperiences: projects.length ? projects : [''],
        baguQuestions: parsed.baguQuestions || '',
        llmQuestions: parsed.llmQuestions || '',
        algorithmItems: (() => {
          const qs = Array.isArray(parsed.algorithmQuestions) ? parsed.algorithmQuestions : (parsed.algorithmQuestions ? [parsed.algorithmQuestions] : [])
          const link = parsed.algorithmLink || ''
          return qs.length ? qs.map((q, i) => ({ q: String(q), link: i === 0 ? link : '' })) : [{ q: '', link: '' }]
        })()
      })
      setUploadMsg('图片解析完成，请核对并补充后提交')
    } catch (err) {
      setUploadMsg('图片解析失败: ' + (err.message || '请检查后端与智谱 API'))
    } finally {
      setParsingImage(false)
      e.target.value = ''
    }
  }

  const submit = async () => {
    const internships = (form.internshipExperiences || []).filter(Boolean)
    const projects = (form.projectExperiences || []).filter(Boolean)
    const algoItems = (form.algorithmItems || [{ q: '', link: '' }]).filter(x => x.q?.trim())
    const content = form.content.trim() || [
      internships.length ? '实习经历: ' + internships.join('; ') : '',
      projects.length ? '项目经历: ' + projects.join('; ') : '',
      form.baguQuestions ? '八股: ' + form.baguQuestions : '',
      algoItems.length ? '算法: ' + algoItems.map(x => x.q).join('; ') : ''
    ].filter(Boolean).join('\n')

    if (!content && !form.company) {
      setUploadMsg('请至少填写面经概要或公司')
      return
    }
    setUploading(true)
    setUploadMsg('')
    try {
      // 确保所有字段为字符串，避免后端反序列化数组时报错
      const toStr = (v) => (v == null || v === '') ? null : (Array.isArray(v) ? JSON.stringify(v) : String(v))
      const exp = {
        source: form.source === '其他' ? (form.sourceCustom?.trim() || '其他') : (toStr(form.source) || '牛客'),
        company: toStr(form.company) || '未知',
        department: toStr(form.department) || null,
        position: toStr(form.position) || '后端',
        type: toStr(form.type) || '校招',
        content: content || '面经',
        internshipExperiences: JSON.stringify(internships),
        projectExperiences: JSON.stringify(projects),
        projectExperience: projects.join('\n') || null,
        baguQuestions: toStr(form.baguQuestions) || null,
        llmQuestions: toStr(form.llmQuestions) || null,
        algorithmQuestions: algoItems.length ? JSON.stringify(algoItems.map(x => x.q.trim())) : null,
        algorithmLinks: algoItems.length ? JSON.stringify(algoItems.map(x => x.link?.trim() || '')) : null,
        algorithmLink: algoItems[0]?.link?.trim() || null
      }
      await api.addExperiences([exp])
      setUploadMsg('添加成功，已加入面经库')
      setForm({ ...form, content: '', internshipExperiences: [''], projectExperiences: [''], baguQuestions: '', llmQuestions: '', algorithmItems: [{ q: '', link: '' }], sourceCustom: '' })
      api.getCompanies().then(setCompanies).catch(() => {})
    } catch (e) {
      setUploadMsg('添加失败: ' + (e.message || '请检查后端是否运行'))
    } finally {
      setUploading(false)
    }
  }

  const startEdit = () => {
    const qList = parseToList(selectedExp.baguQuestions)
    const aList = parseToList(selectedExp.baguAnswers)
    const baguQA = qList.map((q, i) => ({ q, a: aList[i] || '' }))
    if (baguQA.length === 0 && selectedExp.baguQuestions) {
      baguQA.push({ q: String(selectedExp.baguQuestions), a: '' })
    }
    setEditBaguQA(baguQA.length ? baguQA : [{ q: '', a: '' }])
    const iList = parseToList(selectedExp.internshipExperiences)
    const iAns = parseToList(selectedExp.internshipAnswers)
    setEditInternshipQA(iList.length ? iList.map((q, i) => ({ q, a: iAns[i] || '' })) : [{ q: '', a: '' }])
    const pList = parseToList(selectedExp.projectExperiences)
    const pAns = parseToList(selectedExp.projectAnswers)
    if (pList.length === 0 && selectedExp.projectExperience) {
      setEditProjectQA([{ q: String(selectedExp.projectExperience), a: '' }])
    } else {
      setEditProjectQA(pList.length ? pList.map((q, i) => ({ q, a: (parseToList(selectedExp.projectAnswers)[i] || '') })) : [{ q: '', a: '' }])
    }
    const algoList = parseToList(selectedExp.algorithmQuestions)
    const algoLinks = parseToList(selectedExp.algorithmLinks)
    const fallbackLink = selectedExp.algorithmLink || ''
    setEditAlgorithmQA(algoList.length ? algoList.map((q, i) => ({ q, link: algoLinks[i] || fallbackLink })) : [{ q: '', link: '' }])
    setEditingExp({ ...selectedExp })
  }

  const updateBaguQA = (idx, field, value) => {
    setEditBaguQA(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: value }
      return next
    })
  }

  const addBaguQA = () => setEditBaguQA(prev => [...prev, { q: '', a: '' }])
  const removeBaguQA = (idx) => setEditBaguQA(prev => prev.filter((_, i) => i !== idx))
  const updateQA = (setter, idx, field, value) => {
    setter(prev => { const n = [...prev]; n[idx] = { ...n[idx], [field]: value }; return n })
  }
  const addQA = (setter) => setter(prev => [...prev, { q: '', a: '' }])
  const removeQA = (setter, idx) => setter(prev => prev.filter((_, i) => i !== idx))

  const saveEdit = async () => {
    if (!editingExp) return
    setUploading(true)
    setUploadMsg('')
    try {
      const validBagu = editBaguQA.filter(x => x.q?.trim())
      // 保存时仅保留真实题目（跳过纯【xxx】分块标题行），答案数组一一对应
      const realBagu = validBagu.filter(x => !isBaguCategoryLine(x.q))
      const baguQ = validBagu.map(x => x.q.trim())
      const baguA = realBagu.map(x => x.a || '')
      const validI = editInternshipQA.filter(x => x.q?.trim())
      const internshipQ = validI.map(x => x.q.trim())
      const internshipA = validI.map(x => x.a || '')
      const validP = editProjectQA.filter(x => x.q?.trim())
      const projectQ = validP.map(x => x.q.trim())
      const projectA = validP.map(x => x.a || '')
      const validAlgo = editAlgorithmQA.filter(x => x.q?.trim())
      // 保存时跳过纯【xxx】分块标题行，确保链接数组与真实题目一一对齐
      const realAlgo = validAlgo.filter(x => !isBaguCategoryLine(x.q))
      const algoQ = validAlgo.map(x => x.q.trim())
      const algoLinks = realAlgo.map(x => x.link?.trim() || '')
      const exp = {
        ...editingExp,
        baguQuestions: baguQ.length ? JSON.stringify(baguQ) : (editingExp.baguQuestions || null),
        baguAnswers: baguQ.length ? JSON.stringify(baguA) : null,
        internshipExperiences: internshipQ.length ? JSON.stringify(internshipQ) : (editingExp.internshipExperiences || null),
        internshipAnswers: internshipQ.length ? JSON.stringify(internshipA) : null,
        projectExperiences: projectQ.length ? JSON.stringify(projectQ) : (editingExp.projectExperiences || null),
        projectAnswers: projectQ.length ? JSON.stringify(projectA) : null,
        projectExperience: projectQ.length ? projectQ.join('\n') : (editingExp.projectExperience || null),
        algorithmQuestions: algoQ.length ? JSON.stringify(algoQ) : (editingExp.algorithmQuestions || null),
        algorithmLinks: algoQ.length ? JSON.stringify(algoLinks) : null,
        algorithmLink: algoLinks[0] || null
      }
      const saved = await api.addExperiences([exp])
      const updated = saved?.[0]
      if (updated) {
        setExperiences(prev => prev.map(e => e.id === updated.id ? updated : e))
        setSelectedExp(updated)
      }
      setEditingExp(null)
      setUploadMsg('保存成功')
      api.getCompanies().then(setCompanies).catch(() => {})
    } catch (e) {
      setUploadMsg('保存失败: ' + (e.message || ''))
    } finally {
      setUploading(false)
    }
  }

  const search = async () => {
    if (!company) return
    setLoading(true)
    try {
      const data = await api.searchInterviews(company, department)
      setExperiences(data || [])
    } catch (e) {
      console.error(e)
      setExperiences([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="interview-search">
      <h1>面经搜索</h1>
      <p className="page-desc">按公司、部门检索个人面经，支持手动录入或图片解析</p>

      <section className="upload-section">
        <h3>新增面经</h3>
        <div className="upload-form">
          <div className="form-row">
            <div className="form-group">
              <label>来源</label>
              <select value={form.source} onChange={e => setForm({ ...form, source: e.target.value })}>
                <option value="牛客">牛客</option>
                <option value="小红书">小红书</option>
                <option value="其他">其他</option>
              </select>
              {form.source === '其他' && (
                <input
                  value={form.sourceCustom}
                  onChange={e => setForm({ ...form, sourceCustom: e.target.value })}
                  placeholder="自定义来源"
                  className="mt-1"
                />
              )}
            </div>
            <div className="form-group">
              <label>公司</label>
              <input value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} placeholder="如：字节跳动" />
            </div>
            <div className="form-group">
              <label>部门</label>
              <input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} placeholder="如：基础架构" />
            </div>
            <div className="form-group">
              <label>岗位</label>
              <select value={form.position} onChange={e => setForm({ ...form, position: e.target.value })}>
                <option value="后端">后端</option>
                <option value="前端">前端</option>
                <option value="算法">算法</option>
              </select>
            </div>
            <div className="form-group">
              <label>类型</label>
              <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                <option value="校招">校招</option>
                <option value="社招">社招</option>
                <option value="实习">实习</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>面经概要 *</label>
            <textarea value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} rows={3} placeholder="整体面经概要，或粘贴文字面经..." />
          </div>

          <div className="form-group">
            <label>实习经历（可多条）</label>
            {(form.internshipExperiences || ['']).map((v, i) => (
              <div key={i} className="multi-row">
                <textarea value={v} onChange={e => updateItem('internshipExperiences', i, e.target.value)} rows={1} placeholder="实习经历描述" />
                <button type="button" className="btn-small" onClick={() => removeItem('internshipExperiences', i)}>删除</button>
              </div>
            ))}
            <button type="button" className="btn-link" onClick={() => addItem('internshipExperiences')}>+ 添加实习经历</button>
          </div>

          <div className="form-group">
            <label>项目经历（可多条）</label>
            {(form.projectExperiences || ['']).map((v, i) => (
              <div key={i} className="multi-row">
                <textarea value={v} onChange={e => updateItem('projectExperiences', i, e.target.value)} rows={1} placeholder="项目经历描述" />
                <button type="button" className="btn-small" onClick={() => removeItem('projectExperiences', i)}>删除</button>
              </div>
            ))}
            <button type="button" className="btn-link" onClick={() => addItem('projectExperiences')}>+ 添加项目经历</button>
          </div>

          <div className="form-group">
            <label>八股</label>
            <textarea value={form.baguQuestions} onChange={e => setForm({ ...form, baguQuestions: e.target.value })} rows={2} placeholder="八股题及回答要点" />
          </div>

          <div className="form-group">
            <label>大模型/AI 相关问题</label>
            <textarea value={form.llmQuestions} onChange={e => setForm({ ...form, llmQuestions: e.target.value })} rows={2} placeholder="AI/大模型/Agent/RAG/MCP/Tool Calling 等相关题目" />
          </div>

          <div className="form-group">
            <label>算法题（可多条，每条可填原题链接）</label>
            {(form.algorithmItems || [{ q: '', link: '' }]).map((item, i) => (
              <div key={i} className="algo-multi-row">
                <input
                  value={item.q}
                  onChange={e => {
                    const arr = [...(form.algorithmItems || [{ q: '', link: '' }])]
                    arr[i] = { ...arr[i], q: e.target.value }
                    setForm({ ...form, algorithmItems: arr })
                  }}
                  placeholder="算法题描述"
                />
                <input
                  value={item.link || ''}
                  onChange={e => {
                    const arr = [...(form.algorithmItems || [{ q: '', link: '' }])]
                    arr[i] = { ...arr[i], link: e.target.value }
                    setForm({ ...form, algorithmItems: arr })
                  }}
                  placeholder="力扣/原题链接（可选）"
                />
                <button type="button" className="btn-small" onClick={() => {
                  const next = (form.algorithmItems || []).filter((_, idx) => idx !== i)
                  setForm({ ...form, algorithmItems: next.length ? next : [{ q: '', link: '' }] })
                }}>删除</button>
              </div>
            ))}
            <button type="button" className="btn-link" onClick={() => setForm({ ...form, algorithmItems: [...(form.algorithmItems || [{ q: '', link: '' }]), { q: '', link: '' }] })}>+ 添加算法题</button>
          </div>

          <div className="form-actions">
            <div className="form-actions-left">
              <button className="btn-primary btn-submit" onClick={submit} disabled={uploading}>
                {uploading ? '提交中...' : '提交面经'}
              </button>
              <label className="btn-parse-image">
                <span className="btn-parse-icon">📷</span>
                {parsingImage ? '解析中...' : '图片解析'}
                <input type="file" accept="image/*" onChange={handleImageUpload} disabled={parsingImage} />
              </label>
            </div>
            {uploadMsg && <span className="upload-msg">{uploadMsg}</span>}
          </div>
        </div>
      </section>

      <div className="search-form">
        <div className="form-row">
          <div className="form-group">
            <label>公司</label>
            <select value={company} onChange={e => setCompany(e.target.value)}>
              <option value="">选择公司</option>
              {companies.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>部门</label>
            <select value={department} onChange={e => setDepartment(e.target.value)}>
              <option value="">全部</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="form-group actions">
            <button className="btn-primary" onClick={search} disabled={loading || !company}>
              {loading ? '搜索中...' : '搜索'}
            </button>
          </div>
        </div>
      </div>

      <div className="results">
        {experiences.length > 0 && <h3 className="results-title">面经库 · 共 {experiences.length} 条</h3>}
        {experiences.length === 0 && !loading && <p className="empty">选择公司后点击搜索查看面经</p>}
        <div className="exp-grid">
          {experiences.map(e => (
            <article
              key={e.id}
              className="exp-card"
              onClick={() => setSelectedExp(e)}
            >
              <div className="exp-card-header">
                <span className="exp-company">{e.company}</span>
                <span className="exp-dept">{e.department || '通用'}</span>
                <span className="exp-type">{e.type || '校招'} · {e.position || '后端'}</span>
                <button
                  className="exp-card-delete"
                  onClick={async (ev) => {
                    ev.stopPropagation()
                    if (!confirm('确定删除这条面经吗？')) return
                    try {
                      await api.deleteExperience(e.id)
                      setExperiences(prev => prev.filter(x => x.id !== e.id))
                    } catch (err) {
                      setUploadMsg('删除失败: ' + (err.message || ''))
                    }
                  }}
                  title="删除"
                >
                  ×
                </button>
              </div>
              <p className="exp-preview">{truncate(e.content || e.projectExperience || '暂无概要', 100)}</p>
              <div className="exp-tags-row">
                {countRealBaguQuestions(e.baguQuestions) > 0 && (
                  <span className="exp-tag">八股 {countRealBaguQuestions(e.baguQuestions)} 题</span>
                )}
                {parseToList(e.algorithmQuestions).length > 0 && (
                  <span className="exp-tag algo">算法 {parseToList(e.algorithmQuestions).length} 题</span>
                )}
              </div>
              <span className="exp-view-link">查看详情 →</span>
            </article>
          ))}
        </div>
      </div>

      {selectedExp && (
        <div className="exp-detail-overlay" onClick={() => { setSelectedExp(null); setEditingExp(null) }}>
          <div className="exp-detail-modal" onClick={e => e.stopPropagation()}>
            <button className="exp-detail-close" onClick={() => { setSelectedExp(null); setEditingExp(null) }}>×</button>
            <header className="exp-detail-header">
              <h2>{selectedExp.company} {selectedExp.department ? `· ${selectedExp.department}` : ''}</h2>
              <p className="exp-meta">{selectedExp.position} · {selectedExp.type} · {selectedExp.source}</p>
              {!editingExp && (
                <button className="exp-edit-btn" onClick={startEdit}>编辑</button>
              )}
            </header>
            <div className="exp-detail-body">
              {selectedExp.content && (
                <section className="exp-section">
                  <h4>面经概要</h4>
                  <p className="exp-section-content">{selectedExp.content}</p>
                </section>
              )}
              {(editingExp ? editInternshipQA.length > 0 : parseToList(selectedExp.internshipExperiences).length > 0) && (
                <section className="exp-section">
                  <h4>实习经历 {editingExp && <span className="exp-edit-hint">（可填写面试追问/答案）</span>}</h4>
                  {editingExp ? (
                    <div className="bagu-qa-edit">
                      {editInternshipQA.map((item, i) => (
                        <div key={i} className="bagu-qa-item">
                          <div className="bagu-qa-q">
                            <label>经历 {i + 1}</label>
                            <input value={item.q} onChange={e => updateQA(setEditInternshipQA, i, 'q', e.target.value)} placeholder="实习经历描述" />
                          </div>
                          <div className="bagu-qa-a">
                            <label>追问/答案</label>
                            <textarea value={item.a} onChange={e => updateQA(setEditInternshipQA, i, 'a', e.target.value)} placeholder="面试追问与你的答案" rows={2} />
                          </div>
                          <button type="button" className="bagu-qa-remove" onClick={() => removeQA(setEditInternshipQA, i)}>删除</button>
                        </div>
                      ))}
                      <button type="button" className="btn-link" onClick={() => addQA(setEditInternshipQA)}>+ 添加实习经历</button>
                    </div>
                  ) : (
                    <div className="bagu-qa-view">
                      {parseToList(selectedExp.internshipExperiences).map((item, i) => {
                        const ans = parseToList(selectedExp.internshipAnswers)[i]
                        return (
                          <div key={i} className="bagu-qa-row">
                            <div className="bagu-q">{item}</div>
                            {ans && <div className="bagu-a">{ans}</div>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </section>
              )}
              {(editingExp ? editProjectQA.length > 0 : parseToList(selectedExp.projectExperiences).length > 0 || selectedExp.projectExperience) && (
                <section className="exp-section">
                  <h4>项目经历 {editingExp && <span className="exp-edit-hint">（可填写面试追问/答案）</span>}</h4>
                  {editingExp ? (
                    <div className="bagu-qa-edit">
                      {editProjectQA.map((item, i) => (
                        <div key={i} className="bagu-qa-item">
                          <div className="bagu-qa-q">
                            <label>项目 {i + 1}</label>
                            <input value={item.q} onChange={e => updateQA(setEditProjectQA, i, 'q', e.target.value)} placeholder="项目经历描述" />
                          </div>
                          <div className="bagu-qa-a">
                            <label>追问/答案</label>
                            <textarea value={item.a} onChange={e => updateQA(setEditProjectQA, i, 'a', e.target.value)} placeholder="面试追问与你的答案" rows={2} />
                          </div>
                          <button type="button" className="bagu-qa-remove" onClick={() => removeQA(setEditProjectQA, i)}>删除</button>
                        </div>
                      ))}
                      <button type="button" className="btn-link" onClick={() => addQA(setEditProjectQA)}>+ 添加项目经历</button>
                    </div>
                  ) : parseToList(selectedExp.projectExperiences).length > 0 ? (
                    <div className="bagu-qa-view">
                      {parseToList(selectedExp.projectExperiences).map((item, i) => {
                        const ans = parseToList(selectedExp.projectAnswers)[i]
                        return (
                          <div key={i} className="bagu-qa-row">
                            <div className="bagu-q">{item}</div>
                            {ans && <div className="bagu-a">{ans}</div>}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="exp-section-content">{selectedExp.projectExperience}</p>
                  )}
                </section>
              )}
              {(editingExp || parseToList(selectedExp.baguQuestions).length > 0 || (selectedExp.baguQuestions && parseToList(selectedExp.baguQuestions).length === 0)) && (
                <section className="exp-section">
                  <h4>八股题目 {editingExp && <span className="exp-edit-hint">（可填写答案）</span>}</h4>
                  {editingExp ? (
                    <div className="bagu-qa-edit">
                      {editBaguQA.map((item, i) => {
                        const isCat = isBaguCategoryLine(item.q)
                        if (isCat) {
                          const { category } = parseBaguLine(item.q)
                          return (
                            <div key={i} className="bagu-qa-item bagu-qa-item-category">
                              <div className="bagu-qa-q">
                                <label>分类</label>
                                <input
                                  value={item.q}
                                  onChange={e => updateBaguQA(i, 'q', e.target.value)}
                                  placeholder="【分块名】，例如【数据库】"
                                />
                              </div>
                              <button type="button" className="bagu-qa-remove" onClick={() => removeBaguQA(i)}>删除</button>
                            </div>
                          )
                        }
                        const { category, text } = parseBaguLine(item.q)
                        return (
                        <div key={i} className="bagu-qa-item">
                          <div className="bagu-qa-q">
                            <label>题目 {i + 1}</label>
                            <input
                              value={item.q}
                              onChange={e => updateBaguQA(i, 'q', e.target.value)}
                              placeholder={category ? `【${category}】原题正文` : '八股题目'}
                            />
                          </div>
                          <div className="bagu-qa-a">
                            <label>答案</label>
                            <textarea
                              value={item.a}
                              onChange={e => updateBaguQA(i, 'a', e.target.value)}
                              placeholder="输入你的答案/要点"
                              rows={2}
                            />
                          </div>
                          <button type="button" className="bagu-qa-remove" onClick={() => removeBaguQA(i)}>删除</button>
                        </div>
                        )
                      })}
                      <button type="button" className="btn-link" onClick={addBaguQA}>+ 添加八股题</button>
                      <button type="button" className="btn-link" style={{ marginLeft: 8 }} onClick={() => setEditBaguQA(prev => [...prev, { q: '【新分块】', a: '' }])}>+ 添加分块</button>
                    </div>
                  ) : (
                    <div className="bagu-qa-view">
                      {(() => {
                        const lines = parseToList(selectedExp.baguQuestions)
                        const answers = parseToList(selectedExp.baguAnswers)
                        // 仅对真实题目行做答案索引（跳过纯【xxx】分块标题行）
                        const realIdxOf = (() => {
                          const map = new Map()
                          let real = -1
                          for (let li = 0; li < lines.length; li++) {
                            if (isBaguCategoryLine(lines[li])) { map.set(li, -1); continue }
                            real++
                            map.set(li, real)
                          }
                          return map
                        })()
                        return lines.map((q, i) => {
                          if (isBaguCategoryLine(q)) {
                            const cat = q.replace(/^[【]|[】]\s*$/g, '')
                            return (
                              <div key={`cat-${i}`} className="bagu-q-category">
                                <span className="bagu-q-cat-label">{cat}</span>
                              </div>
                            )
                          }
                          const { category, text } = parseBaguLine(q)
                          const ans = answers[realIdxOf.get(i)] ?? ''
                          return (
                            <div key={i} className="bagu-qa-row">
                              <div className="bagu-q">
                                {category && <span className="bagu-q-cat-inline">【{category}】</span>}
                                {text || q}
                              </div>
                              {ans && <div className="bagu-a">{ans}</div>}
                            </div>
                          )
                        })
                      })()}
                    </div>
                  )}
                </section>
              )}
              {selectedExp.llmQuestions && parseToList(selectedExp.llmQuestions).length > 0 && (
                <section className="exp-section">
                  <h4>大模型相关</h4>
                  <div className="exp-tags">
                    {parseToList(selectedExp.llmQuestions).map((q, i) => {
                      if (isBaguCategoryLine(q)) {
                        return <span key={`cat-${i}`} className="bagu-q-category"><span className="bagu-q-cat-label">{parseBaguLine(q).category}</span></span>
                      }
                      const { category, text } = parseBaguLine(q)
                      return (
                        <span key={i} className="exp-detail-tag llm">
                          {category && <span className="bagu-q-cat-inline">{`【${category}】`}</span>}
                          {text || q}
                        </span>
                      )
                    })}
                  </div>
                </section>
              )}
              {((editingExp && editAlgorithmQA.length > 0) || parseToList(selectedExp.algorithmQuestions).length > 0) && (
                <section className="exp-section">
                  <h4>算法题 {editingExp ? <span className="exp-edit-hint">（可填原题链接）</span> : (parseToList(selectedExp.algorithmLinks).some((l, i) => l) || selectedExp.algorithmLink) && <span className="exp-edit-hint">（点击跳转原题）</span>}</h4>
                  {editingExp ? (
                    <div className="bagu-qa-edit">
                      {editAlgorithmQA.map((item, i) => {
                        const isCat = isBaguCategoryLine(item.q)
                        if (isCat) {
                          return (
                            <div key={i} className="bagu-qa-item bagu-qa-item-category">
                              <div className="bagu-qa-q">
                                <label>分类</label>
                                <input
                                  value={item.q}
                                  onChange={e => updateQA(setEditAlgorithmQA, i, 'q', e.target.value)}
                                  placeholder="【分块名】，例如【手撕算法】"
                                />
                              </div>
                              <button type="button" className="bagu-qa-remove" onClick={() => removeQA(setEditAlgorithmQA, i)}>删除</button>
                            </div>
                          )
                        }
                        const { category, text } = parseBaguLine(item.q)
                        return (
                        <div key={i} className="bagu-qa-item">
                          <div className="bagu-qa-q">
                            <label>算法题 {i + 1}</label>
                            <input value={item.q} onChange={e => updateQA(setEditAlgorithmQA, i, 'q', e.target.value)} placeholder={category ? `【${category}】原题正文` : '算法题描述'} />
                          </div>
                          <div className="bagu-qa-a">
                            <label>原题链接</label>
                            <input value={item.link || ''} onChange={e => updateQA(setEditAlgorithmQA, i, 'link', e.target.value)} placeholder="力扣/原题 URL（可选）" />
                          </div>
                          <button type="button" className="bagu-qa-remove" onClick={() => removeQA(setEditAlgorithmQA, i)}>删除</button>
                        </div>
                        )
                      })}
                      <button type="button" className="btn-link" onClick={() => addQA(setEditAlgorithmQA)}>+ 添加算法题</button>
                      <button type="button" className="btn-link" style={{ marginLeft: 8 }} onClick={() => setEditAlgorithmQA(prev => [...prev, { q: '【新分块】', link: '' }])}>+ 添加分块</button>
                    </div>
                  ) : (
                    <div className="exp-tags">
                      {(() => {
                        const qs = parseToList(selectedExp.algorithmQuestions)
                        const links = parseToList(selectedExp.algorithmLinks)
                        // 仅对真实题目行做链接索引（跳过纯【xxx】分块标题行）
                        const realIdxOf = (() => {
                          const map = new Map()
                          let real = -1
                          for (let li = 0; li < qs.length; li++) {
                            if (isBaguCategoryLine(qs[li])) { map.set(li, -1); continue }
                            real++
                            map.set(li, real)
                          }
                          return map
                        })()
                        return qs.map((q, i) => {
                        if (isBaguCategoryLine(q)) {
                          return <span key={`cat-${i}`} className="bagu-q-category"><span className="bagu-q-cat-label">{parseBaguLine(q).category}</span></span>
                        }
                        const url = links[realIdxOf.get(i)] || selectedExp.algorithmLink
                        const { category, text } = parseBaguLine(q)
                        const algoTag = (
                          <>
                            {category && <span className="bagu-q-cat-inline">{`【${category}】`}</span>}
                            {text || q}
                          </>
                        )
                        return url ? (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="exp-detail-tag algo exp-algo-tag">
                            {algoTag} ↗
                          </a>
                        ) : (
                          <span key={i} className="exp-detail-tag algo">{algoTag}</span>
                        )
                        })
                      })()}
                    </div>
                  )}
                  {!editingExp && (parseToList(selectedExp.algorithmLinks).some(l => l) || selectedExp.algorithmLink) && (
                    <span className="exp-edit-hint" style={{ display: 'block', marginTop: 8 }}>点击题目可跳转力扣/原题</span>
                  )}
                </section>
              )}
              {selectedExp.baguQuestions && parseToList(selectedExp.baguQuestions).length === 0 && (
                <section className="exp-section">
                  <h4>八股</h4>
                  <p className="exp-section-content">{selectedExp.baguQuestions}</p>
                </section>
              )}
              {selectedExp.algorithmQuestions && parseToList(selectedExp.algorithmQuestions).length === 0 && (
                <section className="exp-section">
                  <h4>算法</h4>
                  <p className="exp-section-content">{selectedExp.algorithmQuestions}</p>
                  {selectedExp.algorithmLink && (
                    <a href={selectedExp.algorithmLink} target="_blank" rel="noopener noreferrer" className="exp-algo-link">原题链接 →</a>
                  )}
                </section>
              )}
              {editingExp && (
                <div className="exp-edit-actions">
                  <button className="btn-primary" onClick={saveEdit} disabled={uploading}>{uploading ? '保存中...' : '保存'}</button>
                  <button className="btn-secondary" onClick={() => setEditingExp(null)}>取消</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
