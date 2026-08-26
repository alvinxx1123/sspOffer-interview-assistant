// H2 → SQLite 一次性导入脚本(独立 Node 运行,不依赖 Electron)
// 前置: Spring Boot 在 :8080 运行
// 用法: node scripts/import-h2.mjs [sqlite-path]
//   sqlite-path 默认 ./sspoffer-import.db(之后手动拷到 userData)
//
// 从 Spring REST API 拉取现有数据,建表并写入。仅迁结构化数据;
// 内存向量库(InterviewEmbeddingStore)非持久化,无需迁移,首次 reindex 重建即可。

import Database from 'better-sqlite3'
import { resolve } from 'path'

const API = process.env.SPRING_API || 'http://127.0.0.1:8080/api'
const DB_PATH = resolve(process.argv[2] || './sspoffer-import.db')

async function getJSON(path) {
  const res = await fetch(`${API}${path}`)
  if (!res.ok) throw new Error(`${res.status} ${path}`)
  return res.json()
}

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

// schema(与 src/core/store/db.ts 一致)
db.exec(`
CREATE TABLE IF NOT EXISTS algorithm_questions (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL, difficulty TEXT, company TEXT, department TEXT, leetcodeProblemId INTEGER, leetcodeSlug TEXT, originalLink TEXT, source TEXT, defaultCode TEXT, testCases TEXT, createdAt TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS application_records (id INTEGER PRIMARY KEY AUTOINCREMENT, company TEXT NOT NULL, appliedAt TEXT NOT NULL, status TEXT NOT NULL, notes TEXT, createdAt TEXT NOT NULL DEFAULT (datetime('now')), updatedAt TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS internship_projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL DEFAULT '未命名项目', company TEXT, role TEXT, startDate TEXT, endDate TEXT, projectOutlineJson TEXT, sourceText TEXT, experienceText TEXT, conceptGraphJson TEXT, masteryMapJson TEXT, createdAt TEXT NOT NULL DEFAULT (datetime('now')), updatedAt TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS interview_experiences (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, company TEXT NOT NULL, department TEXT, position TEXT NOT NULL, type TEXT, content TEXT NOT NULL, internshipExperiences TEXT, internshipAnswers TEXT, projectExperiences TEXT, projectAnswers TEXT, projectExperience TEXT, baguQuestions TEXT, baguAnswers TEXT, llmQuestions TEXT, algorithmQuestions TEXT, algorithmLink TEXT, algorithmLinks TEXT, createdAt TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS user_interview_records (id INTEGER PRIMARY KEY AUTOINCREMENT, company TEXT, department TEXT, position TEXT, content TEXT NOT NULL, createdAt TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS user_resumes (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL DEFAULT '默认简历', content TEXT, fileName TEXT, fileData BLOB, contentType TEXT, createdAt TEXT NOT NULL DEFAULT (datetime('now')), updatedAt TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS interview_chat_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, sessionId TEXT NOT NULL UNIQUE, questions TEXT, resume TEXT, company TEXT, department TEXT, createdAt TEXT NOT NULL DEFAULT (datetime('now')), endedAt TEXT, overallScore INTEGER, improvementDelta INTEGER, reportJson TEXT, reportSummary TEXT);
CREATE TABLE IF NOT EXISTS interview_chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sessionId INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, sortOrder INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL DEFAULT (datetime('now')));
`)

async function migrate(name, apiPath, table, cols, map) {
  let rows
  try {
    rows = await getJSON(apiPath)
  } catch (e) {
    console.log(`  ⚠ ${name}: 拉取失败(${e.message}),跳过`)
    return 0
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log(`  · ${name}: 无数据`)
    return 0
  }
  const placeholders = cols.map(() => '?').join(',')
  const stmt = db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`)
  const tx = db.transaction((items) => {
    for (const r of items) stmt.run(...cols.map((c) => map(r, c)))
  })
  tx(rows)
  console.log(`  ✓ ${name}: ${rows.length} 条`)
  return rows.length
}

console.log(`导入到 ${DB_PATH}\n从 ${API} 拉取数据...`)
let total = 0

total += await migrate('投递记录', '/applications', 'application_records',
  ['id', 'company', 'appliedAt', 'status', 'notes', 'createdAt', 'updatedAt'],
  (r, c) => r[c] ?? null)

total += await migrate('算法题', '/algorithms', 'algorithm_questions',
  ['id', 'title', 'description', 'difficulty', 'company', 'department', 'leetcodeProblemId', 'leetcodeSlug', 'originalLink', 'source', 'defaultCode', 'testCases', 'createdAt'],
  (r, c) => r[c] ?? null)

total += await migrate('面经', '/interviews/search?company=', 'interview_experiences',
  ['id', 'source', 'company', 'department', 'position', 'type', 'content', 'internshipExperiences', 'internshipAnswers', 'projectExperiences', 'projectAnswers', 'projectExperience', 'baguQuestions', 'baguAnswers', 'llmQuestions', 'algorithmQuestions', 'algorithmLink', 'algorithmLinks', 'createdAt'],
  (r, c) => r[c] ?? null)

total += await migrate('复盘记录', '/replay/records', 'user_interview_records',
  ['id', 'company', 'department', 'position', 'content', 'createdAt'],
  (r, c) => r[c] ?? null)

total += await migrate('掌握度项目', '/mastery/projects', 'internship_projects',
  ['id', 'name', 'company', 'role', 'startDate', 'endDate', 'projectOutlineJson', 'sourceText', 'experienceText', 'conceptGraphJson', 'masteryMapJson', 'createdAt', 'updatedAt'],
  (r, c) => r[c] ?? null)

// 简历(列表不含 fileData,单独取详情)
try {
  const resumes = await getJSON('/resumes')
  for (const r of resumes) {
    let fileData = null
    try {
      const blob = await fetch(`${API}/resumes/${r.id}/download`)
      if (blob.ok) fileData = Buffer.from(await blob.arrayBuffer())
    } catch {}
    db.prepare(`INSERT OR REPLACE INTO user_resumes (id,name,content,fileName,fileData,contentType,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)`).run(r.id, r.name, r.content, r.fileName, fileData, r.contentType, r.createdAt, r.updatedAt)
  }
  console.log(`  ✓ 简历: ${resumes.length} 条`)
  total += resumes.length
} catch (e) {
  console.log(`  ⚠ 简历: 拉取失败(${e.message})`)
}

// 会话(列表)
try {
  const sessions = await getJSON('/interviews/chat-sessions')
  for (const s of sessions) {
    db.prepare(`INSERT OR REPLACE INTO interview_chat_sessions (id,sessionId,questions,resume,company,department,createdAt,endedAt,overallScore,improvementDelta,reportJson,reportSummary) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(s.id, s.sessionId, s.questions, s.resume, s.company, s.department, s.createdAt, s.endedAt, s.overallScore, s.improvementDelta, s.reportJson, s.reportSummary)
  }
  console.log(`  ✓ 会话: ${sessions.length} 条`)
  total += sessions.length
} catch (e) {
  console.log(`  ⚠ 会话: 拉取失败(${e.message})`)
}

db.close()
console.log(`\n✅ 导入完成,共 ${total} 条 → ${DB_PATH}`)
console.log('下一步: 把此文件拷到 Electron userData 目录(或启动桌面端后用其 reindex)')
