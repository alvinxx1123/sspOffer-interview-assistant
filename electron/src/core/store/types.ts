// 8 个实体的 TS 类型(对标 Java entity 包)

export interface AlgorithmQuestion {
  id?: number
  title: string
  description: string
  difficulty: string | null
  company: string | null
  department: string | null
  leetcodeProblemId: number | null
  leetcodeSlug: string | null
  originalLink: string | null
  source: string | null
  defaultCode: string | null
  testCases: string | null
  createdAt: string
}

export interface ApplicationRecord {
  id?: number
  company: string
  appliedAt: string // ISO date
  status: string
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface InternshipProject {
  id?: number
  name: string
  company: string | null
  role: string | null
  startDate: string | null
  endDate: string | null
  projectOutlineJson: string | null
  sourceText: string | null
  experienceText: string | null
  conceptGraphJson: string | null
  masteryMapJson: string | null
  createdAt: string
  updatedAt: string
}

export interface InterviewExperience {
  id?: number
  source: string
  company: string
  department: string | null
  position: string
  type: string | null
  content: string
  internshipExperiences: string | null
  internshipAnswers: string | null
  projectExperiences: string | null
  projectAnswers: string | null
  projectExperience: string | null
  baguQuestions: string | null
  baguAnswers: string | null
  llmQuestions: string | null
  algorithmQuestions: string | null
  algorithmLink: string | null
  algorithmLinks: string | null
  createdAt: string
}

export interface UserInterviewRecord {
  id?: number
  company: string | null
  department: string | null
  position: string | null
  content: string
  createdAt: string
}

export interface UserResume {
  id?: number
  name: string
  content: string | null
  fileName: string | null
  fileData: Buffer | null
  contentType: string | null
  createdAt: string
  updatedAt: string
}

export interface InterviewChatSession {
  id?: number
  sessionId: string
  questions: string | null
  resume: string | null
  company: string | null
  department: string | null
  createdAt: string
  endedAt: string | null
  overallScore: number | null
  improvementDelta: number | null
  reportJson: string | null
  reportSummary: string | null
}

export interface InterviewChatMessage {
  id?: number
  sessionId: number // FK -> interview_chat_sessions.id
  role: string
  content: string
  sortOrder: number
  createdAt: string
}
