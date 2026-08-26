import { table, nextId, now } from './db'
import type {
  AlgorithmQuestion,
  ApplicationRecord,
  InternshipProject,
  InterviewExperience,
  UserInterviewRecord,
  UserResume,
  InterviewChatSession,
  InterviewChatMessage,
} from './types'

// 对标原 better-sqlite3 repo:改用 electron-store JSON 存储,接口保持一致
// core/ai/rag 层无需任何改动(它们只调 repo 方法)

// ── AlgorithmQuestion ──────────────────────────────
export const algorithmRepo = {
  findAll(): AlgorithmQuestion[] {
    return table('algorithm_questions').all() as AlgorithmQuestion[]
  },
  findById(id: number): AlgorithmQuestion | null {
    return table('algorithm_questions').findById(id) as AlgorithmQuestion | null
  },
  findByCompany(company: string): AlgorithmQuestion[] {
    return (table('algorithm_questions').all() as AlgorithmQuestion[]).filter((q) => q.company === company)
  },
  findByDifficulty(difficulty: string): AlgorithmQuestion[] {
    return (table('algorithm_questions').all() as AlgorithmQuestion[]).filter((q) => q.difficulty === difficulty)
  },
  findByLeetcodeProblemId(lid: number): AlgorithmQuestion[] {
    return (table('algorithm_questions').all() as AlgorithmQuestion[]).filter((q) => q.leetcodeProblemId === lid)
  },
  findByTitleContainingIgnoreCase(title: string): AlgorithmQuestion[] {
    const t = title.toLowerCase()
    return (table('algorithm_questions').all() as AlgorithmQuestion[]).filter((q) => (q.title ?? '').toLowerCase().includes(t))
  },
  create(q: AlgorithmQuestion): AlgorithmQuestion {
    const t = table('algorithm_questions')
    const id = nextId(t.all())
    const row = { ...q, id, createdAt: now() }
    t.insert(row)
    return row
  },
  update(id: number, q: AlgorithmQuestion): AlgorithmQuestion | null {
    return table('algorithm_questions').update(id, q) as AlgorithmQuestion | null
  },
  remove(id: number): void {
    table('algorithm_questions').remove(id)
  },
}

// ── ApplicationRecord ───────────────────────────────
export const applicationRepo = {
  findAll(): ApplicationRecord[] {
    const rows = table('application_records').all() as ApplicationRecord[]
    return rows.sort((a, b) => String(b.appliedAt).localeCompare(String(a.appliedAt)) || (b.id! - a.id!))
  },
  create(a: ApplicationRecord): ApplicationRecord {
    const t = table('application_records')
    const id = nextId(t.all())
    const row = { ...a, id, createdAt: now(), updatedAt: now() }
    t.insert(row)
    return row
  },
  update(id: number, a: ApplicationRecord): ApplicationRecord | null {
    return table('application_records').update(id, { ...a, updatedAt: now() }) as ApplicationRecord | null
  },
  remove(id: number): void {
    table('application_records').remove(id)
  },
}

// ── InternshipProject ───────────────────────────────
export const internshipProjectRepo = {
  findAll(): InternshipProject[] {
    return table('internship_projects').all() as InternshipProject[]
  },
  findById(id: number): InternshipProject | null {
    return table('internship_projects').findById(id) as InternshipProject | null
  },
  create(p: Partial<InternshipProject>): InternshipProject {
    const t = table('internship_projects')
    const id = nextId(t.all())
    const row = {
      name: '未命名项目', company: null, role: null, startDate: null, endDate: null,
      projectOutlineJson: null, sourceText: null, experienceText: null,
      conceptGraphJson: null, masteryMapJson: null,
      ...p, id, createdAt: now(), updatedAt: now(),
    } as InternshipProject
    t.insert(row)
    return row
  },
  updateExperience(id: number, experienceText: string): void {
    table('internship_projects').update(id, { experienceText, updatedAt: now() })
  },
  updateFields(id: number, fields: Partial<InternshipProject>): void {
    table('internship_projects').update(id, { ...fields, updatedAt: now() })
  },
  remove(id: number): void {
    table('internship_projects').remove(id)
  },
}

