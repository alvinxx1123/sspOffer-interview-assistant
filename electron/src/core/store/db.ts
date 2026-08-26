import Store from 'electron-store'

// 纯 JS JSON 存储(对标 better-sqlite3,但无原生模块)
// 8 个实体各用一个 JSON 数组,文件落在 userData/sspoffer-data.json
// 保留 db()/initSchema()/closeDb() 接口,让上层无感切换

interface StoreSchema {
  algorithm_questions: any[]
  application_records: any[]
  internship_projects: any[]
  interview_experiences: any[]
  user_interview_records: any[]
  user_resumes: any[]
  interview_chat_sessions: any[]
  interview_chat_messages: any[]
}

let storeInstance: Store<StoreSchema> | null = null

function store(): Store<StoreSchema> {
  if (storeInstance) return storeInstance
  storeInstance = new Store<StoreSchema>({
    name: 'sspoffer-data',
    defaults: {
      algorithm_questions: [],
      application_records: [],
      internship_projects: [],
      interview_experiences: [],
      user_interview_records: [],
      user_resumes: [],
      interview_chat_sessions: [],
      interview_chat_messages: [],
    },
  })
  return storeInstance
}

/** 建表(无操作,JSON 存储无需 schema;保留接口兼容) */
export function initSchema(): void {
  store()
}

/** 关闭连接(无操作,electron-store 自动持久化) */
export function closeDb(): void {
  storeInstance = null
}

/** 通用 CRUD 帮助:对一个表做数组读写 */
export function table<K extends keyof StoreSchema>(key: K): {
  all(): StoreSchema[K]
  save(rows: StoreSchema[K]): void
  insert(row: StoreSchema[K][number]): void
  findById(id: number): StoreSchema[K][number] | null
  update(id: number, patch: Partial<StoreSchema[K][number]>): StoreSchema[K][number] | null
  remove(id: number): void
} {
  return {
    all() {
      return store().get(key) as StoreSchema[K]
    },
    save(rows) {
      store().set(key, rows)
    },
    insert(row) {
      const rows = store().get(key) as any[]
      rows.push(row)
      store().set(key, rows)
    },
    findById(id) {
      const rows = store().get(key) as any[]
      return (rows.find((r) => r.id === id) ?? null) as StoreSchema[K][number] | null
    },
    update(id, patch) {
      const rows = store().get(key) as any[]
      const idx = rows.findIndex((r) => r.id === id)
      if (idx < 0) return null
      rows[idx] = { ...rows[idx], ...patch }
      store().set(key, rows)
      return rows[idx] as StoreSchema[K][number]
    },
    remove(id) {
      const rows = store().get(key) as any[]
      store().set(key, rows.filter((r) => r.id !== id))
    },
  }
}

/** 下一个自增 ID(对标 SQLite AUTOINCREMENT) */
export function nextId(rows: any[]): number {
  if (!rows.length) return 1
  return Math.max(...rows.map((r) => r.id ?? 0)) + 1
}

/** 当前时间戳(对标 datetime('now')) */
export function now(): string {
  return new Date().toISOString()
}
