import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api/client'
import './AIInterview.css'

function generateSessionId() {
  return 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11)
}

/** 助手回复 → 简化为「Markdown + 纯 URL」渲染，前端不再尝试修 HTML，只负责把 [标题](URL) / 裸 URL 变成 <a>。 */
function formatAssistantContent(content) {
  if (!content) return ''
  let s = String(content)
  // 统一引号（含全角/Unicode）
  s = s.replace(/\u201C|\u201D|\u201E|\u201F|\u2033|\u2036|\uFF02/g, '"')
       .replace(/&quot;|&#34;|&amp;quot;/g, '"')

  // 若原始内容本身已经包含 <a 或 href=，视为“旧 HTML”，仅做转义+加粗+换行，避免再次包裹导致 href 里出现 <a%20href=
  if (s.includes('<a ') || s.includes('href=')) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br/>')
  }

  // 从这里开始，是“干净文本 + Markdown 链接”的普通路径
  // 先对 <、> 做转义，避免模型输出的 HTML 被直接执行
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // 生成 <a> 时 href 必须为纯净 URL，防止 `<a href=` 等被当成地址栏的一部分
  const cleanHref = (u) =>
    (u || '')
      .split('"')[0]
      .split(' ')[0]
      .split('<')[0]
      .trim()

  // 1) 先把 Markdown 链接 [标题](URL) 变成 <a>
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, text, url) =>
      `<a href="${cleanHref(url)}" target="_blank" rel="noopener noreferrer">${(text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</a>`
  )

  // 2) 再把「未在 href 中的」裸 URL 变成 <a>，避免对 <a href="url"> 里的 url 再包一层
  s = s.replace(
    /(?<!href=")(https?:\/\/[^\s<>"')\]\u4e00-\u9fa5,，。、]+)/g,
    (_, url) =>
      `<a href="${cleanHref(url)}" target="_blank" rel="noopener noreferrer">${cleanHref(url)}</a>`
  )

  // 3) 加粗 **文本**
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

  // 4) 换行变 <br/>
  s = s.replace(/\n/g, '<br/>')

  return s
}

