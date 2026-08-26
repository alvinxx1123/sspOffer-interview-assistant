import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { useVoiceInput } from '../hooks/useVoiceInput'
import { api } from '../api/client'
import './AIInterview.css'

function generateSessionId() {
  return 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11)
}

function parseJsonLike(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/** 从 LLM 返回文本中提取面试问题数组(兼容 ```json 包裹与不完整流式文本) */
function parseQuestions(text) {
  if (!text) return null
  let s = String(text).trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) s = fence[1].trim()
  try {
    const arr = JSON.parse(s)
    return Array.isArray(arr) ? arr : null
  } catch {
    const first = s.indexOf('[')
    const last = s.lastIndexOf(']')
    if (first >= 0 && last > first) {
      try {
        const arr = JSON.parse(s.slice(first, last + 1))
        return Array.isArray(arr) ? arr : null
      } catch {}
    }
    return null
  }
}

/** 题单渲染:能解析为 JSON 数组时展示卡片,流式中或解析失败时回退原始文本(打字机效果) */
function QuestionsView({ text, parsed: parsedProp }) {
  // 优先使用后端流式推过来的结构化题目（避免 JSON 打字机）
  const parsed = parsedProp && parsedProp.length > 0 ? parsedProp : parseQuestions(text)
  if (parsed && parsed.length > 0) {
    return (
      <ol className="question-cards">
        {parsed.map((q, i) => (
          <li key={i} className="question-card">
            <div className="question-card-head">
              <span className="question-card-index">Q{i + 1}</span>
              {q.category && <span className="question-card-badge">{q.category}</span>}
            </div>
            <div className="question-card-q">{q.question}</div>
            {q.intent && (
              <QuestionIntent intent={q.intent} />
            )}
          </li>
        ))}
      </ol>
    )
  }
  return <pre className="questions-text">{text}</pre>
}

function formatPlainText(value) {
  return String(value || '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/^\s*[-•]\s*/gm, '1. ')
    .trim()
}

/** 把字符串末尾第一个完整顶层 JSON 对象抓出来（容错于 ```json 围栏、混杂前后噪声） */
function extractFirstJsonObject(text) {
  if (!text) return null
  let s = text
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) s = fence[1].trim()
  const first = s.indexOf('{')
  if (first < 0) return null
  let depth = 0, inStr = false, esc = false
  for (let i = first; i < s.length; i++) {
    const c = s[i]
    if (esc) { esc = false; continue }
    if (c === '\\') { esc = true; continue }
    if (c === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return s.slice(first, i + 1) }
  }
  return null
}

