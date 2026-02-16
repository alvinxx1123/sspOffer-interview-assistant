// 开发时若代理 404，可设置 VITE_API_BASE=http://127.0.0.1:8080/api 直接连后端
const API_BASE = import.meta.env.VITE_API_BASE || '/api'

import { getPassword, getPasswordAsync, clearPassword, setPassword } from '../utils/adminAuth'

async function doFetch(url, options, isModify) {
  let reqOpts = options
  if (isModify) {
    const p = getPassword()
    if (p) reqOpts = { ...options, headers: { ...(options.headers || {}), 'X-Admin-Password': p } }
  }
  let res = await fetch(url, reqOpts)
  if (isModify && res.status === 403) {
    clearPassword()
    const p = await getPasswordAsync()
    if (!p) throw new Error('需要管理员密码')
    // 重试时使用新对象并显式带上密码头，避免部分环境未正确发送自定义 header
    const retryOpts = { ...options, headers: { ...(options.headers || {}), 'X-Admin-Password': p } }
    res = await fetch(url, retryOpts)
    if (res.status === 403) {
      clearPassword()
      throw new Error('密码错误，请重试')
    }
    if (p) setPassword(p)
  }
  return res
}

async function request(path, options = {}, requireAuth = false) {
  const method = (options.method || 'GET').toUpperCase()
  const isModify = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)
  const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE
  const url = base.startsWith('http') ? `${base}${path}` : `${base}${path}`
  const opts = {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  }
  const res = await doFetch(url, opts, isModify || requireAuth)
  if (!res.ok) {
    let msg = res.statusText
    try {
      const body = await res.clone().json()
      if (body?.message) msg = body.message
      else if (body?.error) msg = body.error
    } catch {}
    throw new Error(`${res.status} ${msg}`)
  }
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export const api = {
  // 面经
  getCompanies: () => request('/interviews/companies'),
  getDepartments: (company) => request(`/interviews/companies/${encodeURIComponent(company)}/departments`),
  searchInterviews: (company, department) => {
    const params = new URLSearchParams({ company })
    if (department) params.append('department', department)
    return request(`/interviews/search?${params}`)
  },
  addExperiences: (experiences) =>
    request('/interviews/experiences', {
      method: 'POST',
      body: JSON.stringify(experiences),
    }),
  deleteExperience: async (id) => {
    const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE
    const doDelete = async (url) => {
      const res = await doFetch(url, { method: 'DELETE', headers: {} }, true)
      if (res.ok) return true
      const text = await res.text()
      throw new Error(text || res.statusText)
    }
    const doPostDelete = async (url) => {
      const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }
      const res = await doFetch(url, opts, true)
      if (res.ok) return true
      const text = await res.text()
      throw new Error(text || res.statusText)
    }
    try {
      await doPostDelete('http://127.0.0.1:8080/api/interviews/experiences/delete')
      return
    } catch (_) {}
    try {
      await doDelete(`http://127.0.0.1:8080/api/interviews/experiences/${id}`)
      return
    } catch (_) {}
    try {
      const proxyUrl = base.startsWith('http') ? `${base}/interviews/experiences/delete` : `${base}/interviews/experiences/delete`
      await doPostDelete(proxyUrl)
    } catch (e) {
      throw new Error(e.message || '删除失败')
    }
  },
  parseImage: async (file) => {
    const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE
    const directUrl = 'http://127.0.0.1:8080/api/interviews/parseImage'
    const proxyUrl = base.startsWith('http') ? `${base}/interviews/parseImage` : `${base}/interviews/parseImage`
    const doParse = async (targetUrl) => {
      const fd = new FormData()
      fd.append('image', file)
      return doFetch(targetUrl, { method: 'POST', headers: {}, body: fd }, true)
    }
    // 图片解析：先直连后端（代理常 404），失败再试代理
    let res
    try {
      res = await doParse(directUrl)
      if (res.ok) return res.json()
    } catch (_) {}
    try {
      res = await doParse(proxyUrl)
    } catch (_) {}
    if (!res || !res.ok) {
      let msg = res ? (res.status + ' ' + res.statusText) : '网络错误，请确认后端已启动'
      try {
        const body = await res?.json?.()
        if (body?.error) msg = body.error
        else if (body?.message) msg = body.message
      } catch (_) {}
      throw new Error(msg)
    }
    return res.json()
  },
  generateQuestions: async (company, department, resume) => {
    const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE
    const directUrl = 'http://127.0.0.1:8080/api/interviews/questions'
    const proxyUrl = base.startsWith('http') ? `${base}/interviews/questions` : `${base}/interviews/questions`
    const body = JSON.stringify({ company, department, resume })
    const doReq = (url) =>
      doFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, true)
    let res
    try {
      res = await doReq(directUrl)
      if (res?.ok) return (await res.text()) || null
    } catch (_) {}
    try {
      res = await doReq(proxyUrl)
    } catch (_) {}
    if (!res || !res.ok) {
      const msg = res ? (res.status + ' ' + res.statusText) : '请确认后端已启动 (mvn spring-boot:run) 且端口 8080 可访问'
      let err = msg
      try {
        const json = await res?.json?.()
        if (json?.error) err = json.error
      } catch (_) {}
      throw new Error(err)
    }
    const text = await res.text()
    return text || null
  },
  chatSession: (sessionId, userMessage, questions, resume, company, department) =>
    request('/interviews/chat-session', {
      method: 'POST',
      body: JSON.stringify({ sessionId, userMessage, questions: questions || '', resume: resume || '', company: company || '', department: department || '' }),
    }),
  endChatSession: (sessionId, questions, resume, company, department) =>
    request('/interviews/chat-session/end', {
      method: 'POST',
      body: JSON.stringify({ sessionId, questions: questions || '', resume: resume || '', company: company || '', department: department || '' }),
    }),
  getChatSessions: () => request('/interviews/chat-sessions'),
  getChatSession: (sessionId) => request(`/interviews/chat-sessions/${encodeURIComponent(sessionId)}`),
  getChatSessionById: (id) => request(`/interviews/chat-sessions/by-id/${id}`),
  deleteChatSession: (sessionId) =>
    request(`/interviews/chat-sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),
  deleteChatSessionById: (id) =>
    request(`/interviews/chat-sessions/by-id/${id}`, { method: 'DELETE' }),
  chat: (query, company, department) =>
    request('/interviews/chat', {
      method: 'POST',
      body: JSON.stringify({ query, company, department }),
    }),

  // 复盘（超时 3 分钟；先试代理，失败再直连后端，减少 Failed to fetch）
  analyzeReplay: async (company, department, content) => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 180000)
    const body = JSON.stringify({ company, department, content })
    let opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ctrl.signal }
    const p = getPassword()
    if (p) opts.headers = { ...opts.headers, 'X-Admin-Password': p }
    const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE
    const proxyUrl = base.startsWith('http') ? `${base}/replay/analyze` : `${base}/replay/analyze`
    const directUrl = 'http://127.0.0.1:8080/api/replay/analyze'
    try {
      let res = await doFetch(proxyUrl, opts, true)
      if (res?.ok) {
        clearTimeout(t)
        const text = await res.text()
        try { return text ? JSON.parse(text) : null } catch { return text }
      }
      if (res.status >= 400) {
        clearTimeout(t)
        const err = await res.text()
        let msg = err
        try { const j = JSON.parse(err); msg = j?.error || j?.message || err } catch (_) {}
        throw new Error(`${res.status} ${msg}`)
      }
    } catch (e) {
      if (e?.name === 'AbortError') {
        clearTimeout(t)
        throw new Error('请求超时（3 分钟）')
      }
      // 代理失败时再试直连
      try {
        const res = await doFetch(directUrl, opts, true)
        clearTimeout(t)
        if (!res.ok) {
          const err = await res.text()
          let msg = err
          try { const j = JSON.parse(err); msg = j?.error || j?.message || err } catch (_) {}
          throw new Error(`${res.status} ${msg}`)
        }
        const text = await res.text()
        try { return text ? JSON.parse(text) : null } catch { return text }
      } catch (e2) {
        clearTimeout(t)
        throw e2
      }
    }
    clearTimeout(t)
    throw new Error('请求失败')
  },
  saveReplay: (record) =>
    request('/replay/save', {
      method: 'POST',
      body: JSON.stringify(record),
    }),
  getReplayRecords: () => request('/replay/records'),
  deleteReplayRecord: (id) =>
    request(`/replay/records/${id}`, { method: 'DELETE' }),

  // 算法题
  getAlgorithms: (company, difficulty) => {
    const params = new URLSearchParams()
    if (company) params.append('company', company)
    if (difficulty) params.append('difficulty', difficulty)
    const qs = params.toString()
    return request(`/algorithms${qs ? '?' + qs : ''}`)
  },
  getAlgorithm: (id) => request(`/algorithms/${id}`),
  createAlgorithm: (question) =>
    request('/algorithms', {
      method: 'POST',
      body: JSON.stringify(question),
    }),
  updateAlgorithm: (id, question) =>
    request(`/algorithms/${id}`, {
      method: 'PUT',
      body: JSON.stringify(question),
    }),
  deleteAlgorithm: (id) =>
    request(`/algorithms/${id}`, { method: 'DELETE' }),

  // 简历
  uploadResume: async (file) => {
    const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE
    const url = base.startsWith('http') ? `${base}/resumes/upload` : `${base}/resumes/upload`
    const fd = new FormData()
    fd.append('file', file)
    const res = await doFetch(url, { method: 'POST', headers: {}, body: fd }, true)
    if (!res.ok) {
      const err = await res.text()
      let msg = err
      try { const j = JSON.parse(err); msg = j?.error || err } catch (_) {}
      throw new Error(msg)
    }
    return res.json()
  },
  /** 带管理员密码下载简历（他人无法直接通过 URL 下载） */
  downloadResume: async (id) => {
    const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE
    const url = base.startsWith('http') ? `${base}/resumes/${id}/download` : `${window.location.origin}${base}/resumes/${id}/download`
    const p = getPassword()
    let opts = { method: 'GET', headers: p ? { 'X-Admin-Password': p } : {} }
    let res = await doFetch(url, opts, true)
    if (res.status === 403) {
      clearPassword()
      const pw = await getPasswordAsync()
      if (!pw) throw new Error('需要管理员密码')
      res = await doFetch(url, { method: 'GET', headers: { 'X-Admin-Password': pw } }, true)
      if (res.status === 403) { clearPassword(); throw new Error('密码错误，请重试') }
      if (pw) setPassword(pw)
    }
    if (!res.ok) throw new Error(res.statusText)
    const blob = await res.blob()
    const disp = res.headers.get('Content-Disposition') || ''
    const m = disp.match(/filename\*?=(?:UTF-8'')?([^;\s]+)/i)
    const name = m ? decodeURIComponent(m[1].replace(/^"|"$/g, '')) : 'resume.pdf'
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = decodeURIComponent(name)
    a.click()
    URL.revokeObjectURL(a.href)
  },
  /** 带管理员密码预览简历（他人无法直接通过 URL 预览） */
  previewResume: async (id) => {
    const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE
    const url = base.startsWith('http') ? `${base}/resumes/${id}/preview` : `${window.location.origin}${base}/resumes/${id}/preview`
    const p = getPassword()
    let opts = { method: 'GET', headers: p ? { 'X-Admin-Password': p } : {} }
    let res = await doFetch(url, opts, true)
    if (res.status === 403) {
      clearPassword()
      const pw = await getPasswordAsync()
      if (!pw) throw new Error('需要管理员密码')
      res = await doFetch(url, { method: 'GET', headers: { 'X-Admin-Password': pw } }, true)
      if (res.status === 403) { clearPassword(); throw new Error('密码错误，请重试') }
      if (pw) setPassword(pw)
    }
    if (!res.ok) throw new Error(res.statusText)
    const blob = await res.blob()
    const u = URL.createObjectURL(blob)
    window.open(u, '_blank')
  },
  parseResume: async (file) => {
    const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE
    const directUrl = 'http://127.0.0.1:8080/api/resumes/parse'
    const proxyUrl = base.startsWith('http') ? `${base}/resumes/parse` : `${base}/resumes/parse`
    const doParse = async (url) => {
      const fd = new FormData()
      fd.append('file', file)
      return doFetch(url, { method: 'POST', headers: {}, body: fd }, true)
    }
    let res
    try {
      res = await doParse(directUrl)
      if (res.ok) return res.json()
    } catch (_) {}
    try {
      res = await doParse(proxyUrl)
    } catch (_) {}
    if (!res || !res.ok) {
      let msg = res ? (res.status + ' ' + res.statusText) : '网络错误'
      try {
        const body = await res?.json?.()
        if (body?.error) msg = body.error
      } catch (_) {}
      throw new Error(msg)
    }
    return res.json()
  },
  getResumes: () => request('/resumes', {}, true),
  getResume: (id) => request(`/resumes/${id}`, {}, true),
  deleteResume: (id) =>
    request(`/resumes/${id}`, { method: 'DELETE' }),

  // 投递进度
  getApplications: () => request('/applications'),
  createApplication: async (record) => {
    const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE
    const url = base.startsWith('http') ? `${base}/applications` : `${base}/applications`
    const directUrl = 'http://127.0.0.1:8080/api/applications'
    const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) }
    const handleRes = (res) => {
      if (res.ok) return res.json()
      return res.text().then((err) => {
        let msg = err
        try { const j = JSON.parse(err); msg = j?.error || j?.message || err } catch (_) {}
        throw new Error(msg)
      })
    }
    try {
      const res = await doFetch(url, opts, true)
      return await handleRes(res)
    } catch (e) {
      try {
        const res = await doFetch(directUrl, opts, true)
        return await handleRes(res)
      } catch (e2) {
        throw e2.message ? e2 : new Error('网络错误，请确认后端已启动')
      }
    }
  },
  updateApplication: (id, record) =>
    request(`/applications/${id}`, {
      method: 'PUT',
      body: JSON.stringify(record),
    }),
  deleteApplication: (id) =>
    request(`/applications/${id}`, { method: 'DELETE' }),

  // 代码执行
  executeCode: (language, code, stdin, acmMode) =>
    request('/execute', {
      method: 'POST',
      body: JSON.stringify({ language, code, stdin, acmMode }),
    }),
}