export default function AIInterview() {
  const [companies, setCompanies] = useState([])
  const [departments, setDepartments] = useState([])
  const [company, setCompany] = useState('')
  const [department, setDepartment] = useState('')
  const [resumeContent, setResumeContent] = useState('')
  const [questions, setQuestions] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [sessionEnded, setSessionEnded] = useState(false)
  const [chatMessages, setChatMessages] = useState([])
  const [historySessions, setHistorySessions] = useState([])
  const [viewingSession, setViewingSession] = useState(null)
  const [loadingSession, setLoadingSession] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [parsingResume, setParsingResume] = useState(false)
  const [resumeMsg, setResumeMsg] = useState('')
  const chatEndRef = useRef(null)
  // 智能助手（Function Calling）：可查面经、题库、运行代码
  const [toolsInput, setToolsInput] = useState('')
  const [toolsMessages, setToolsMessages] = useState([])
  const [toolsLoading, setToolsLoading] = useState(false)

  useEffect(() => {
    api.getCompanies().then(setCompanies).catch(console.error)
  }, [])

  useEffect(() => {
    if (!company.trim()) {
      setDepartments([])
      setDepartment('')
      return
    }
    api.getDepartments(company).then(setDepartments).catch(console.error)
  }, [company])

  const generate = async () => {
    setLoading(true)
    setQuestions('')
    setSessionId('')
    setSessionEnded(false)
    setChatMessages([])
    try {
      const text = await api.generateQuestions(company || '', department || '', resumeContent || '')
      setQuestions(text || '')
      setSessionId(generateSessionId())
    } catch (e) {
      console.error(e)
      setQuestions('生成失败: ' + (e.message || '请检查网络或后端配置'))
    } finally {
      setLoading(false)
    }
  }

  const sendChat = async () => {
    const msg = chatInput.trim()
    if (!msg || chatLoading || !sessionId) return
    setChatInput('')
    setChatMessages((prev) => [...prev, { role: 'user', content: msg }])
    setChatLoading(true)
    try {
      const res = await api.chatSession(sessionId, msg, questions, resumeContent, company, department)
      const reply = res?.reply ?? (typeof res === 'string' ? res : '')
      setChatMessages((prev) => [...prev, { role: 'assistant', content: reply }])
    } catch (e) {
      console.error(e)
      setChatMessages((prev) => [...prev, { role: 'assistant', content: '回复失败: ' + (e.message || '') }])
    } finally {
      setChatLoading(false)
    }
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const loadHistory = () => {
    api.getChatSessions()
      .then((data) => setHistorySessions(Array.isArray(data) ? data : []))
      .catch((e) => { console.error(e); setHistorySessions([]) })
  }

  useEffect(() => {
    loadHistory()
  }, [])

  const endSession = () => {
    if (!sessionId || sessionEnded) return
    setSessionEnded(true)
    const sid = sessionId
    api.endChatSession(sid, questions, resumeContent, company, department).then(loadHistory).catch(console.error)
  }

  const sendToolsChat = async () => {
    const msg = toolsInput.trim()
    if (!msg || toolsLoading) return
    setToolsInput('')
    setToolsMessages((prev) => [...prev, { role: 'user', content: msg }])
    setToolsLoading(true)
    try {
      const res = await api.chatWithTools(msg)
      const reply = res?.reply ?? (typeof res === 'string' ? res : '')
      setToolsMessages((prev) => [...prev, { role: 'assistant', content: reply }])
    } catch (e) {
      console.error(e)
      setToolsMessages((prev) => [...prev, { role: 'assistant', content: '回复失败: ' + (e.message || '') }])
    } finally {
      setToolsLoading(false)
    }
  }

  const viewSession = async (sess) => {
    if (!sess || (!sess.sessionId && sess.id == null)) return
    setViewingSession(null)
    setLoadingSession(true)
    try {
      let s
      if (sess.id != null && sess.id !== '') {
        s = await api.getChatSessionById(sess.id)
      } else if (sess.sessionId) {
        s = await api.getChatSession(sess.sessionId)
      } else {
        setLoadingSession(false)
        return
      }
      setViewingSession(s || { ...sess, messages: [] })
    } catch (e) {
      console.error('查看会话失败', e)
      setViewingSession({ ...sess, messages: [], _error: true })
    } finally {
      setLoadingSession(false)
    }
  }

  const deleteSession = async (e, sess) => {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    const target = sess ?? viewingSession
    if (!target) return
    if (!confirm('确定删除此会话？')) return
    try {
      if (target.id != null && target.id !== '') {
        await api.deleteChatSessionById(target.id)
      } else if (target.sessionId) {
        await api.deleteChatSession(target.sessionId)
      } else {
        alert('无法识别会话，删除失败')
        return
      }
      if (viewingSession && (String(viewingSession.id) === String(target.id) || viewingSession.sessionId === target.sessionId)) {
        setViewingSession(null)
      }
      loadHistory()
    } catch (err) {
      console.error('删除会话失败', err)
      alert('删除失败: ' + (err?.message || '请重试'))
    }
  }

  return (
    <div className="ai-interview">
      <h1>AI 面试模拟</h1>
      <p className="page-desc">根据目标公司/部门的面经数据，结合你的简历生成深挖问题</p>

      <div className="form-section">
        <div className="form-row">
          <div className="form-group">
            <label>目标公司（可选，可自定义输入）</label>
            <input
              list="company-list"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="如：字节跳动"
            />
            <datalist id="company-list">
              {companies.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="form-group">
            <label>部门（可选，可自定义输入）</label>
            <input
              list="department-list"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="如：基础架构"
            />
            <datalist id="department-list">
              {departments.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </div>
        </div>
        <div className="resume-section">
          <label className="resume-section-label">简历（上传 PDF/图片 或 直接输入下方）</label>
          <label className="resume-upload-zone">
            <input
              type="file"
              accept=".pdf,image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                setParsingResume(true)
                setResumeMsg('')
                try {
                  const { content } = await api.parseResume(file)
                  setResumeContent(content || '')
                  setResumeMsg('解析完成')
                } catch (err) {
                  setResumeMsg('解析失败: ' + (err.message || ''))
                } finally {
                  setParsingResume(false)
                  e.target.value = ''
                }
              }}
              disabled={parsingResume}
            />
            <span className="resume-upload-icon">📄</span>
            <span className="resume-upload-text">
              {parsingResume ? '解析中...' : '上传 PDF 或 图片解析'}
            </span>
          </label>
          {resumeMsg && <span className={`resume-msg ${resumeMsg.startsWith('解析失败') ? 'error' : ''}`}>{resumeMsg}</span>}
        </div>
        <div className="form-group">
          <label>简历内容</label>
          <textarea
            value={resumeContent}
            onChange={(e) => setResumeContent(e.target.value)}
            rows={8}
            placeholder="粘贴你的简历内容，AI 将根据简历和该公司面经生成针对性的深挖问题..."
          />
        </div>
        <button className="btn-primary" onClick={generate} disabled={loading}>
          {loading ? '生成中...' : '生成深挖问题'}
        </button>
      </div>

      {questions && (
        <>
          <div className="questions-result">
            <h2>生成的面试问题</h2>
            <pre className="questions-text">{questions}</pre>
          </div>

          {sessionId && (
            <div className="chat-section">
              <div className="chat-header">
                <h2>与面试官探讨</h2>
                {!sessionEnded && (
                  <button className="btn-secondary btn-end-session" onClick={endSession}>
                    结束当前会话
                  </button>
                )}
                {sessionEnded && <span className="session-ended-tag">会话已保存</span>}
              </div>
              <p className="chat-hint">针对以上问题作答或提问；也可粘贴问题请面试官给答案供你学习。AI 会根据意图追问或答疑</p>
              <div className="chat-messages">
                {chatMessages.map((m, i) => (
                  <div key={i} className={`chat-msg ${m.role}`}>
                    <span className="chat-role">{m.role === 'user' ? '你' : '面试官'}</span>
                    <div className="chat-content markdown-like" dangerouslySetInnerHTML={{ __html: (m.content || '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br/>') }} />
                  </div>
                ))}
                {chatLoading && (
                  <div className="chat-msg assistant">
                    <span className="chat-role">面试官</span>
                    <span className="chat-loading">思考中...</span>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              {!sessionEnded && (
              <div className="chat-input-row">
                <textarea
                  className="chat-input"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendChat()
                    }
                  }}
                  placeholder="输入你的回答或提问（Enter 发送，Shift+Enter 换行）"
                  rows={2}
                  disabled={chatLoading}
                />
                <button
                  className="btn-primary chat-send"
                  onClick={sendChat}
                  disabled={chatLoading || !chatInput.trim()}
                >
                  发送
                </button>
              </div>
              )}
            </div>
          )}
        </>
      )}

      <div className="tools-section">
        <h2>智能助手（Function Calling v2）</h2>
        <p className="tools-hint">直接提问，助手可自动查面经、查题库、运行代码。例如：「查一下字节后端的面经」「给我一道中等难度的算法题」「运行这段 Java 代码：...」</p>
        <div className="tools-messages">
          {toolsMessages.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}`}>
              <span className="chat-role">{m.role === 'user' ? '你' : '助手'}</span>
              <div className="chat-content markdown-like" style={{ whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: formatAssistantContent(m.content) }} />
            </div>
          ))}
          {toolsLoading && (
            <div className="chat-msg assistant">
              <span className="chat-role">助手</span>
              <span className="chat-loading">思考中（可能正在调用工具）...</span>
            </div>
          )}
        </div>
        <div className="chat-input-row">
          <input
            type="text"
            className="tools-input"
            value={toolsInput}
            onChange={(e) => setToolsInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendToolsChat()}
            placeholder="输入问题，如：查一下腾讯面经、给我一道算法题"
            disabled={toolsLoading}
          />
          <button className="btn-primary chat-send" onClick={sendToolsChat} disabled={toolsLoading || !toolsInput.trim()}>
            发送
          </button>
        </div>
      </div>

      <div className="history-section">
        <h2>历史会话</h2>
        <p className="history-hint">可查看往期面试探讨，供复习学习</p>
        {historySessions.length === 0 ? (
          <p className="history-empty">暂无历史会话</p>
        ) : (
          <ul className="history-list">
            {historySessions.map((s, idx) => {
              const q = (s.questions || '').replace(/\s+/g, ' ').trim()
              const preview = q.slice(0, 40)
              let dateStr = ''
              if (s.createdAt) {
                try {
                  const d = typeof s.createdAt === 'string' ? new Date(s.createdAt) : Array.isArray(s.createdAt) ? new Date(...s.createdAt) : new Date(s.createdAt)
                  if (!isNaN(d.getTime())) dateStr = d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                } catch (_) {}
              }
              const companyDept = [s.company || '通用', s.department || '技术'].filter(Boolean).join(' / ')
              const title = preview || companyDept || `会话 ${idx + 1}`
              const handleView = (e) => { e?.stopPropagation(); viewSession(s) }
              const handleDelete = (e) => { e?.preventDefault(); e?.stopPropagation(); deleteSession(e, s) }
              return (
                <li key={s.id ?? s.sessionId ?? idx} className="history-item">
                  <div className="history-item-row">
                    <div
                      role="button"
                      tabIndex={0}
                      className="history-item-main"
                      onClick={handleView}
                      onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); handleView(ev); } }}
                    >
                      <span className="history-title">{dateStr ? `📅 ${dateStr}` : `#${idx + 1}`}</span>
                      <span className="history-meta">{companyDept}</span>
                      <span className="history-preview" title={q || title}>{preview ? `${preview}${q.length > 40 ? '...' : ''}` : title}</span>
                      <span className="history-arrow">查看 →</span>
                    </div>
                    <button
                      type="button"
                      className="history-delete"
                      onClick={handleDelete}
                      title="删除"
                      aria-label="删除"
                    >
                      ×
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {(viewingSession || loadingSession) &&
          createPortal(
            <div className="session-detail-modal" onClick={() => !loadingSession && setViewingSession(null)} role="dialog" aria-modal="true">
              <div className="session-detail-content" onClick={(e) => e.stopPropagation()}>
                <div className="session-detail-header">
                  <h3>会话详情</h3>
                  <span className="session-detail-actions">
                    {(viewingSession?.sessionId || viewingSession?.id != null) && (
                      <button type="button" className="btn-delete-session" onClick={(ev) => { ev.stopPropagation(); deleteSession(ev, viewingSession); }}>删除</button>
                    )}
                    <button type="button" className="btn-close-modal" onClick={(ev) => { ev.stopPropagation(); setViewingSession(null); }}>×</button>
                  </span>
                </div>
                {loadingSession && !viewingSession && <p className="session-loading">加载中...</p>}
                {viewingSession?._error && <p className="session-empty-hint">加载失败，请重试</p>}
                {viewingSession && !viewingSession._error && viewingSession.questions && (
                  <div className="session-detail-questions">
                    <h4>本场面试问题</h4>
                    <pre>{viewingSession.questions}</pre>
                  </div>
                )}
                {viewingSession && !viewingSession._error && (
                  <div className="session-detail-messages">
                    <h4>问答记录</h4>
                    {(viewingSession.messages || []).length > 0 ? (
                      (viewingSession.messages || []).map((m, i) => (
                        <div key={i} className={`chat-msg ${m.role}`}>
                          <span className="chat-role">{m.role === 'user' ? '你' : '面试官'}</span>
                          <div className="chat-content markdown-like" dangerouslySetInnerHTML={{ __html: (m.content || '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br/>') }} />
                        </div>
                      ))
                    ) : (
                      <p className="session-empty-hint">暂无问答</p>
                    )}
                  </div>
                )}
              </div>
            </div>,
            document.body
          )}
    </div>
  )
}
