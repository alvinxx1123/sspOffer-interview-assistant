// 把数据导入桌面端 electron-store(从 Spring REST 拉,需 Spring 跑在 :8080)
// 用法: 先启动 Spring,再 node scripts/seed-data.mjs
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const STORE_PATH = join(homedir(), 'Library', 'Application Support', 'sspOffer', 'sspoffer-data.json')
const API = process.env.SPRING_API || 'http://127.0.0.1:8080/api'

async function getJSON(path) {
  const res = await fetch(`${API}${path}`)
  if (!res.ok) throw new Error(`${res.status} ${path}`)
  return res.json()
}

async function getBinary(path) {
  const res = await fetch(`${API}${path}`)
  if (!res.ok) throw new Error(`${res.status} ${path}`)
  return new Uint8Array(await res.arrayBuffer())
}

async function main() {
  const data = {
    algorithm_questions: [], application_records: [], internship_projects: [],
    interview_experiences: [], user_interview_records: [], user_resumes: [],
    interview_chat_sessions: [], interview_chat_messages: [],
  }

  console.log(`从 ${API} 拉取数据 → ${STORE_PATH}\n`)

  // 投递记录
  try {
    const apps = await getJSON('/applications')
    apps.forEach((a) => data.application_records.push(a))
    console.log(`✓ 投递记录: ${apps.length} 条`)
  } catch (e) { console.log(`⚠ 投递记录: ${e.message}`) }

  // 算法题
  try {
    const algos = await getJSON('/algorithms')
    algos.forEach((a) => data.algorithm_questions.push(a))
    console.log(`✓ 算法题: ${algos.length} 条`)
  } catch (e) { console.log(`⚠ 算法题: ${e.message}`) }

  // 面经(逐公司搜)
  try {
    const companies = await getJSON('/interviews/companies')
    let expCount = 0
    for (const company of companies) {
      try {
        const exps = await getJSON(`/interviews/search?company=${encodeURIComponent(company)}`)
        exps.forEach((e) => data.interview_experiences.push(e))
        expCount += exps.length
      } catch {}
    }
    console.log(`✓ 面经: ${expCount} 条 (${companies.length} 公司)`)
  } catch (e) { console.log(`⚠ 面经: ${e.message}`) }

  // 复盘记录
  try {
    const records = await getJSON('/replay/records')
    records.forEach((r) => data.user_interview_records.push(r))
    console.log(`✓ 复盘记录: ${records.length} 条`)
  } catch (e) { console.log(`⚠ 复盘记录: ${e.message}`) }

  // 掌握度项目
  try {
    const projects = await getJSON('/mastery/projects')
    projects.forEach((p) => data.internship_projects.push(p))
    console.log(`✓ 掌握度项目: ${projects.length} 条`)
  } catch (e) { console.log(`⚠ 掌握度项目: ${e.message}`) }

  // 简历(含二进制)
  try {
    const resumes = await getJSON('/resumes')
    for (const r of resumes) {
      let fileData = null
      try {
        const bin = await getBinary(`/resumes/${r.id}/download`)
        fileData = Array.from(bin)
      } catch {}
      data.user_resumes.push({ ...r, fileData })
    }
    console.log(`✓ 简历: ${resumes.length} 条`)
  } catch (e) { console.log(`⚠ 简历: ${e.message}`) }

  // 会话
  try {
    const sessions = await getJSON('/interviews/chat-sessions')
    sessions.forEach((s) => data.interview_chat_sessions.push(s))
    console.log(`✓ 会话: ${sessions.length} 条`)
  } catch (e) { console.log(`⚠ 会话: ${e.message}`) }

  // 写入 electron-store 文件
  const dir = join(STORE_PATH, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(STORE_PATH, JSON.stringify(data, null, 2))
  const total = Object.values(data).reduce((s, a) => s + a.length, 0)
  console.log(`\n✅ 导入完成: 共 ${total} 条 → ${STORE_PATH}`)
  console.log('重启 sspOffer.app 后数据生效')
}

import { writeFileSync } from 'fs'
main().catch((e) => { console.error('导入失败:', e); process.exit(1) })
