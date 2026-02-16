import { useState, useEffect, useRef } from 'react'
import Editor from '@monaco-editor/react'
import { api } from '../api/client'
import './OnlineIDE.css'

const DIFFICULTIES = ['easy', 'medium', 'hard']
const DIFFICULTY_MAP = { '简单': 'easy', '中等': 'medium', '困难': 'hard' }
function normalizeDifficulty(d) {
  return (d && DIFFICULTY_MAP[d]) || d || 'medium'
}

const LANGUAGES = [
  { id: 'python', name: 'Python' },
  { id: 'java', name: 'Java' },
  { id: 'go', name: 'Go' },
  { id: 'javascript', name: 'JavaScript' },
  { id: 'cpp', name: 'C++' },
]

const LANGUAGE_IDS = {
  python: 'python',
  java: 'java',
  go: 'go',
  javascript: 'javascript',
  cpp: 'cpp',
}

// ACM 白板模式：各语言均为空白，用户自行编写代码和测试用例
const BLANK_TEMPLATE = ''

export default function OnlineIDE() {
  const [questions, setQuestions] = useState([])
  const [selectedQuestion, setSelectedQuestion] = useState(null)
  const [language, setLanguage] = useState('python')
  const [code, setCode] = useState('')
  const [output, setOutput] = useState({ stdout: '', stderr: '', exitCode: 0 })
  const [hasRunOnce, setHasRunOnce] = useState(false)
  const outputSectionRef = useRef(null)
  const [running, setRunning] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addError, setAddError] = useState('')
  const [addForm, setAddForm] = useState({
    title: '', description: '', difficulty: 'medium',
    leetcodeSlug: '', originalLink: '', source: '', defaultCode: '',
  })
  const [editingQuestion, setEditingQuestion] = useState(null)
  const [editError, setEditError] = useState('')
  const [editForm, setEditForm] = useState({
    title: '', description: '', difficulty: 'medium',
    leetcodeSlug: '', originalLink: '', source: '', defaultCode: '',
  })

  const loadQuestions = () => api.getAlgorithms().then(setQuestions).catch(console.error)

  useEffect(() => {
    loadQuestions()
  }, [])

  useEffect(() => {
    if (selectedQuestion) {
      setCode(BLANK_TEMPLATE)
    }
  }, [selectedQuestion])

  useEffect(() => {
    if (selectedQuestion) {
      setCode(BLANK_TEMPLATE)
    }
  }, [language])

  const run = async () => {
    setRunning(true)
    setOutput({ stdout: '', stderr: '', exitCode: 0 })
    try {
      const result = await api.executeCode(language, code, '', true)
      setOutput({
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: result.exitCode ?? -1,
      })
    } catch (e) {
      const msg = (e && e.message === 'Failed to fetch')
        ? '请求超时或网络异常，请确认代码执行服务(Piston)已启动且后端可访问。'
        : ('执行失败: ' + (e && e.message ? e.message : '未知错误'))
      setOutput({ stdout: '', stderr: msg, exitCode: -1 })
    } finally {
      setRunning(false)
      setHasRunOnce(true)
      setTimeout(() => outputSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50)
    }
  }

  const resetCode = () => setCode(BLANK_TEMPLATE)

  const submitAdd = async (e) => {
    e.preventDefault()
    if (!addForm.title?.trim() || !addForm.description?.trim()) return
    setAddError('')
    try {
      await api.createAlgorithm({
        title: addForm.title.trim(),
        description: addForm.description.trim(),
        difficulty: addForm.difficulty || null,
        leetcodeSlug: addForm.leetcodeSlug?.trim() || null,
        originalLink: addForm.originalLink?.trim() || null,
        source: addForm.source?.trim() || null,
        defaultCode: addForm.defaultCode?.trim() || null,
      })
      setShowAddModal(false)
      setAddForm({ title: '', description: '', difficulty: 'medium', leetcodeSlug: '', originalLink: '', source: '', defaultCode: '' })
      loadQuestions()
    } catch (err) {
      setAddError(err?.message || '添加失败，请重试')
      console.error(err)
    }
  }

  const openEdit = (e, q) => {
    e.stopPropagation()
    setEditingQuestion(q)
    setEditForm({
      title: q.title || '',
      description: q.description || '',
      difficulty: normalizeDifficulty(q.difficulty),
      leetcodeSlug: q.leetcodeSlug || '',
      originalLink: q.originalLink || '',
      source: q.source || '',
      defaultCode: q.defaultCode || '',
    })
    setEditError('')
  }

  const submitEdit = async (e) => {
    e.preventDefault()
    if (!editingQuestion || !editForm.title?.trim() || !editForm.description?.trim()) return
    setEditError('')
    try {
      const updated = await api.updateAlgorithm(editingQuestion.id, {
        ...editingQuestion,
        title: editForm.title.trim(),
        description: editForm.description.trim(),
        difficulty: editForm.difficulty || null,
        leetcodeSlug: editForm.leetcodeSlug?.trim() || null,
        originalLink: editForm.originalLink?.trim() || null,
        source: editForm.source?.trim() || null,
        defaultCode: editForm.defaultCode?.trim() || null,
      })
      setEditingQuestion(null)
      if (selectedQuestion?.id === editingQuestion.id) setSelectedQuestion(updated)
      loadQuestions()
    } catch (err) {
      setEditError(err?.message || '保存失败，请重试')
      console.error(err)
    }
  }

  const deleteQuestion = async (e, q) => {
    e.stopPropagation()
    if (!confirm(`确定删除「${q.title}」？`)) return
    try {
      await api.deleteAlgorithm(q.id)
      if (selectedQuestion?.id === q.id) setSelectedQuestion(null)
      loadQuestions()
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div className="online-ide">
      <h1>在线 IDE</h1>
      <p className="page-desc">
        支持 Java、Python、Go 等，ACM 模式（标准输入输出），可跳转力扣原题
      </p>

      <div className="ide-layout">
        <aside className="question-list">
          <div className="question-list-header">
            <h3>算法题库</h3>
            <button type="button" className="btn-add-question" onClick={() => setShowAddModal(true)}>+ 添加</button>
          </div>
          <ul>
            {questions.map((q) => (
              <li key={q.id}>
                <button
                  type="button"
                  className={selectedQuestion?.id === q.id ? 'active' : ''}
                  onClick={() => setSelectedQuestion(q)}
                >
                  <span className="title">{q.title}</span>
                  <span className="badge diff">{normalizeDifficulty(q.difficulty) || q.difficulty}</span>
                  {(q.leetcodeUrl || q.originalLink || q.leetcodeSlug) && (
                    <a
                      href={q.leetcodeUrl || q.originalLink || (q.leetcodeSlug ? `https://leetcode.cn/problems/${q.leetcodeSlug}/` : null) || '#'}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="source-link"
                    >
                      {q.source?.trim() || '原题'}
                    </a>
                  )}
                  <button type="button" className="q-edit" onClick={(e) => openEdit(e, q)} title="编辑">✎</button>
                  <button type="button" className="q-delete" onClick={(e) => deleteQuestion(e, q)} title="删除">×</button>
                </button>
              </li>
            ))}
          </ul>
          {questions.length === 0 && <p className="empty">暂无题目</p>}
        </aside>

        <main className="editor-area">
          {selectedQuestion && (
            <div className="question-info">
              <h3>{selectedQuestion.title}</h3>
              <p>{selectedQuestion.description}</p>
              {(selectedQuestion.leetcodeUrl || selectedQuestion.originalLink || selectedQuestion.leetcodeSlug) && (
                <a
                  href={selectedQuestion.leetcodeUrl || selectedQuestion.originalLink || (selectedQuestion.leetcodeSlug ? `https://leetcode.cn/problems/${selectedQuestion.leetcodeSlug}/` : null) || '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="leetcode-btn"
                >
                  🔗 {selectedQuestion.source?.trim() ? `${selectedQuestion.source}原题` : '原题链接'}
                </a>
              )}
            </div>
          )}

          <p className="editor-hint">在此编写代码与自测用例，点击「运行」查看输出；题库仅作题目列表与跳转。</p>
          <div className="toolbar">
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            <button className="btn-secondary btn-sm" onClick={resetCode}>
              重置代码
            </button>
            <button className="btn-primary" onClick={run} disabled={running}>
              {running ? '运行中...' : '运行'}
            </button>
          </div>

          <div className="editor-container">
            <Editor
              height="320px"
              language={LANGUAGE_IDS[language] || language}
              value={code}
              onChange={(v) => setCode(v || '')}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                scrollBeyondLastLine: false,
              }}
            />
          </div>

          <div className="output-section" ref={outputSectionRef}>
            <h4>输出</h4>
            <pre className="output-pre">
              {output.stdout}
              {output.stderr && <span className="stderr">{output.stderr}</span>}
              {!output.stdout && !output.stderr && (
                <span className="placeholder">
                  {hasRunOnce ? '运行完成。（程序未产生标准输出；若应有输出却为空，请检查代码执行服务 Piston 是否已启动）' : '运行后显示结果'}
                </span>
              )}
            </pre>
            {output.exitCode !== undefined && output.exitCode !== 0 && (
              <span className="exit-code">退出码: {output.exitCode}</span>
            )}
          </div>
        </main>
      </div>

      {showAddModal && (
        <div className="add-modal" onClick={() => { setShowAddModal(false); setAddError('') }}>
          <div className="add-modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>添加算法题</h3>
            {addError && <p className="add-modal-error">{addError}</p>}
            <form onSubmit={submitAdd}>
              <div className="form-group">
                <label>题目 *</label>
                <input value={addForm.title} onChange={(e) => setAddForm(f => ({ ...f, title: e.target.value }))} placeholder="如：两数之和" required />
              </div>
              <div className="form-group">
                <label>描述 *</label>
                <textarea value={addForm.description} onChange={(e) => setAddForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="题目描述" required />
              </div>
              <div className="form-group">
                <label>难度</label>
                <select value={addForm.difficulty} onChange={(e) => setAddForm(f => ({ ...f, difficulty: e.target.value }))}>
                  {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>力扣 slug</label>
                <input value={addForm.leetcodeSlug} onChange={(e) => setAddForm(f => ({ ...f, leetcodeSlug: e.target.value }))} placeholder="如：two-sum（与下方二选一）" />
              </div>
              <div className="form-group">
                <label>原题链接</label>
                <input type="url" value={addForm.originalLink} onChange={(e) => setAddForm(f => ({ ...f, originalLink: e.target.value }))} placeholder="如：https://leetcode.cn/problems/two-sum/" />
              </div>
              <div className="form-group">
                <label>原题出处</label>
                <input value={addForm.source} onChange={(e) => setAddForm(f => ({ ...f, source: e.target.value }))} placeholder="如：力扣、牛客（与链接对应）" />
              </div>
              <div className="form-group">
                <label>默认代码</label>
                <textarea value={addForm.defaultCode} onChange={(e) => setAddForm(f => ({ ...f, defaultCode: e.target.value }))} rows={4} placeholder="留空即为白板，用户自行编写" />
              </div>
              <div className="add-modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowAddModal(false)}>取消</button>
                <button type="submit" className="btn-primary">添加</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingQuestion && (
        <div className="add-modal" onClick={() => { setEditingQuestion(null); setEditError('') }}>
          <div className="add-modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>编辑算法题</h3>
            {editError && <p className="add-modal-error">{editError}</p>}
            <form onSubmit={submitEdit}>
              <div className="form-group">
                <label>题目 *</label>
                <input value={editForm.title} onChange={(e) => setEditForm(f => ({ ...f, title: e.target.value }))} placeholder="如：两数之和" required />
              </div>
              <div className="form-group">
                <label>描述 *</label>
                <textarea value={editForm.description} onChange={(e) => setEditForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="题目描述" required />
              </div>
              <div className="form-group">
                <label>难度</label>
                <select value={editForm.difficulty} onChange={(e) => setEditForm(f => ({ ...f, difficulty: e.target.value }))}>
                  {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>力扣 slug</label>
                <input value={editForm.leetcodeSlug} onChange={(e) => setEditForm(f => ({ ...f, leetcodeSlug: e.target.value }))} placeholder="如：two-sum（与下方二选一）" />
              </div>
              <div className="form-group">
                <label>原题链接</label>
                <input type="url" value={editForm.originalLink} onChange={(e) => setEditForm(f => ({ ...f, originalLink: e.target.value }))} placeholder="如：https://leetcode.cn/problems/two-sum/" />
              </div>
              <div className="form-group">
                <label>原题出处</label>
                <input value={editForm.source} onChange={(e) => setEditForm(f => ({ ...f, source: e.target.value }))} placeholder="如：力扣、牛客（与链接对应）" />
              </div>
              <div className="form-group">
                <label>默认代码</label>
                <textarea value={editForm.defaultCode} onChange={(e) => setEditForm(f => ({ ...f, defaultCode: e.target.value }))} rows={4} placeholder="留空即为白板，用户自行编写" />
              </div>
              <div className="add-modal-actions">
                <button type="button" className="btn-secondary" onClick={() => { setEditingQuestion(null); setEditError('') }}>取消</button>
                <button type="submit" className="btn-primary">保存</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
