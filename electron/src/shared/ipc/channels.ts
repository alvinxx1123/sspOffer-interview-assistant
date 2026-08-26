// IPC channel 名称常量(主↔渲染共享,防拼写错误)

export const Channels = {
  // 投递记录
  APPLICATION_LIST: 'application:list',
  APPLICATION_CREATE: 'application:create',
  APPLICATION_UPDATE: 'application:update',
  APPLICATION_DELETE: 'application:delete',
  // 算法题
  ALGORITHM_LIST: 'algorithm:list',
  ALGORITHM_GET: 'algorithm:get',
  ALGORITHM_CREATE: 'algorithm:create',
  ALGORITHM_UPDATE: 'algorithm:update',
  ALGORITHM_DELETE: 'algorithm:delete',
} as const

export type Channel = (typeof Channels)[keyof typeof Channels]

// AI / RAG
export const AI_CHANNELS = {
  CHAT_WITH_TOOLS: 'ai:chat-with-tools',
  REINDEX: 'rag:reindex',
  RAG_STATS: 'rag:stats',
  CHAT_WITH_SESSION: 'ai:chat-with-session',
  CHAT_STREAM: 'ai:chat-stream',
  SESSION_STREAM: 'ai:session-stream',
  STT_TRANSCRIBE: 'stt:transcribe',
  LOG_RECENT: 'ai:log:recent',
  LOG_STATS: 'ai:log:stats',
  LOG_CLEAR: 'ai:log:clear',
} as const

// Settings
export const SETTINGS_CHANNELS = {
  GET: 'settings:models:get',
  UPDATE: 'settings:models:update',
  REINDEX: 'settings:reindex',
} as const

// 面经
export const INTERVIEW_CHANNELS = {
  COMPANIES: 'interview:companies',
  DEPARTMENTS: 'interview:departments',
  SEARCH: 'interview:search',
  ADD_EXPERIENCES: 'interview:addExperiences',
  DELETE_EXPERIENCE: 'interview:deleteExperience',
  PARSE_IMAGE: 'interview:parseImage',
  GENERATE_QUESTIONS: 'interview:generateQuestions',
  GET_EXPERIENCE: 'interview:getExperience',
} as const

// 会话
export const CHAT_SESSION_CHANNELS = {
  LIST: 'chat:list',
  GET_BY_ID: 'chat:byId',
  GET_BY_SID: 'chat:bySid',
  DELETE_BY_ID: 'chat:deleteById',
  DELETE_BY_SID: 'chat:deleteBySid',
  END: 'chat:end',
} as const

// 简历
export const RESUME_CHANNELS = {
  LIST: 'resume:list',
  GET: 'resume:get',
  DELETE: 'resume:delete',
  UPLOAD: 'resume:upload',
  DOWNLOAD: 'resume:download',
  PARSE: 'resume:parse',
} as const

// 复盘
export const REPLAY_CHANNELS = {
  RECORDS: 'replay:records',
  SAVE: 'replay:save',
  DELETE: 'replay:delete',
  ANALYZE: 'replay:analyze',
} as const

// IDE/算法(已部分接通,补 execute + leetcode-url)
export const IDE_CHANNELS = {
  EXECUTE: 'ide:execute',
} as const

// 实习经历
export const MASTERY_CHANNELS = {
  LIST: 'mastery:list',
  GET: 'mastery:get',
  CREATE: 'mastery:create',
  UPDATE_EXP: 'mastery:updateExp',
  DELETE: 'mastery:delete',
  GENERATE: 'mastery:generate',
  DIAGNOSE: 'mastery:diagnose',
} as const
