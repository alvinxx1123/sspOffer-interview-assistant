// 对标 CodeExecutionService:调 Piston 在线运行代码(外部 API,不变)

const PISTON_URL = 'https://emkc.org/api/v2/piston'

const LANG_MAP: Record<string, string> = {
  java: 'java',
  python: 'python',
  python3: 'python',
  go: 'go',
  javascript: 'javascript',
  js: 'javascript',
  cpp: 'c++',
  c: 'c',
}

export interface ExecResult {
  success: boolean
  output: string
  error?: string
}

export async function executeCodeRemote(
  language: string,
  code: string,
  stdin: string,
  acmMode: boolean
): Promise<ExecResult> {
  const lang = LANG_MAP[language.toLowerCase()]
  if (!lang) return { success: false, output: '', error: `不支持的语言: ${language}` }

  const body = {
    language: lang,
    version: '*',
    files: [{ name: 'main', content: code }],
    stdin: stdin || '',
    compile_timeout: 10000,
    run_timeout: 5000,
  }

  const res = await fetch(PISTON_URL + '/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return { success: false, output: '', error: `Piston HTTP ${res.status}` }

  const data = await res.json()
  const run = data?.run ?? {}
  const compile = data?.compile
  if (compile?.code && compile.code !== 0) {
    return { success: false, output: '', error: compile.stderr || compile.output || '编译失败' }
  }
  const out = (run.stdout || '') + (run.stderr ? `\n${run.stderr}` : '')
  if (run.code === 0) return { success: true, output: out }
  return { success: false, output: out, error: `退出码 ${run.code}` }
}