/** 从累积缓冲里把已闭合的顶层 JSON 对象逐条切出来 */
function extractCompletedJsonItems(buffer) {
  const items = []
  let s = buffer
  // 跳过开头的 ```json 围栏等
  s = s.replace(/^\s*```json\s*/i, '').replace(/```\s*$/g, '')
  while (true) {
    const first = s.indexOf('{')
    if (first < 0) break
    let depth = 0, inStr = false, esc = false, end = -1
    for (let i = first; i < s.length; i++) {
      const c = s[i]
      if (esc) { esc = false; continue }
      if (c === '\\') { esc = true; continue }
      if (c === '"') { inStr = !inStr; continue }
      if (inStr) continue
      if (c === '{') depth++
      else if (c === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    if (end < 0) break
    const piece = s.slice(first, end + 1)
    try { items.push(JSON.parse(piece)) } catch { /* ignore */ }
    s = s.slice(end + 1)
  }
  return items
}

/** 从文本剥离已闭合 JSON 段（剩余 = 未闭合部分 + 噪声） */
function stripCompletedJsonItems(buffer) {
  let s = buffer
  s = s.replace(/^\s*```json\s*/i, '').replace(/```\s*$/g, '')
  while (true) {
    const first = s.indexOf('{')
    if (first < 0) return s
    let depth = 0, inStr = false, esc = false, end = -1
    for (let i = first; i < s.length; i++) {
      const c = s[i]
      if (esc) { esc = false; continue }
      if (c === '\\') { esc = true; continue }
      if (c === '"') { inStr = !inStr; continue }
      if (inStr) continue
      if (c === '{') depth++
      else if (c === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    if (end < 0) return s
    s = s.slice(end + 1)
  }
}

/** 整段解析题单列表（多种包壳容错） */
function parseQuestionList(text) {
  const cleaned = (text || '').replace(/```json\s*/gi, '').replace(/```/g, '').trim()
  try {
    const j = JSON.parse(cleaned)
    if (Array.isArray(j)) return j
    if (Array.isArray(j?.questions)) return j.questions
  } catch {}
  // 容错：行式 JSON（每行一条）
  const lines = cleaned.split(/\n+/).map(l => l.trim()).filter(Boolean)
  const arr = []
  for (const l of lines) {
    if (!l.startsWith('{')) continue
    const obj = extractFirstJsonObject(l)
    if (obj) { try { arr.push(JSON.parse(obj)) } catch {} }
  }
  return arr
}

/** 把后端 5xx 错误翻译成「用户能改的」建议；优先看后端给的 error 段，其次看 fetch 错误 */
function friendlyCoachError(err, actionLabel) {
  const raw = err?.message || ''
  // 后端通常把根因放 message 里
  if (raw.includes('Tools are currently not supported')) {
    return `当前 LLM（${raw.match(/model[^"]*"([^"]+)"/)?.[1] || ''}）不支持工具调用，请到设置页切换为 deepseek-chat 后再试`
  }
  if (raw.toLowerCase().includes('timeout') || raw.includes('timeout')) {
    return `LLM 响应超时。可在设置页换更小/更快的模型，或稍后重试`
  }
  if (raw.includes('api_key') || raw.includes('API Key') || raw.includes('未配置')) {
    return `LLM/视觉 API Key 未配置。请到设置页填写后重试`
  }
  return `${actionLabel}失败：${raw || '请检查后端日志'}`
}

function normalizeThinkingStep(step) {
  if (!step) return null
  if (typeof step === 'string') {
    return { title: '处理中', detail: step, stage: 'general', status: 'completed' }
  }
  return {
    title: step.title || '处理中',
    detail: step.detail || '',
    stage: step.stage || 'general',
    status: step.status || 'completed',
  }
}

function renderList(items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : []
  if (list.length === 0) return null
  return (
    <ol className="coach-list">
      {list.map((item, index) => (
        <li key={`${index}-${item}`}>{formatPlainText(item)}</li>
      ))}
    </ol>
  )
}

function ComparisonBlock({ comparison }) {
  if (!comparison) return null
  return (
    <div className="coach-block">
      <div className="coach-title">系统历史对比分析</div>
      <div className="coach-text">
        历史样本：{comparison.historySampleSize ?? 0} 场 ｜ 历史平均：{comparison.previousAverageOverall ?? '-'} ｜ 本场差值：{comparison.overallDelta >= 0 ? '+' : ''}{comparison.overallDelta ?? 0}
      </div>
      {comparison.summary && <pre className="coach-pre">{formatPlainText(comparison.summary)}</pre>}
      {renderList(comparison.improvedAreas) && (
        <>
          <div className="coach-subtitle">相比历史的进步</div>
          {renderList(comparison.improvedAreas)}
        </>
      )}
      {renderList(comparison.weakerAreas) && (
        <>
          <div className="coach-subtitle">相比历史的不足</div>
          {renderList(comparison.weakerAreas)}
        </>
      )}
      {renderList(comparison.stableAreas) && (
        <>
          <div className="coach-subtitle">保持稳定的方面</div>
          {renderList(comparison.stableAreas)}
        </>
      )}
      {renderList(comparison.reinforcementSuggestions) && (
        <>
          <div className="coach-subtitle">建议优先加强</div>
          {renderList(comparison.reinforcementSuggestions)}
        </>
      )}
    </div>
  )
}

function ScoreBlock({ data, title = '评分', showComparison = false }) {
  if (!data || data.error) return data?.error ? <div className="coach-text">{data.error}</div> : null
  const scores = data.scores || {}
  return (
    <div className="coach-block">
      <div className="coach-title">{title}</div>
      <div className="coach-text">
        总分：{data.overall ?? '-'}
      </div>
      {Object.keys(scores).length > 0 && (
        <div className="coach-text">
          维度：正确性 {scores.correctness ?? '-'} / 深度 {scores.depth ?? '-'} / 结构 {scores.structure ?? '-'} / 表达 {scores.communication ?? '-'} / 风险意识 {scores.risk ?? '-'}
        </div>
      )}
      {data.summary && <pre className="coach-pre">{formatPlainText(data.summary)}</pre>}
      {renderList(data.strengths) && (
        <>
          <div className="coach-subtitle">亮点</div>
          {renderList(data.strengths)}
        </>
      )}
      {renderList(data.weaknesses) && (
        <>
          <div className="coach-subtitle">不足</div>
          {renderList(data.weaknesses)}
        </>
      )}
      {renderList(data.improvements) && (
        <>
          <div className="coach-subtitle">改进建议</div>
          {renderList(data.improvements)}
        </>
      )}
      {renderList(data.keyPointsMissing) && (
        <>
          <div className="coach-subtitle">缺失关键点</div>
          {renderList(data.keyPointsMissing)}
        </>
      )}
      {renderList(data.studyTopics) && (
        <>
          <div className="coach-subtitle">建议补强</div>
          {renderList(data.studyTopics)}
        </>
      )}
      {showComparison && <ComparisonBlock comparison={data.comparison} />}
    </div>
  )
}

/** 助手回复 → 简化为「Markdown + 纯 URL」渲染，前端不再尝试修 HTML，只负责把 [标题](URL) / 裸 URL 变成 <a>。 */
const markdownComponents = {
  a: ({ node, ...props }) => <a target="_blank" rel="noopener noreferrer" {...props} />
}

function normalizeMarkdown(content) {
  let s = String(content)
  // 模型/链路返回的内容可能没有换行，给标题/分隔线/列表项前补换行，避免挤在一行
  s = s.replace(/ ?(#{1,6}\s)/g, '\n$1')
  s = s.replace(/ ?--- ?/g, '\n---\n')
  s = s.replace(/(?:^| )([-*]\s)/g, '\n$1')
  s = s.replace(/\n{3,}/g, '\n\n').trim()
  return s
}

function MarkdownSections({ content }) {
  if (!content) return null
  const text = normalizeMarkdown(content)
  // 按 ### 小节切分；不以 ### 开头的引言段直接平铺
  const parts = text.split(/\n(?=###\s)/)
  return parts.map((part, i) => {
    const t = part.trim()
    if (!t) return null
    if (/^###\s/.test(t)) {
      return (
        <div key={i} className="assistant-card">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>{t}</ReactMarkdown>
        </div>
      )
    }
    return <ReactMarkdown key={i} remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>{t}</ReactMarkdown>
  })
}

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
  const [searchParams] = useSearchParams()

  // 从 URL 注入简历/公司（由 Mastery「拿去 AI 面试」跳转携带）
  useEffect(() => {
    const r = searchParams.get('resume')
    if (r) setResumeContent(decodeURIComponent(r))
    const c = searchParams.get('company')
    if (c) setCompany(decodeURIComponent(c))
    const d = searchParams.get('department')
    if (d) setDepartment(decodeURIComponent(d))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // 面试对话语音输入
  const voice = useVoiceInput({ onText: (chunk) => setChatInput(prev => prev + chunk) })

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
  const [endingSession, setEndingSession] = useState(false)
  const [sessionReport, setSessionReport] = useState(null)
  const [sessionReportLoading, setSessionReportLoading] = useState(false)

  // 教练（多 Agent）：答疑 / 追问 / 评分
  const [coachAnswer, setCoachAnswer] = useState('')
  const [coachFollowups, setCoachFollowups] = useState('')
  const [coachEval, setCoachEval] = useState(null)
  const [coachLoading, setCoachLoading] = useState(false)
  // 给「为什么按钮按下去没让我看到结果」的轻量 toast
  const [coachHint, setCoachHint] = useState('')

  const [loading, setLoading] = useState(false)
  const [thinkingSteps, setThinkingSteps] = useState([])
  // 题单按 JSON 结构化的状态（一次呈现，避免 JSON 打字机）
  const [parsedQuestions, setParsedQuestions] = useState([])
  const [parsingResume, setParsingResume] = useState(false)
  const [resumeMsg, setResumeMsg] = useState('')
  const chatEndRef = useRef(null)
  // chat 容器 ref（用于判断用户是否在「底部」以决定是否自动滚动）
  const chatScrollRef = useRef(null)
  const chatStickyBottomRef = useRef(true)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)
  // 智能助手：可查面经、题库、运行代码
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
    setThinkingSteps([])
    setSessionId('')
    setSessionEnded(false)
    setChatMessages([])
    setSessionReport(null)
    setSessionReportLoading(false)
    const nextSessionId = generateSessionId()
    setSessionId(nextSessionId)
    try {
      // JSON 累积器：把后端流过来的逐 token 放进缓冲，
      // 一旦缓冲里有闭合的 ```json...``` 块或 {...} 顶层对象，
      // 就把它换成漂亮的题目卡片呈现；中途只显示「打字中」状态
      let buffer = ''
      const commitParsedFromBuffer = () => {
        const items = extractCompletedJsonItems(buffer)
        for (const it of items) {
          // 解析成功的 JSON 题目 → 渲染为独立卡片（替换之前的 json 行）
        }
        const cleaned = stripCompletedJsonItems(buffer)
        if (cleaned !== buffer) buffer = cleaned
      }
      await api.generateQuestionsStream(
        company || '',
        department || '',
        resumeContent || '',
        {
          onStep: (step) => {
            const normalized = normalizeThinkingStep(step)
            if (!normalized) return
            setThinkingSteps((prev) => [...prev, normalized])
          },
          onDelta: (chunk) => {
            if (!chunk) return
            buffer += chunk
            // 解析是否出现可完整闭合的 JSON 条目
            commitParsedFromBuffer()
            // 暂时仍把原始 buffer 写回（其实一进 result 就会被整段替换）
            setQuestions(buffer)
          },
          onQuestion: (q) => {
            // 后端每解析出一题就实时推一条，append 到 parsedQuestions
            setParsedQuestions((prev) => [...prev, q])
          },
          onResult: (text) => {
            // 后端发的最终整段，习惯上还是把多余 code fence 剥掉
            const cleanedText = (text || '').replace(/```json\s*|```/g, '').trim()
            // 优先按 JSON 数组解析；解析失败时退回原文
            const parsedList = parseQuestionList(cleanedText)
            setQuestions(parsedList ? '' : cleanedText)
            setParsedQuestions(parsedList || [])
            setChatMessages([])
          },
          onError: (msg) => {
            setQuestions((prev) => prev || ('生成失败: ' + (msg || '请检查网络或后端配置')))
            setSessionId('')
          },
        }
      )
    } catch (e) {
      console.error(e)
      setSessionId('')
      setQuestions((prev) => prev || ('生成失败: ' + (e.message || '请检查网络或后端配置')))
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

  const getLastQnA = () => {
    const lastUser = [...chatMessages].reverse().find((m) => m.role === 'user')
    const lastAssistant = [...chatMessages].reverse().find((m) => m.role === 'assistant')
    return { question: lastAssistant?.content || '', answer: lastUser?.content || '' }
  }

  const coachDoEvaluate = async () => {
    if (coachLoading) return
    const { question, answer } = getLastQnA()
    if (!question.trim()) {
      setCoachHint('请先答完一题后查看点评')
      return
    }
    if (!answer.trim()) {
      setCoachHint('你还没回答当前问题，请先把答案输入到下方对话框')
      return
    }
    setCoachHint('')
    setCoachLoading(true)
    setCoachEval(null)
    try {
      const res = await api.coachEvaluate(question, answer, resumeContent || '', company || '', department || '')
      setCoachEval(parseJsonLike(res) || res || null)
    } catch (e) {
      console.error(e)
      setCoachEval({ error: friendlyCoachError(e, '当前回答点评') })
    } finally {
      setCoachLoading(false)
    }
  }

  const coachDoFollowups = async () => {
    if (coachLoading) return
    const { question, answer } = getLastQnA()
    if (!question.trim()) {
      setCoachHint('请先答完一题后查看可继续深挖点')
      return
    }
    if (!answer.trim()) {
      setCoachHint('你还没回答当前问题，请先把答案输入到下方对话框')
      return
    }
    setCoachHint('')
    setCoachLoading(true)
    setCoachFollowups('')
    try {
      const res = await api.coachFollowups(question, answer, company || '', department || '')
      setCoachFollowups(formatPlainText(res?.followups || ''))
    } catch (e) {
      console.error(e)
      setCoachFollowups('生成追问失败: ' + friendlyCoachError(e, '可继续深挖点'))
    } finally {
      setCoachLoading(false)
    }
  }

  const coachDoAnswer = async () => {
    if (coachLoading) return
    const { question } = getLastQnA()
    if (!question.trim()) {
      setCoachHint('请先答完一题后查看参考答案')
      return
    }
    setCoachHint('')
    setCoachLoading(true)
    setCoachAnswer('')
    try {
      const res = await api.coachAnswer(question, resumeContent || '', company || '', department || '')
      setCoachAnswer(formatPlainText(res?.answer || ''))
    } catch (e) {
      console.error(e)
      setCoachAnswer('答疑失败: ' + friendlyCoachError(e, '参考答案'))
    } finally {
      setCoachLoading(false)
    }
  }


  const onChatScroll = () => {
    const el = chatScrollRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const sticky = distFromBottom < 60
    chatStickyBottomRef.current = sticky
    setShowJumpToBottom(!sticky)
  }
  const jumpToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    chatStickyBottomRef.current = true
    setShowJumpToBottom(false)
  }
  useEffect(() => {
    // 仅当用户「贴底」时贴下；用户向上翻时不要打断
    if (chatStickyBottomRef.current) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [chatMessages])

  const loadHistory = () => {
    api.getChatSessions()
      .then((data) => setHistorySessions(Array.isArray(data) ? data : []))
      .catch((e) => { console.error(e); setHistorySessions([]) })
  }

  useEffect(() => {
    loadHistory()
  }, [])

  const pollSessionReport = async (sid) => {
    setSessionReportLoading(true)
    setSessionReport(null)
    for (let i = 0; i < 8; i++) {
      try {
        const detail = await api.getChatSession(sid)
        if (detail?.overallScore != null || detail?.reportSummary || detail?.reportJson) {
          setSessionReport({
            ...detail,
            parsedReport: parseJsonLike(detail?.reportJson),
          })
          setSessionReportLoading(false)
          loadHistory()
          return
        }
      } catch (e) {
        console.error('获取面试报告失败', e)
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    setSessionReportLoading(false)
  }

  const endSession = async () => {
    if (!sessionId || sessionEnded || endingSession) return
    setSessionEnded(true)
    setEndingSession(true)
    const sid = sessionId
    try {
      await api.endChatSession(sid, questions, resumeContent, company, department)
      loadHistory()
      await pollSessionReport(sid)
    } catch (e) {
      console.error(e)
      setSessionEnded(false)
      alert('结束会话失败：' + (e?.message || '请重试'))
    } finally {
      setEndingSession(false)
    }
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

     {(loading || thinkingSteps.length > 0 || questions) && (
     <div className="interview-panel">

     {(loading || thinkingSteps.length > 0) && (
        <div className="panel-section thinking-steps">
         <h3 className="thinking-title">思考过程</h3>
         <ul className="thinking-list">
           {thinkingSteps.map((step, i) => (
             <li key={i} className="thinking-step">
               <span className={`thinking-dot ${step.status === 'in_progress' ? 'thinking-dot-pulse' : ''}`} />
               <div className="thinking-step-body">
                 <div className="thinking-step-title">{step.title}</div>
                 {step.detail && <div className="thinking-step-detail">{step.detail}</div>}
               </div>
             </li>
           ))}
           {loading && thinkingSteps.length === 0 && (
             <li className="thinking-step">
               <span className="thinking-dot thinking-dot-pulse" />
               准备中…
             </li>
           )}
         </ul>
        </div>
      )}

      {questions && (
        <div className="panel-divider" />
     )}

      {questions && (
        <>
          <div className="panel-section questions-result">
            <h2>生成的面试问题</h2>
            {loading && parsedQuestions.length === 0 && (
              <div className="questions-streaming-tag">题单流式生成中…</div>
            )}
            {parsedQuestions.length > 0
              ? <QuestionsView parsed={parsedQuestions} text={questions} />
              : (questions && <QuestionsView text={questions} />)}
          </div>

          {sessionId && (
            <>
            <div className="panel-divider" />
            <div className="panel-section chat-section">
              <div className="chat-header">
                <h2>与面试官探讨</h2>
                {!sessionEnded && (
                  <button className="btn-secondary btn-end-session" onClick={endSession} disabled={endingSession}>
                    {endingSession ? '结束中...' : '结束当前会话并评分'}
                  </button>
                )}
                {sessionEnded && <span className="session-ended-tag">会话已保存</span>}
              </div>
              <p className="chat-hint">上面已经一次性生成了整套题单，覆盖实习、项目、Java 八股和 AI/Agent/LLM 等方向。你可以按自己的节奏挑题作答；这里的面试官会基于你的回答继续深挖，不会再重新给整套题目。点击“结束当前会话并评分”后，再生成整场总结与分数。</p>
              <div className="coach-panel">
                <div className="coach-block coach-block--inline">
                  <div className="coach-title">辅助功能</div>
                  <div className="coach-hint-row">
                    <button className="coach-icon-btn" onClick={coachDoEvaluate} disabled={coachLoading} title="对你最近一轮回答做点评">📝 点评</button>
                    <button className="coach-icon-btn" onClick={coachDoFollowups} disabled={coachLoading} title="基于回答给出 2-4 个更深的问题">🤔 深挖</button>
                    <button className="coach-icon-btn" onClick={coachDoAnswer} disabled={coachLoading} title="参考要点（不覆盖主对话）">💡 参考</button>
                    {coachLoading && <span className="coach-loading">处理中…</span>}
                  </div>
                  {coachHint && <div className="coach-hint-bubble">{coachHint}</div>}
                </div>
              </div>
              {(sessionReportLoading || sessionReport) && (
                <div className="coach-panel">
                  {sessionReportLoading && (
                    <div className="coach-block">
                      <div className="coach-title">本场完整面试评价</div>
                      <div className="coach-text">正在整理本场完整面试表现，请稍候...</div>
                    </div>
                  )}
                  {sessionReport && (
                    <>
                      <ScoreBlock data={sessionReport.parsedReport} title="本场完整面试评价" />
                      <ComparisonBlock comparison={sessionReport.parsedReport?.comparison} />
                    </>
                  )}
                </div>
              )}
              {(coachEval || coachFollowups || coachAnswer) && (
                <div className="coach-panel">
                  {coachEval && <ScoreBlock data={coachEval} title="当前回答点评" />}
                  {coachFollowups && (
                    <div className="coach-block">
                      <div className="coach-title">可继续深挖的问题</div>
                      <pre className="coach-pre">{formatPlainText(coachFollowups)}</pre>
                    </div>
                  )}
                  {coachAnswer && (
                    <div className="coach-block">
                      <div className="coach-title">参考答案</div>
                      <pre className="coach-pre">{formatPlainText(coachAnswer)}</pre>
                    </div>
                  )}
                </div>
              )}

              <div className="chat-messages" ref={chatScrollRef} onScroll={onChatScroll}>
                {chatMessages.map((m, i) => (
                  <div key={i} className={`chat-msg ${m.role}`}>
                    <span className="chat-role">{m.role === 'user' ? '你' : '面试官'}</span>
                    <div className="chat-content markdown-like"><MarkdownSections content={m.content || ''} /></div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="chat-msg assistant">
                    <span className="chat-role">面试官</span>
                    <span className="chat-loading">思考中（可能正在调用工具）...</span>
                  </div>
                )}
                <div ref={chatEndRef} />
                {showJumpToBottom && chatMessages.length > 0 && (
                  <button
                    type="button"
                    className="chat-jump-bottom"
                    onClick={jumpToBottom}
                    title="跳到底部"
                  >↓ 到底部</button>
                )}
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
                  placeholder="输入你的回答（或点 🎤 语音输入，Enter 发送，Shift+Enter 换行）"
                  rows={2}
                  disabled={chatLoading}
                />
                {voice.supported && (
                  <button
                    type="button"
                    className={`mic-btn ${voice.listening ? 'recording' : ''}`}
                    title={voice.listening ? '点击停止语音' : '语音输入'}
                    onClick={voice.toggle}
                    disabled={chatLoading}
                  >{voice.listening ? '⏹️' : '🎤'}</button>
                )}
                {voice.listening && voice.interim && (
                  <span className="interim-text">{voice.interim}</span>
                )}
                <button
                  className="btn-primary chat-send"
                  onClick={sendChat}
                  disabled={chatLoading || !chatInput.trim()}
                >
                  继续面试
                </button>
              </div>
             )}
           </div>
           </>
          )}
       </>
     )}

     </div>
     )}

      <div className="tools-section">
        <h2>智能助手（Function Calling）</h2>
        <p className="tools-hint">面试对话中可直接说「查一下字节后端的面经」「给我一道中等难度的算法题」「跑一下这段代码：…」，面试官会自动调用工具并继续面试。下方为独立助手入口，用于非面试场景快速查面经/题库/跑代码。</p>
        <div className="tools-messages">
          {toolsMessages.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}`}>
              <span className="chat-role">{m.role === 'user' ? '你' : '助手'}</span>
              <div className="chat-content markdown-like"><MarkdownSections content={m.content || ''} /></div>
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
                    <QuestionsView text={viewingSession.questions} />
                  </div>
                )}
                {viewingSession && !viewingSession._error && (
                  <div className="session-detail-messages">
                    {(viewingSession.overallScore != null || viewingSession.reportSummary || viewingSession.reportJson) && (
                      <>
                        <ScoreBlock data={parseJsonLike(viewingSession.reportJson)} title="本场完整面试评价" />
                        <ComparisonBlock comparison={parseJsonLike(viewingSession.reportJson)?.comparison} />
                      </>
                    )}
                    <h4>问答记录</h4>
                    {(viewingSession.messages || []).length > 0 ? (
                      (viewingSession.messages || []).map((m, i) => (
                        <div key={i} className={`chat-msg ${m.role}`}>
                          <span className="chat-role">{m.role === 'user' ? '你' : '面试官'}</span>
                          <div className="chat-content markdown-like"><MarkdownSections content={m.content || ''} /></div>
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