// ── InterviewExperience ─────────────────────────────
export const interviewExperienceRepo = {
  findAll(): InterviewExperience[] {
    return table('interview_experiences').all() as InterviewExperience[]
  },
  findById(id: number): InterviewExperience | null {
    return table('interview_experiences').findById(id) as InterviewExperience | null
  },
  findByCompany(company: string): InterviewExperience[] {
    return (table('interview_experiences').all() as InterviewExperience[]).filter((e) => e.company === company)
  },
  findByCompanyAndDepartment(company: string, department: string): InterviewExperience[] {
    return (table('interview_experiences').all() as InterviewExperience[]).filter((e) => e.company === company && e.department === department)
  },
  findByCompanyAndPosition(company: string, position: string): InterviewExperience[] {
    return (table('interview_experiences').all() as InterviewExperience[]).filter((e) => e.company === company && e.position === position)
  },
  findDistinctCompanies(): string[] {
    const all = table('interview_experiences').all() as InterviewExperience[]
    return [...new Set(all.map((e) => e.company))].sort()
  },
  findDistinctDepartmentsByCompany(company: string): string[] {
    const all = table('interview_experiences').all() as InterviewExperience[]
    return [...new Set(all.filter((e) => e.company === company && e.department).map((e) => e.department!))].sort()
  },
  create(e: InterviewExperience): InterviewExperience {
    const t = table('interview_experiences')
    const id = nextId(t.all())
    const row = { ...e, id, createdAt: now() }
    t.insert(row)
    return row
  },
  remove(id: number): void {
    table('interview_experiences').remove(id)
  },
}

// ── UserInterviewRecord (复盘) ──────────────────────
export const userInterviewRecordRepo = {
  findAll(): UserInterviewRecord[] {
    return table('user_interview_records').all() as UserInterviewRecord[]
  },
  findByCompany(company: string): UserInterviewRecord[] {
    return (table('user_interview_records').all() as UserInterviewRecord[]).filter((r) => r.company === company)
  },
  create(r: UserInterviewRecord): UserInterviewRecord {
    const t = table('user_interview_records')
    const id = nextId(t.all())
    const row = { ...r, id, createdAt: now() }
    t.insert(row)
    return row
  },
  remove(id: number): void {
    table('user_interview_records').remove(id)
  },
}

// ── UserResume ──────────────────────────────────────
export const userResumeRepo = {
  findAll(): UserResume[] {
    // 列表不返回 fileData(避免大字段占内存)
    const all = table('user_resumes').all() as UserResume[]
    return all.map((r) => ({ ...r, fileData: null }))
  },
  findById(id: number): UserResume | null {
    return table('user_resumes').findById(id) as UserResume | null
  },
  create(r: Partial<UserResume>): UserResume {
    const t = table('user_resumes')
    const id = nextId(t.all())
    const row = { name: '默认简历', content: null, fileName: null, fileData: null, contentType: null, ...r, id, createdAt: now(), updatedAt: now() } as UserResume
    t.insert(row)
    return row
  },
  remove(id: number): void {
    table('user_resumes').remove(id)
  },
}

// ── InterviewChatSession + Messages ─────────────────
export const chatSessionRepo = {
  findAll(): InterviewChatSession[] {
    return table('interview_chat_sessions').all() as InterviewChatSession[]
  },
  findById(id: number): InterviewChatSession | null {
    return table('interview_chat_sessions').findById(id) as InterviewChatSession | null
  },
  findBySessionId(sessionId: string): InterviewChatSession | null {
    const all = table('interview_chat_sessions').all() as InterviewChatSession[]
    return all.find((s) => s.sessionId === sessionId) ?? null
  },
  create(s: Partial<InterviewChatSession>): InterviewChatSession {
    const t = table('interview_chat_sessions')
    const id = nextId(t.all())
    const row = { sessionId: '', questions: null, resume: null, company: null, department: null, ...s, id, createdAt: now() } as InterviewChatSession
    t.insert(row)
    return row
  },
  endSession(id: number, fields: Partial<InterviewChatSession>): void {
    table('interview_chat_sessions').update(id, { ...fields, endedAt: now() })
  },
  remove(id: number): void {
    table('interview_chat_sessions').remove(id)
    // 级联删 messages
    const t = table('interview_chat_messages')
    const rest = (t.all() as InterviewChatMessage[]).filter((m) => m.sessionId !== id)
    t.save(rest)
  },
  findMessages(sessionId: number): InterviewChatMessage[] {
    return (table('interview_chat_messages').all() as InterviewChatMessage[])
      .filter((m) => m.sessionId === sessionId)
      .sort((a, b) => a.sortOrder - b.sortOrder || (a.id! - b.id!))
  },
  addMessage(m: Partial<InterviewChatMessage>): InterviewChatMessage {
    const t = table('interview_chat_messages')
    const id = nextId(t.all())
    const row = { role: 'user', content: '', sortOrder: 0, ...m, id, createdAt: now() } as InterviewChatMessage
    t.insert(row)
    return row
  },
}
