import { useState, useEffect } from 'react'
import Editor from '@monaco-editor/react'
import { api } from '../api/client'
import './OnlineIDE.css'

const DIFFICULTIES = ['简单', '中等', '困难']

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
  const [running, setRunning] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState({
    title: '', description: '', difficulty: '中等',
    leetcodeSlug: '', defaultCode: '', testCases: '',
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
      setOutput({ stdout: '', stderr: '执行失败: ' + e.message, exitCode: -1 })
    } finally {
      setRunning(false)
    }
  }

  const resetCode = () => setCode(BLANK_TEMPLATE)

  const submitAdd = async (e) => {
    e.preventDefault()
    if (!addForm.title?.trim() || !addForm.description?.trim()) return
    try {
      await api.createAlgorithm({
        title: addForm.title.trim(),
        description: addForm.description.trim(),
        difficulty: addForm.difficulty || null,
        leetcodeSlug: addForm.leetcodeSlug?.trim() || null,
        defaultCode: addForm.defaultCode?.trim() || null,
        testCases: addForm.testCases?.trim() || null,
      })
      setShowAddModal(false)
      setAddForm({ title: '', description: '', difficulty: '中等', leetcodeSlug: '', defaultCode: '', testCases: '' })
      loadQuestions()
    } catch (err) {
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
                  <span className="badge diff">{q.difficulty}</span>
                  {q.leetcodeSlug && (
                    <a
                      href={q.leetcodeUrl || `https://leetcode.cn/problems/${q.leetcodeSlug}/`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="leetcode-link"
                    >
                     力扣
                    </a>
                  )}
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
              {(selectedQuestion.leetcodeUrl || selectedQuestion.leetcodeSlug) && (
                <a
                  href={selectedQuestion.leetcodeUrl || `https://leetcode.cn/problems/${selectedQuestion.leetcodeSlug}/`}
                  target="_blank"
                  rel="noreferrer"
                  className="leetcode-btn"
                >
                  🔗 力扣原题
                </a>
              )}
            </div>
          )}

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

          <div className="output-section">
            <h4>输出</h4>
            <pre className="output-pre">
              {output.stdout}
              {output.stderr && <span className="stderr">{output.stderr}</span>}
              {!output.stdout && !output.stderr && <span className="placeholder">运行后显示结果</span>}
            </pre>
            {output.exitCode !== undefined && output.exitCode !== 0 && (
              <span className="exit-code">退出码: {output.exitCode}</span>
            )}
          </div>
        </main>
      </div>

      {showAddModal && (
        <div className="add-modal" onClick={() => setShowAddModal(false)}>
          <div className="add-modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>添加算法题</h3>
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
                <input value={addForm.leetcodeSlug} onChange={(e) => setAddForm(f => ({ ...f, leetcodeSlug: e.target.value }))} placeholder="如：two-sum" />
              </div>
              <div className="form-group">
                <label>默认代码</label>
                <textarea value={addForm.defaultCode} onChange={(e) => setAddForm(f => ({ ...f, defaultCode: e.target.value }))} rows={4} placeholder="留空即为白板，用户自行编写" />
              </div>
              <div className="form-group">
                <label>测试用例 (stdin)</label>
                <textarea value={addForm.testCases} onChange={(e) => setAddForm(f => ({ ...f, testCases: e.target.value }))} rows={3} placeholder="留空则由用户自行输入测试" />
              </div>
              <div className="add-modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowAddModal(false)}>取消</button>
                <button type="submit" className="btn-primary">添加</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
