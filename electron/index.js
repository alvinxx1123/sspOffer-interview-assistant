import { app, session, ipcMain, BrowserWindow, shell } from "electron";
import { join } from "path";
import Store from "electron-store";
import { SystemMessage, HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { tool } from "@langchain/core/tools";
import { Buffer as Buffer$1 } from "node:buffer";
const is = {
  dev: !app.isPackaged
};
const platform = {
  isWindows: process.platform === "win32",
  isMacOS: process.platform === "darwin",
  isLinux: process.platform === "linux"
};
const electronApp = {
  setAppUserModelId(id) {
    if (platform.isWindows)
      app.setAppUserModelId(is.dev ? process.execPath : id);
  },
  setAutoLaunch(auto) {
    if (platform.isLinux)
      return false;
    const isOpenAtLogin = () => {
      return app.getLoginItemSettings().openAtLogin;
    };
    if (isOpenAtLogin() !== auto) {
      app.setLoginItemSettings({
        openAtLogin: auto,
        path: process.execPath
      });
      return isOpenAtLogin() === auto;
    } else {
      return true;
    }
  },
  skipProxy() {
    return session.defaultSession.setProxy({ mode: "direct" });
  }
};
const optimizer = {
  watchWindowShortcuts(window, shortcutOptions) {
    if (!window)
      return;
    const { webContents } = window;
    const { escToCloseWindow = false, zoom = false } = shortcutOptions || {};
    webContents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown") {
        if (!is.dev) {
          if (input.code === "KeyR" && (input.control || input.meta))
            event.preventDefault();
        } else {
          if (input.code === "F12") {
            if (webContents.isDevToolsOpened()) {
              webContents.closeDevTools();
            } else {
              webContents.openDevTools({ mode: "undocked" });
              console.log("Open dev tool...");
            }
          }
        }
        if (escToCloseWindow) {
          if (input.code === "Escape" && input.key !== "Process") {
            window.close();
            event.preventDefault();
          }
        }
        if (!zoom) {
          if (input.code === "Minus" && (input.control || input.meta))
            event.preventDefault();
          if (input.code === "Equal" && input.shift && (input.control || input.meta))
            event.preventDefault();
        }
      }
    });
  },
  registerFramelessWindowIpc() {
    ipcMain.on("win:invoke", (event, action) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) {
        if (action === "show") {
          win.show();
        } else if (action === "showInactive") {
          win.showInactive();
        } else if (action === "min") {
          win.minimize();
        } else if (action === "max") {
          const isMaximized = win.isMaximized();
          if (isMaximized) {
            win.unmaximize();
          } else {
            win.maximize();
          }
        } else if (action === "close") {
          win.close();
        }
      }
    });
  }
};
const Channels = {
  // 投递记录
  APPLICATION_LIST: "application:list",
  APPLICATION_CREATE: "application:create",
  APPLICATION_UPDATE: "application:update",
  APPLICATION_DELETE: "application:delete",
  // 算法题
  ALGORITHM_LIST: "algorithm:list",
  ALGORITHM_GET: "algorithm:get",
  ALGORITHM_CREATE: "algorithm:create",
  ALGORITHM_UPDATE: "algorithm:update",
  ALGORITHM_DELETE: "algorithm:delete"
};
const AI_CHANNELS = {
  CHAT_WITH_TOOLS: "ai:chat-with-tools",
  REINDEX: "rag:reindex",
  RAG_STATS: "rag:stats",
  CHAT_WITH_SESSION: "ai:chat-with-session",
  CHAT_STREAM: "ai:chat-stream",
  SESSION_STREAM: "ai:session-stream",
  STT_TRANSCRIBE: "stt:transcribe",
  LOG_RECENT: "ai:log:recent",
  LOG_STATS: "ai:log:stats",
  LOG_CLEAR: "ai:log:clear"
};
const SETTINGS_CHANNELS = {
  GET: "settings:models:get",
  UPDATE: "settings:models:update",
  REINDEX: "settings:reindex"
};
const INTERVIEW_CHANNELS = {
  COMPANIES: "interview:companies",
  DEPARTMENTS: "interview:departments",
  SEARCH: "interview:search",
  ADD_EXPERIENCES: "interview:addExperiences",
  DELETE_EXPERIENCE: "interview:deleteExperience",
  PARSE_IMAGE: "interview:parseImage",
  GENERATE_QUESTIONS: "interview:generateQuestions",
  GET_EXPERIENCE: "interview:getExperience"
};
const CHAT_SESSION_CHANNELS = {
  LIST: "chat:list",
  GET_BY_ID: "chat:byId",
  GET_BY_SID: "chat:bySid",
  DELETE_BY_ID: "chat:deleteById",
  DELETE_BY_SID: "chat:deleteBySid",
  END: "chat:end"
};
const RESUME_CHANNELS = {
  LIST: "resume:list",
  GET: "resume:get",
  DELETE: "resume:delete",
  UPLOAD: "resume:upload",
  DOWNLOAD: "resume:download",
  PARSE: "resume:parse"
};
const REPLAY_CHANNELS = {
  RECORDS: "replay:records",
  SAVE: "replay:save",
  DELETE: "replay:delete",
  ANALYZE: "replay:analyze"
};
const IDE_CHANNELS = {
  EXECUTE: "ide:execute"
};
const MASTERY_CHANNELS = {
  LIST: "mastery:list",
  GET: "mastery:get",
  CREATE: "mastery:create",
  UPDATE_EXP: "mastery:updateExp",
  DELETE: "mastery:delete",
  GENERATE: "mastery:generate",
  DIAGNOSE: "mastery:diagnose"
};
let storeInstance = null;
function store() {
  if (storeInstance) return storeInstance;
  storeInstance = new Store({
    name: "sspoffer-data",
    defaults: {
      algorithm_questions: [],
      application_records: [],
      internship_projects: [],
      interview_experiences: [],
      user_interview_records: [],
      user_resumes: [],
      interview_chat_sessions: [],
      interview_chat_messages: []
    }
  });
  return storeInstance;
}
function initSchema() {
  store();
}
function closeDb() {
  storeInstance = null;
}
function table(key) {
  return {
    all() {
      return store().get(key);
    },
    save(rows) {
      store().set(key, rows);
    },
    insert(row) {
      const rows = store().get(key);
      rows.push(row);
      store().set(key, rows);
    },
    findById(id) {
      const rows = store().get(key);
      return rows.find((r) => r.id === id) ?? null;
    },
    update(id, patch) {
      const rows = store().get(key);
      const idx = rows.findIndex((r) => r.id === id);
      if (idx < 0) return null;
      rows[idx] = { ...rows[idx], ...patch };
      store().set(key, rows);
      return rows[idx];
    },
    remove(id) {
      const rows = store().get(key);
      store().set(key, rows.filter((r) => r.id !== id));
    }
  };
}
function nextId(rows) {
  if (!rows.length) return 1;
  return Math.max(...rows.map((r) => r.id ?? 0)) + 1;
}
function now() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
const algorithmRepo = {
  findAll() {
    return table("algorithm_questions").all();
  },
  findById(id) {
    return table("algorithm_questions").findById(id);
  },
  findByCompany(company) {
    return table("algorithm_questions").all().filter((q) => q.company === company);
  },
  findByDifficulty(difficulty) {
    return table("algorithm_questions").all().filter((q) => q.difficulty === difficulty);
  },
  findByLeetcodeProblemId(lid) {
    return table("algorithm_questions").all().filter((q) => q.leetcodeProblemId === lid);
  },
  findByTitleContainingIgnoreCase(title) {
    const t = title.toLowerCase();
    return table("algorithm_questions").all().filter((q) => (q.title ?? "").toLowerCase().includes(t));
  },
  create(q) {
    const t = table("algorithm_questions");
    const id = nextId(t.all());
    const row = { ...q, id, createdAt: now() };
    t.insert(row);
    return row;
  },
  update(id, q) {
    return table("algorithm_questions").update(id, q);
  },
  remove(id) {
    table("algorithm_questions").remove(id);
  }
};
const applicationRepo = {
  findAll() {
    const rows = table("application_records").all();
    return rows.sort((a, b) => String(b.appliedAt).localeCompare(String(a.appliedAt)) || b.id - a.id);
  },
  create(a) {
    const t = table("application_records");
    const id = nextId(t.all());
    const row = { ...a, id, createdAt: now(), updatedAt: now() };
    t.insert(row);
    return row;
  },
  update(id, a) {
    return table("application_records").update(id, { ...a, updatedAt: now() });
  },
  remove(id) {
    table("application_records").remove(id);
  }
};
const internshipProjectRepo = {
  findAll() {
    return table("internship_projects").all();
  },
  findById(id) {
    return table("internship_projects").findById(id);
  },
  create(p) {
    const t = table("internship_projects");
    const id = nextId(t.all());
    const row = {
      name: "未命名项目",
      company: null,
      role: null,
      startDate: null,
      endDate: null,
      projectOutlineJson: null,
      sourceText: null,
      experienceText: null,
      conceptGraphJson: null,
      masteryMapJson: null,
      ...p,
      id,
      createdAt: now(),
      updatedAt: now()
    };
    t.insert(row);
    return row;
  },
  updateExperience(id, experienceText) {
    table("internship_projects").update(id, { experienceText, updatedAt: now() });
  },
  updateFields(id, fields) {
    table("internship_projects").update(id, { ...fields, updatedAt: now() });
  },
  remove(id) {
    table("internship_projects").remove(id);
  }
};
const interviewExperienceRepo = {
  findAll() {
    return table("interview_experiences").all();
  },
  findById(id) {
    return table("interview_experiences").findById(id);
  },
  findByCompany(company) {
    return table("interview_experiences").all().filter((e) => e.company === company);
  },
  findByCompanyAndDepartment(company, department) {
    return table("interview_experiences").all().filter((e) => e.company === company && e.department === department);
  },
  findByCompanyAndPosition(company, position) {
    return table("interview_experiences").all().filter((e) => e.company === company && e.position === position);
  },
  findDistinctCompanies() {
    const all = table("interview_experiences").all();
    return [...new Set(all.map((e) => e.company))].sort();
  },
  findDistinctDepartmentsByCompany(company) {
    const all = table("interview_experiences").all();
    return [...new Set(all.filter((e) => e.company === company && e.department).map((e) => e.department))].sort();
  },
  create(e) {
    const t = table("interview_experiences");
    const id = nextId(t.all());
    const row = { ...e, id, createdAt: now() };
    t.insert(row);
    return row;
  },
  remove(id) {
    table("interview_experiences").remove(id);
  }
};
const userInterviewRecordRepo = {
  findAll() {
    return table("user_interview_records").all();
  },
  findByCompany(company) {
    return table("user_interview_records").all().filter((r) => r.company === company);
  },
  create(r) {
    const t = table("user_interview_records");
    const id = nextId(t.all());
    const row = { ...r, id, createdAt: now() };
    t.insert(row);
    return row;
  },
  remove(id) {
    table("user_interview_records").remove(id);
  }
};
const userResumeRepo = {
  findAll() {
    const all = table("user_resumes").all();
    return all.map((r) => ({ ...r, fileData: null }));
  },
  findById(id) {
    return table("user_resumes").findById(id);
  },
  create(r) {
    const t = table("user_resumes");
    const id = nextId(t.all());
    const row = { name: "默认简历", content: null, fileName: null, fileData: null, contentType: null, ...r, id, createdAt: now(), updatedAt: now() };
    t.insert(row);
    return row;
  },
  remove(id) {
    table("user_resumes").remove(id);
  }
};
const chatSessionRepo = {
  findAll() {
    return table("interview_chat_sessions").all();
  },
  findById(id) {
    return table("interview_chat_sessions").findById(id);
  },
  findBySessionId(sessionId) {
    const all = table("interview_chat_sessions").all();
    return all.find((s) => s.sessionId === sessionId) ?? null;
  },
  create(s) {
    const t = table("interview_chat_sessions");
    const id = nextId(t.all());
    const row = { sessionId: "", questions: null, resume: null, company: null, department: null, ...s, id, createdAt: now() };
    t.insert(row);
    return row;
  },
  endSession(id, fields) {
    table("interview_chat_sessions").update(id, { ...fields, endedAt: now() });
  },
  remove(id) {
    table("interview_chat_sessions").remove(id);
    const t = table("interview_chat_messages");
    const rest = t.all().filter((m) => m.sessionId !== id);
    t.save(rest);
  },
  findMessages(sessionId) {
    return table("interview_chat_messages").all().filter((m) => m.sessionId === sessionId).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  },
  addMessage(m) {
    const t = table("interview_chat_messages");
    const id = nextId(t.all());
    const row = { role: "user", content: "", sortOrder: 0, ...m, id, createdAt: now() };
    t.insert(row);
    return row;
  }
};
const DEFAULT_LLM_BASE_URL = "https://api.deepseek.com";
const DEFAULT_EMBEDDING_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const DEFAULT_LLM_MODEL = "deepseek-chat";
const DEFAULT_EMBEDDING_MODEL = "embedding-3";
const DEFAULT_VISION_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_VISION_MODEL = "";
class ApiConfigHolder {
  cfg = {
    llmApiKey: "",
    llmBaseUrl: DEFAULT_LLM_BASE_URL,
    llmModel: DEFAULT_LLM_MODEL,
    embeddingApiKey: "",
    embeddingBaseUrl: DEFAULT_EMBEDDING_BASE_URL,
    embeddingModel: DEFAULT_EMBEDDING_MODEL,
    visionApiKey: "",
    visionBaseUrl: DEFAULT_VISION_BASE_URL,
    visionModel: DEFAULT_VISION_MODEL,
    sttEngine: "webspeech",
    sttApiKey: "",
    sttBaseUrl: "",
    sttModel: "whisper-1"
  };
  constructor() {
    this.load();
  }
  configPath() {
    return join(app.getPath("userData"), "model-config.json");
  }
  load() {
    let loaded = false;
    const path = this.configPath();
    if (existsSync(path)) {
      try {
        const data = JSON.parse(readFileSync(path, "utf-8"));
        this.cfg = { ...this.cfg, ...data };
        loaded = true;
      } catch (e) {
        console.warn("读取 model-config.json 失败,回退默认:", e);
      }
    }
    if (!loaded) {
      this.cfg.llmApiKey = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || "";
      this.cfg.llmBaseUrl = this.cfg.llmBaseUrl || DEFAULT_LLM_BASE_URL;
      this.cfg.llmModel = this.cfg.llmModel || DEFAULT_LLM_MODEL;
      this.cfg.embeddingApiKey = process.env.EMBEDDING_API_KEY || process.env.ZHIPU_API_KEY || "";
      this.cfg.embeddingBaseUrl = this.cfg.embeddingBaseUrl || DEFAULT_EMBEDDING_BASE_URL;
      this.cfg.embeddingModel = this.cfg.embeddingModel || DEFAULT_EMBEDDING_MODEL;
      this.cfg.visionApiKey = process.env.VISION_API_KEY || "";
      this.cfg.visionBaseUrl = this.cfg.visionBaseUrl || DEFAULT_VISION_BASE_URL;
      this.cfg.visionModel = this.cfg.visionModel || DEFAULT_VISION_MODEL;
    }
  }
  persist() {
    try {
      const dir = app.getPath("userData");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.configPath(), JSON.stringify(this.cfg, null, 2));
    } catch (e) {
      console.warn("持久化 model-config.json 失败:", e);
    }
  }
  updateLlm(apiKey, baseUrl, model) {
    let changed = false;
    if (apiKey && apiKey.trim()) {
      this.cfg.llmApiKey = apiKey.trim();
      changed = true;
    }
    if (baseUrl && baseUrl.trim()) {
      this.cfg.llmBaseUrl = baseUrl.trim();
      changed = true;
    }
    if (model && model.trim()) {
      this.cfg.llmModel = model.trim();
      changed = true;
    }
    if (changed) this.persist();
  }
  updateEmbedding(apiKey, baseUrl, model) {
    let changed = false;
    if (apiKey && apiKey.trim()) {
      this.cfg.embeddingApiKey = apiKey.trim();
      changed = true;
    }
    if (baseUrl && baseUrl.trim()) {
      this.cfg.embeddingBaseUrl = baseUrl.trim();
      changed = true;
    }
    if (model && model.trim()) {
      this.cfg.embeddingModel = model.trim();
      changed = true;
    }
    if (changed) this.persist();
  }
  updateVision(apiKey, baseUrl, model) {
    let changed = false;
    if (apiKey && apiKey.trim()) {
      this.cfg.visionApiKey = apiKey.trim();
      changed = true;
    }
    if (baseUrl && baseUrl.trim()) {
      this.cfg.visionBaseUrl = baseUrl.trim();
      changed = true;
    }
    if (model && model.trim()) {
      this.cfg.visionModel = model.trim();
      changed = true;
    }
    if (changed) this.persist();
  }
  updateStt(engine, apiKey, baseUrl, model) {
    let changed = false;
    if (engine && (engine === "webspeech" || engine === "whisper")) {
      this.cfg.sttEngine = engine;
      changed = true;
    }
    if (apiKey !== void 0) {
      this.cfg.sttApiKey = (apiKey || "").trim();
      changed = true;
    }
    if (baseUrl !== void 0) {
      this.cfg.sttBaseUrl = (baseUrl || "").trim();
      changed = true;
    }
    if (model && model.trim()) {
      this.cfg.sttModel = model.trim();
      changed = true;
    }
    if (changed) this.persist();
  }
  get llmApiKey() {
    return this.cfg.llmApiKey;
  }
  get llmBaseUrl() {
    return this.cfg.llmBaseUrl || DEFAULT_LLM_BASE_URL;
  }
  get llmModel() {
    return this.cfg.llmModel || DEFAULT_LLM_MODEL;
  }
  get embeddingApiKey() {
    return this.cfg.embeddingApiKey;
  }
  get embeddingBaseUrl() {
    return this.cfg.embeddingBaseUrl || DEFAULT_EMBEDDING_BASE_URL;
  }
  get embeddingModel() {
    return this.cfg.embeddingModel || DEFAULT_EMBEDDING_MODEL;
  }
  get visionApiKey() {
    return this.cfg.visionApiKey;
  }
  get visionBaseUrl() {
    return this.cfg.visionBaseUrl || DEFAULT_VISION_BASE_URL;
  }
  get visionModel() {
    return this.cfg.visionModel || DEFAULT_VISION_MODEL;
  }
  get sttEngine() {
    return this.cfg.sttEngine || "webspeech";
  }
  get sttApiKey() {
    return this.cfg.sttApiKey.trim() || this.cfg.llmApiKey.trim();
  }
  get sttBaseUrl() {
    return this.cfg.sttBaseUrl.trim() || this.cfg.llmBaseUrl.trim() || "https://api.openai.com/v1";
  }
  get sttModel() {
    return this.cfg.sttModel.trim() || "whisper-1";
  }
  isSttConfigured() {
    if (this.cfg.sttEngine === "webspeech") return true;
    return !!this.sttApiKey;
  }
  isLlmConfigured() {
    return !!this.cfg.llmApiKey && !!this.cfg.llmApiKey.trim();
  }
  isEmbeddingConfigured() {
    return !!this.cfg.embeddingApiKey && !!this.cfg.embeddingApiKey.trim();
  }
  isVisionConfigured() {
    return !!this.cfg.visionApiKey && !!this.cfg.visionApiKey.trim();
  }
  snapshot() {
    return { ...this.cfg };
  }
}
const apiConfig = new ApiConfigHolder();
let chatModel = null;
let cachedKey = "";
function getChatModel() {
  const key = `${apiConfig.llmApiKey}:${apiConfig.llmBaseUrl}:${apiConfig.llmModel}`;
  if (chatModel && cachedKey === key) return chatModel;
  chatModel = new ChatOpenAI({
    apiKey: apiConfig.llmApiKey,
    configuration: { baseURL: apiConfig.llmBaseUrl },
    modelName: apiConfig.llmModel,
    temperature: 0.7,
    maxTokens: 8192
  }, { baseOptions: { headers: { Authorization: `Bearer ${apiConfig.llmApiKey}` } } });
  cachedKey = key;
  return chatModel;
}
async function chat(systemPrompt, userMessage) {
  if (!apiConfig.isLlmConfigured()) {
    throw new Error("LLM API Key 未配置。请在前端「设置」页填入,或设置环境变量 LLM_API_KEY。");
  }
  const model = getChatModel();
  const res = await model.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage }
  ]);
  return typeof res.content === "string" ? res.content : JSON.stringify(res.content);
}
async function* chatStream(systemPrompt, userMessage) {
  if (!apiConfig.isLlmConfigured()) {
    throw new Error("LLM API Key 未配置。请在前端「设置」页填入。");
  }
  const model = getChatModel();
  const stream = await model.stream([
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage }
  ]);
  for await (const chunk of stream) {
    const text = typeof chunk.content === "string" ? chunk.content : "";
    if (text) yield text;
  }
}
const MAX_ENTRIES = 500;
const buffer = [];
let runCounter = 0;
function nextRunId() {
  runCounter += 1;
  return `run-${Date.now()}-${runCounter}`;
}
function newRunId() {
  return nextRunId();
}
function log(runId, type, data = {}) {
  buffer.push({ ts: Date.now(), runId, type, data });
  if (buffer.length > MAX_ENTRIES) buffer.shift();
}
function getRecentEntries(limit = 100) {
  return buffer.slice(-limit);
}
function clearEntries() {
  buffer.length = 0;
}
function getStats() {
  let toolCalls = 0;
  let errors = 0;
  const runs = /* @__PURE__ */ new Set();
  for (const e of buffer) {
    if (e.type === "tool_call") toolCalls++;
    if (e.type === "error") errors++;
    if (e.runId) runs.add(e.runId);
  }
  return { totalRuns: runs.size, totalToolCalls: toolCalls, totalErrors: errors };
}
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 3);
}
function estimateMessagesTokens(messages) {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content ?? ""), 0);
}
function trimContext(messages, opts) {
  if (messages.length <= 2) return messages;
  const system = messages[0];
  const rest = messages.slice(1);
  let kept = [...rest];
  while (kept.length > opts.maxMessages || estimateMessagesTokens(kept) > opts.maxTokens) {
    if (kept.length <= 2) break;
    kept = kept.slice(2);
  }
  return [system, ...kept];
}
function finalFormatting(text) {
  if (!text) return "";
  return text.replace(/ {2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
function fixMalformedLinks(text) {
  return text.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi, "[$2]($1)");
}
class AgentHarness {
  runId;
  cfg;
  constructor(config2) {
    this.runId = newRunId();
    this.cfg = {
      systemPrompt: config2.systemPrompt,
      tools: config2.tools ?? [],
      maxIterations: config2.maxIterations ?? 6,
      maxContextTokens: config2.maxContextTokens ?? 6e3,
      maxHistoryMessages: config2.maxHistoryMessages ?? 20,
      toolRetries: config2.toolRetries ?? 1,
      temperature: config2.temperature ?? 0.7
    };
  }
  /** 流式运行：yield HarnessEvent，最终 done 携带完整文本 */
  async *stream(userMessage, history = []) {
    const model = getChatModel();
    const tools = this.cfg.tools;
    const bound = tools.length ? model.bindTools(tools) : model;
    const messages = [new SystemMessage(this.cfg.systemPrompt)];
    for (const t of history) {
      if (t.role === "user") messages.push(new HumanMessage(t.content));
      else messages.push(new AIMessage(t.content));
    }
    messages.push(new HumanMessage(userMessage));
    log(this.runId, "start", { toolsCount: tools.length, historyLen: history.length });
    let finalText = "";
    for (let i = 0; i < this.cfg.maxIterations; i++) {
      log(this.runId, "iteration", { iteration: i });
      yield { type: "iteration", data: { iteration: i } };
      const trimmed = trimContext(messages, {
        maxTokens: this.cfg.maxContextTokens,
        maxMessages: this.cfg.maxHistoryMessages
      });
      if (trimmed.length < messages.length) messages.splice(1, messages.length - trimmed.length, ...trimmed.slice(1));
      let accContent = "";
      let accToolCalls = [];
      try {
        const stream = await bound.stream(messages);
        for await (const chunk of stream) {
          const text = typeof chunk.content === "string" ? chunk.content : "";
          if (text) {
            accContent += text;
            yield { type: "delta", data: { text } };
          }
          const tc = chunk.tool_call_chunks ?? chunk.additional_kwargs?.tool_calls;
          if (tc) accToolCalls = accToolCalls.concat(tc);
        }
      } catch (e) {
        log(this.runId, "error", { phase: "stream", error: e?.message });
        yield { type: "error", data: { message: e?.message ?? "模型调用失败" } };
        finalText = "抱歉，模型调用出错，请重试。";
        break;
      }
      const aiMsg = new AIMessage(accContent);
      aiMsg.tool_calls = accToolCalls;
      messages.push(aiMsg);
      if (!accToolCalls.length) {
        finalText = fixMalformedLinks(finalFormatting(accContent));
        break;
      }
      for (const call of accToolCalls) {
        const name = call.name ?? call.function?.name;
        const args = call.args ?? (call.function?.arguments ? safeParse$2(call.function.arguments) : {});
        log(this.runId, "tool_call", { name, args });
        yield { type: "tool_call", data: { name, args, iteration: i } };
        const matched = tools.find((t) => t.name === name);
        if (!matched) {
          const msg = `工具 ${name} 不存在`;
          log(this.runId, "tool_result", { name, error: msg });
          messages.push(new ToolMessage({ tool_call_id: call.id ?? "", content: msg }));
          yield { type: "tool_result", data: { name, error: msg } };
          continue;
        }
        let resultText = "";
        let lastErr = "";
        for (let attempt = 0; attempt <= this.cfg.toolRetries; attempt++) {
          try {
            const result = await matched.invoke(args);
            resultText = typeof result === "string" ? result : result?.content ?? JSON.stringify(result);
            lastErr = "";
            break;
          } catch (e) {
            lastErr = e?.message ?? String(e);
            log(this.runId, "tool_result", { name, attempt, error: lastErr });
            if (attempt >= this.cfg.toolRetries) break;
          }
        }
        if (lastErr) {
          const recovery = `工具 ${name} 执行失败: ${lastErr}。请检查参数或改用其他方式回答。`;
          messages.push(new ToolMessage({ tool_call_id: call.id ?? "", content: recovery }));
          yield { type: "tool_result", data: { name, error: lastErr } };
        } else {
          messages.push(new ToolMessage({ tool_call_id: call.id ?? "", content: resultText }));
          yield { type: "tool_result", data: { name, result: resultText.slice(0, 200) } };
        }
      }
    }
    if (!finalText) {
      try {
        const res = await model.invoke(messages);
        finalText = fixMalformedLinks(finalFormatting(typeof res.content === "string" ? res.content : JSON.stringify(res.content)));
      } catch {
        finalText = "抱歉，处理超时，请重试。";
      }
    }
    log(this.runId, "done", { length: finalText.length });
    yield { type: "done", data: { text: finalText } };
  }
  /** 非流式运行：返回完整文本 */
  async run(userMessage, history = []) {
    let text = "";
    for await (const ev of this.stream(userMessage, history)) {
      if (ev.type === "done") text = ev.data.text ?? "";
      if (ev.type === "error") text = ev.data.message;
    }
    return text;
  }
}
function safeParse$2(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
var _a$1;
function $constructor(name, initializer2, params) {
  function init(inst, def) {
    if (!inst._zod) {
      Object.defineProperty(inst, "_zod", {
        value: {
          def,
          constr: _,
          traits: /* @__PURE__ */ new Set()
        },
        enumerable: false
      });
    }
    if (inst._zod.traits.has(name)) {
      return;
    }
    inst._zod.traits.add(name);
    initializer2(inst, def);
    const proto = _.prototype;
    const keys = Object.keys(proto);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (!(k in inst)) {
        inst[k] = proto[k].bind(inst);
      }
    }
  }
  const Parent = params?.Parent ?? Object;
  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    var _a2;
    const inst = params?.Parent ? new Definition() : this;
    init(inst, def);
    (_a2 = inst._zod).deferred ?? (_a2.deferred = []);
    for (const fn of inst._zod.deferred) {
      fn();
    }
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
class $ZodAsyncError extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
}
class $ZodEncodeError extends Error {
  constructor(name) {
    super(`Encountered unidirectional transform during encode: ${name}`);
    this.name = "ZodEncodeError";
  }
}
(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
const globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
  return globalConfig;
}
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
function cached(getter) {
  return {
    get value() {
      {
        const value = getter();
        Object.defineProperty(this, "value", { value });
        return value;
      }
    }
  };
}
function nullish(input) {
  return input === null || input === void 0;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
  const ratio = val / step;
  const roundedRatio = Math.round(ratio);
  const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1);
  if (Math.abs(ratio - roundedRatio) < tolerance)
    return 0;
  return ratio - roundedRatio;
}
const EVALUATING = /* @__PURE__ */ Symbol("evaluating");
function defineLazy(object2, key, getter) {
  let value = void 0;
  Object.defineProperty(object2, key, {
    get() {
      if (value === EVALUATING) {
        return void 0;
      }
      if (value === void 0) {
        value = EVALUATING;
        value = getter();
      }
      return value;
    },
    set(v) {
      Object.defineProperty(object2, key, {
        value: v
        // configurable: true,
      });
    },
    configurable: true
  });
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function mergeDefs(...defs) {
  const mergedDescriptors = {};
  for (const def of defs) {
    const descriptors = Object.getOwnPropertyDescriptors(def);
    Object.assign(mergedDescriptors, descriptors);
  }
  return Object.defineProperties({}, mergedDescriptors);
}
function esc(str) {
  return JSON.stringify(str);
}
function slugify(input) {
  return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
const captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {
};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
const allowsEval = /* @__PURE__ */ cached(() => {
  if (globalConfig.jitless) {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
    return false;
  }
  try {
    const F = Function;
    new F("");
    return true;
  } catch (_) {
    return false;
  }
});
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === void 0)
    return true;
  if (typeof ctor !== "function")
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
function shallowClone(o) {
  if (isPlainObject(o))
    return { ...o };
  if (Array.isArray(o))
    return [...o];
  if (o instanceof Map)
    return new Map(o);
  if (o instanceof Set)
    return new Set(o);
  return o;
}
const propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== void 0) {
    if (params?.error !== void 0)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
  });
}
const NUMBER_FORMAT_RANGES = {
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-34028234663852886e22, 34028234663852886e22],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
function pick(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".pick() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const newShape = {};
      for (const key in mask) {
        if (!(key in currDef.shape)) {
          throw new Error(`Unrecognized key: "${key}"`);
        }
        if (!mask[key])
          continue;
        newShape[key] = currDef.shape[key];
      }
      assignProp(this, "shape", newShape);
      return newShape;
    },
    checks: []
  });
  return clone(schema, def);
}
function omit(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".omit() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const newShape = { ...schema._zod.def.shape };
      for (const key in mask) {
        if (!(key in currDef.shape)) {
          throw new Error(`Unrecognized key: "${key}"`);
        }
        if (!mask[key])
          continue;
        delete newShape[key];
      }
      assignProp(this, "shape", newShape);
      return newShape;
    },
    checks: []
  });
  return clone(schema, def);
}
function extend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const checks = schema._zod.def.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    const existingShape = schema._zod.def.shape;
    for (const key in shape) {
      if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) {
        throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
      }
    }
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const _shape = { ...schema._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    }
  });
  return clone(schema, def);
}
function safeExtend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to safeExtend: expected a plain object");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const _shape = { ...schema._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    }
  });
  return clone(schema, def);
}
function merge(a, b) {
  if (a._zod.def.checks?.length) {
    throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
  }
  const def = mergeDefs(a._zod.def, {
    get shape() {
      const _shape = { ...a._zod.def.shape, ...b._zod.def.shape };
      assignProp(this, "shape", _shape);
      return _shape;
    },
    get catchall() {
      return b._zod.def.catchall;
    },
    checks: b._zod.def.checks ?? []
  });
  return clone(a, def);
}
function partial(Class, schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".partial() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const oldShape = schema._zod.def.shape;
      const shape = { ...oldShape };
      if (mask) {
        for (const key in mask) {
          if (!(key in oldShape)) {
            throw new Error(`Unrecognized key: "${key}"`);
          }
          if (!mask[key])
            continue;
          shape[key] = Class ? new Class({
            type: "optional",
            innerType: oldShape[key]
          }) : oldShape[key];
        }
      } else {
        for (const key in oldShape) {
          shape[key] = Class ? new Class({
            type: "optional",
            innerType: oldShape[key]
          }) : oldShape[key];
        }
      }
      assignProp(this, "shape", shape);
      return shape;
    },
    checks: []
  });
  return clone(schema, def);
}
function required(Class, schema, mask) {
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const oldShape = schema._zod.def.shape;
      const shape = { ...oldShape };
      if (mask) {
        for (const key in mask) {
          if (!(key in shape)) {
            throw new Error(`Unrecognized key: "${key}"`);
          }
          if (!mask[key])
            continue;
          shape[key] = new Class({
            type: "nonoptional",
            innerType: oldShape[key]
          });
        }
      } else {
        for (const key in oldShape) {
          shape[key] = new Class({
            type: "nonoptional",
            innerType: oldShape[key]
          });
        }
      }
      assignProp(this, "shape", shape);
      return shape;
    }
  });
  return clone(schema, def);
}
function aborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true) {
      return true;
    }
  }
  return false;
}
function explicitlyAborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue === false) {
      return true;
    }
  }
  return false;
}
function prefixIssues(path, issues) {
  return issues.map((iss) => {
    var _a2;
    (_a2 = iss).path ?? (_a2.path = []);
    iss.path.unshift(path);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config2) {
  const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config2.customError?.(iss)) ?? unwrapMessage(config2.localeError?.(iss)) ?? "Invalid input";
  const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
  rest.path ?? (rest.path = []);
  rest.message = message;
  if (ctx?.reportInput) {
    rest.input = _input;
  }
  return rest;
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}
const initializer$1 = (inst, def) => {
  inst.name = "$ZodError";
  Object.defineProperty(inst, "_zod", {
    value: inst._zod,
    enumerable: false
  });
  Object.defineProperty(inst, "issues", {
    value: def,
    enumerable: false
  });
  inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
  Object.defineProperty(inst, "toString", {
    value: () => inst.message,
    enumerable: false
  });
};
const $ZodError = $constructor("$ZodError", initializer$1);
const $ZodRealError = $constructor("$ZodError", initializer$1, { Parent: Error });
function flattenError(error, mapper = (issue2) => issue2.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error.issues) {
    if (sub.path.length > 0) {
      fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
      fieldErrors[sub.path[0]].push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error, mapper = (issue2) => issue2.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error2, path = []) => {
    for (const issue2 of error2.issues) {
      if (issue2.code === "invalid_union" && issue2.errors.length) {
        issue2.errors.map((issues) => processError({ issues }, [...path, ...issue2.path]));
      } else if (issue2.code === "invalid_key") {
        processError({ issues: issue2.issues }, [...path, ...issue2.path]);
      } else if (issue2.code === "invalid_element") {
        processError({ issues: issue2.issues }, [...path, ...issue2.path]);
      } else {
        const fullpath = [...path, ...issue2.path];
        if (fullpath.length === 0) {
          fieldErrors._errors.push(mapper(issue2));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < fullpath.length) {
            const el = fullpath[i];
            const terminal = i === fullpath.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue2));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    }
  };
  processError(error);
  return fieldErrors;
}
const _parse = (_Err) => (schema, value, _ctx, _params) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  if (result.issues.length) {
    const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, _params?.callee);
    throw e;
  }
  return result.value;
};
const _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  if (result.issues.length) {
    const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, params?.callee);
    throw e;
  }
  return result.value;
};
const _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  return result.issues.length ? {
    success: false,
    error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
const safeParse$1 = /* @__PURE__ */ _safeParse($ZodRealError);
const _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? {
    success: false,
    error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
const safeParseAsync$1 = /* @__PURE__ */ _safeParseAsync($ZodRealError);
const _encode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _parse(_Err)(schema, value, ctx);
};
const _decode = (_Err) => (schema, value, _ctx) => {
  return _parse(_Err)(schema, value, _ctx);
};
const _encodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _parseAsync(_Err)(schema, value, ctx);
};
const _decodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _parseAsync(_Err)(schema, value, _ctx);
};
const _safeEncode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParse(_Err)(schema, value, ctx);
};
const _safeDecode = (_Err) => (schema, value, _ctx) => {
  return _safeParse(_Err)(schema, value, _ctx);
};
const _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParseAsync(_Err)(schema, value, ctx);
};
const _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _safeParseAsync(_Err)(schema, value, _ctx);
};
const cuid = /^[cC][0-9a-z]{6,}$/;
const cuid2 = /^[0-9a-z]+$/;
const ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
const xid = /^[0-9a-vA-V]{20}$/;
const ksuid = /^[A-Za-z0-9]{27}$/;
const nanoid = /^[a-zA-Z0-9_-]{21}$/;
const duration$1 = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
const guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
const uuid = (version2) => {
  if (!version2)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version2}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
const email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
const _emoji$1 = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
function emoji() {
  return new RegExp(_emoji$1, "u");
}
const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
const ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
const cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
const cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
const base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
const base64url = /^[A-Za-z0-9_-]*$/;
const httpProtocol = /^https?$/;
const e164 = /^\+[1-9]\d{6,14}$/;
const dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
const date$1 = /* @__PURE__ */ new RegExp(`^${dateSource}$`);
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex;
}
function time$1(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime$1(args) {
  const time2 = timeSource({ precision: args.precision });
  const opts = ["Z"];
  if (args.local)
    opts.push("");
  if (args.offset)
    opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  const timeRegex = `${time2}(?:${opts.join("|")})`;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
const string$1 = (params) => {
  const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
  return new RegExp(`^${regex}$`);
};
const integer = /^-?\d+$/;
const number$1 = /^-?\d+(?:\.\d+)?$/;
const lowercase = /^[^A-Z]*$/;
const uppercase = /^[^a-z]*$/;
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
const $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a2;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a2 = inst._zod).onattach ?? (_a2.onattach = []);
});
const numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
const $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
    if (def.value < curr) {
      if (def.inclusive)
        bag.maximum = def.value;
      else
        bag.exclusiveMaximum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
    if (def.value > curr) {
      if (def.inclusive)
        bag.minimum = def.value;
      else
        bag.exclusiveMinimum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    var _a2;
    (_a2 = inst2._zod.bag).multipleOf ?? (_a2.multipleOf = def.value);
  });
  inst._zod.check = (payload) => {
    if (typeof payload.value !== typeof def.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    const isMultiple = typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0;
    if (isMultiple)
      return;
    payload.issues.push({
      origin: typeof payload.value,
      code: "not_multiple_of",
      divisor: def.value,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = def.format;
    bag.minimum = minimum;
    bag.maximum = maximum;
    if (isInt)
      bag.pattern = integer;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          continue: false,
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});
const $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a2;
  $ZodCheck.init(inst, def);
  (_a2 = inst._zod.def).when ?? (_a2.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    if (def.maximum < curr)
      inst2._zod.bag.maximum = def.maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length <= def.maximum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a2;
  $ZodCheck.init(inst, def);
  (_a2 = inst._zod.def).when ?? (_a2.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    if (def.minimum > curr)
      inst2._zod.bag.minimum = def.minimum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length >= def.minimum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a2;
  $ZodCheck.init(inst, def);
  (_a2 = inst._zod.def).when ?? (_a2.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.minimum = def.length;
    bag.maximum = def.length;
    bag.length = def.length;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length === def.length)
      return;
    const origin = getLengthableOrigin(input);
    const tooBig = length > def.length;
    payload.issues.push({
      origin,
      ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a2, _b;
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = def.format;
    if (def.pattern) {
      bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
      bag.patterns.add(def.pattern);
    }
  });
  if (def.pattern)
    (_a2 = inst._zod).check ?? (_a2.check = (payload) => {
      def.pattern.lastIndex = 0;
      if (def.pattern.test(payload.value))
        return;
      payload.issues.push({
        origin: "string",
        code: "invalid_format",
        format: def.format,
        input: payload.value,
        ...def.pattern ? { pattern: def.pattern.toString() } : {},
        inst,
        continue: !def.abort
      });
    });
  else
    (_b = inst._zod).check ?? (_b.check = () => {
    });
});
const $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    def.pattern.lastIndex = 0;
    if (def.pattern.test(payload.value))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
  def.pattern ?? (def.pattern = lowercase);
  $ZodCheckStringFormat.init(inst, def);
});
const $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
  def.pattern ?? (def.pattern = uppercase);
  $ZodCheckStringFormat.init(inst, def);
});
const $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
  $ZodCheck.init(inst, def);
  const escapedRegex = escapeRegex(def.includes);
  const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
  def.pattern = pattern;
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.includes(def.includes, def.position))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: def.includes,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.startsWith(def.prefix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: def.prefix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.endsWith(def.suffix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: def.suffix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});
class Doc {
  constructor(args = []) {
    this.content = [];
    this.indent = 0;
    if (this)
      this.args = args;
  }
  indented(fn) {
    this.indent += 1;
    fn(this);
    this.indent -= 1;
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const content = arg;
    const lines = content.split("\n").filter((x) => x);
    const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
    const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
    for (const line of dedented) {
      this.content.push(line);
    }
  }
  compile() {
    const F = Function;
    const args = this?.args;
    const content = this?.content ?? [``];
    const lines = [...content.map((x) => `  ${x}`)];
    return new F(...args, lines.join("\n"));
  }
}
const version = {
  major: 4,
  minor: 4,
  patch: 3
};
const $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a2;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const checks = [...inst._zod.def.checks ?? []];
  if (inst._zod.traits.has("$ZodCheck")) {
    checks.unshift(inst);
  }
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a2 = inst._zod).deferred ?? (_a2.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks2, ctx) => {
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks2) {
        if (ch._zod.def.when) {
          if (explicitlyAborted(payload))
            continue;
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError();
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    const handleCanaryResult = (canary, payload, ctx) => {
      if (aborted(canary)) {
        canary.aborted = true;
        return canary;
      }
      const checkResult = runChecks(payload, checks, ctx);
      if (checkResult instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return checkResult.then((checkResult2) => inst._zod.parse(checkResult2, ctx));
      }
      return inst._zod.parse(checkResult, ctx);
    };
    inst._zod.run = (payload, ctx) => {
      if (ctx.skipChecks) {
        return inst._zod.parse(payload, ctx);
      }
      if (ctx.direction === "backward") {
        const canary = inst._zod.parse({ value: payload.value, issues: [] }, { ...ctx, skipChecks: true });
        if (canary instanceof Promise) {
          return canary.then((canary2) => {
            return handleCanaryResult(canary2, payload, ctx);
          });
        }
        return handleCanaryResult(canary, payload, ctx);
      }
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return result.then((result2) => runChecks(result2, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
  defineLazy(inst, "~standard", () => ({
    validate: (value) => {
      try {
        const r = safeParse$1(inst, value);
        return r.success ? { value: r.data } : { issues: r.error?.issues };
      } catch (_) {
        return safeParseAsync$1(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
      }
    },
    vendor: "zod",
    version: 1
  }));
});
const $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string$1(inst._zod.bag);
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_2) {
      }
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
const $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  $ZodString.init(inst, def);
});
const $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
  def.pattern ?? (def.pattern = guid);
  $ZodStringFormat.init(inst, def);
});
const $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
  if (def.version) {
    const versionMap = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    };
    const v = versionMap[def.version];
    if (v === void 0)
      throw new Error(`Invalid UUID version: "${def.version}"`);
    def.pattern ?? (def.pattern = uuid(v));
  } else
    def.pattern ?? (def.pattern = uuid());
  $ZodStringFormat.init(inst, def);
});
const $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
  def.pattern ?? (def.pattern = email);
  $ZodStringFormat.init(inst, def);
});
const $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    try {
      const trimmed = payload.value.trim();
      if (!def.normalize && def.protocol?.source === httpProtocol.source) {
        if (!/^https?:\/\//i.test(trimmed)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid URL format",
            input: payload.value,
            inst,
            continue: !def.abort
          });
          return;
        }
      }
      const url = new URL(trimmed);
      if (def.hostname) {
        def.hostname.lastIndex = 0;
        if (!def.hostname.test(url.hostname)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid hostname",
            pattern: def.hostname.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (def.protocol) {
        def.protocol.lastIndex = 0;
        if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid protocol",
            pattern: def.protocol.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (def.normalize) {
        payload.value = url.href;
      } else {
        payload.value = trimmed;
      }
      return;
    } catch (_) {
      payload.issues.push({
        code: "invalid_format",
        format: "url",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
const $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
  def.pattern ?? (def.pattern = emoji());
  $ZodStringFormat.init(inst, def);
});
const $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
  def.pattern ?? (def.pattern = nanoid);
  $ZodStringFormat.init(inst, def);
});
const $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
  def.pattern ?? (def.pattern = cuid);
  $ZodStringFormat.init(inst, def);
});
const $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
  def.pattern ?? (def.pattern = cuid2);
  $ZodStringFormat.init(inst, def);
});
const $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
  def.pattern ?? (def.pattern = ulid);
  $ZodStringFormat.init(inst, def);
});
const $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
  def.pattern ?? (def.pattern = xid);
  $ZodStringFormat.init(inst, def);
});
const $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
  def.pattern ?? (def.pattern = ksuid);
  $ZodStringFormat.init(inst, def);
});
const $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
  def.pattern ?? (def.pattern = datetime$1(def));
  $ZodStringFormat.init(inst, def);
});
const $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
  def.pattern ?? (def.pattern = date$1);
  $ZodStringFormat.init(inst, def);
});
const $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
  def.pattern ?? (def.pattern = time$1(def));
  $ZodStringFormat.init(inst, def);
});
const $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
  def.pattern ?? (def.pattern = duration$1);
  $ZodStringFormat.init(inst, def);
});
const $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
  def.pattern ?? (def.pattern = ipv4);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `ipv4`;
});
const $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `ipv6`;
  inst._zod.check = (payload) => {
    try {
      new URL(`http://[${payload.value}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
const $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv4);
  $ZodStringFormat.init(inst, def);
});
const $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    const parts = payload.value.split("/");
    try {
      if (parts.length !== 2)
        throw new Error();
      const [address, prefix] = parts;
      if (!prefix)
        throw new Error();
      const prefixNum = Number(prefix);
      if (`${prefixNum}` !== prefix)
        throw new Error();
      if (prefixNum < 0 || prefixNum > 128)
        throw new Error();
      new URL(`http://[${address}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
function isValidBase64(data) {
  if (data === "")
    return true;
  if (/\s/.test(data))
    return false;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
const $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.contentEncoding = "base64";
  inst._zod.check = (payload) => {
    if (isValidBase64(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
function isValidBase64URL(data) {
  if (!base64url.test(data))
    return false;
  const base642 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base642.padEnd(Math.ceil(base642.length / 4) * 4, "=");
  return isValidBase64(padded);
}
const $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64url);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.contentEncoding = "base64url";
  inst._zod.check = (payload) => {
    if (isValidBase64URL(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
  def.pattern ?? (def.pattern = e164);
  $ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return false;
    const [header] = tokensParts;
    if (!header)
      return false;
    const parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return false;
    if (!parsedHeader.alg)
      return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return false;
    return true;
  } catch {
    return false;
  }
}
const $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidJWT(payload.value, def.alg))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
const $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = inst._zod.bag.pattern ?? number$1;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {
      }
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : void 0 : void 0;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
const $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
const $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
const $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.issues.push({
      expected: "never",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
const $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = Array(input.length);
    const proms = [];
    for (let i = 0; i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result2) => handleArrayResult(result2, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
function handlePropertyResult(result, final, key, input, isOptionalIn, isOptionalOut) {
  const isPresent = key in input;
  if (result.issues.length) {
    if (isOptionalIn && isOptionalOut && !isPresent) {
      return;
    }
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (!isPresent && !isOptionalIn) {
    if (!result.issues.length) {
      final.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: void 0,
        path: [key]
      });
    }
    return;
  }
  if (result.value === void 0) {
    if (isPresent) {
      final.value[key] = void 0;
    }
  } else {
    final.value[key] = result.value;
  }
}
function normalizeDef(def) {
  const keys = Object.keys(def.shape);
  for (const k of keys) {
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) {
      throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
    }
  }
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    keys,
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input, payload, ctx, def, inst) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t = _catchall.def.type;
  const isOptionalIn = _catchall.optin === "optional";
  const isOptionalOut = _catchall.optout === "optional";
  for (const key in input) {
    if (key === "__proto__")
      continue;
    if (keySet.has(key))
      continue;
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    const r = _catchall.run({ value: input[key], issues: [] }, ctx);
    if (r instanceof Promise) {
      proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, isOptionalIn, isOptionalOut)));
    } else {
      handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
    }
  }
  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
      inst
    });
  }
  if (!proms.length)
    return payload;
  return Promise.all(proms).then(() => {
    return payload;
  });
}
const $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  if (!desc?.get) {
    const sh = def.shape;
    Object.defineProperty(def, "shape", {
      get: () => {
        const newSh = { ...sh };
        Object.defineProperty(def, "shape", {
          value: newSh
        });
        return newSh;
      }
    });
  }
  const _normalized = cached(() => normalizeDef(def));
  defineLazy(inst._zod, "propValues", () => {
    const shape = def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        propValues[key] ?? (propValues[key] = /* @__PURE__ */ new Set());
        for (const v of field.values)
          propValues[key].add(v);
      }
    }
    return propValues;
  });
  const isObject$1 = isObject;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject$1(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = {};
    const proms = [];
    const shape = value.shape;
    for (const key of value.keys) {
      const el = shape[key];
      const isOptionalIn = el._zod.optin === "optional";
      const isOptionalOut = el._zod.optout === "optional";
      const r = el._zod.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, isOptionalIn, isOptionalOut)));
      } else {
        handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
  };
});
const $ZodObjectJIT = /* @__PURE__ */ $constructor("$ZodObjectJIT", (inst, def) => {
  $ZodObject.init(inst, def);
  const superParse = inst._zod.parse;
  const _normalized = cached(() => normalizeDef(def));
  const generateFastpass = (shape) => {
    const doc = new Doc(["shape", "payload", "ctx"]);
    const normalized = _normalized.value;
    const parseStr = (key) => {
      const k = esc(key);
      return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    };
    doc.write(`const input = payload.value;`);
    const ids = /* @__PURE__ */ Object.create(null);
    let counter = 0;
    for (const key of normalized.keys) {
      ids[key] = `key_${counter++}`;
    }
    doc.write(`const newResult = {};`);
    for (const key of normalized.keys) {
      const id = ids[key];
      const k = esc(key);
      const schema = shape[key];
      const isOptionalIn = schema?._zod?.optin === "optional";
      const isOptionalOut = schema?._zod?.optout === "optional";
      doc.write(`const ${id} = ${parseStr(key)};`);
      if (isOptionalIn && isOptionalOut) {
        doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
      } else if (!isOptionalIn) {
        doc.write(`
        const ${id}_present = ${k} in input;
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          if (${id}.value === undefined) {
            newResult[${k}] = undefined;
          } else {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
      } else {
        doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
      }
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    const fn = doc.compile();
    return (payload, ctx) => fn(shape, payload, ctx);
  };
  let fastpass;
  const isObject$1 = isObject;
  const jit = !globalConfig.jitless;
  const allowsEval$1 = allowsEval;
  const fastEnabled = jit && allowsEval$1.value;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject$1(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
      if (!fastpass)
        fastpass = generateFastpass(def.shape);
      payload = fastpass(payload, ctx);
      if (!catchall)
        return payload;
      return handleCatchall([], input, payload, ctx, value, inst);
    }
    return superParse(payload, ctx);
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  const nonaborted = results.filter((r) => !aborted(r));
  if (nonaborted.length === 1) {
    final.value = nonaborted[0].value;
    return nonaborted[0];
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
const $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0);
  defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
  defineLazy(inst._zod, "values", () => {
    if (def.options.every((o) => o._zod.values)) {
      return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return void 0;
  });
  defineLazy(inst._zod, "pattern", () => {
    if (def.options.every((o) => o._zod.pattern)) {
      const patterns = def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return void 0;
  });
  const first = def.options.length === 1 ? def.options[0]._zod.run : null;
  inst._zod.parse = (payload, ctx) => {
    if (first) {
      return first(payload, ctx);
    }
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results2) => {
      return handleUnionResults(results2, payload, inst, ctx);
    });
  };
});
const $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    const left = def.left._zod.run({ value: input, issues: [] }, ctx);
    const right = def.right._zod.run({ value: input, issues: [] }, ctx);
    const async = left instanceof Promise || right instanceof Promise;
    if (async) {
      return Promise.all([left, right]).then(([left2, right2]) => {
        return handleIntersectionResults(payload, left2, right2);
      });
    }
    return handleIntersectionResults(payload, left, right);
  };
});
function mergeValues(a, b) {
  if (a === b) {
    return { valid: true, data: a };
  }
  if (a instanceof Date && b instanceof Date && +a === +b) {
    return { valid: true, data: a };
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { valid: false, mergeErrorPath: [] };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
        };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  }
  return { valid: false, mergeErrorPath: [] };
}
function handleIntersectionResults(result, left, right) {
  const unrecKeys = /* @__PURE__ */ new Map();
  let unrecIssue;
  for (const iss of left.issues) {
    if (iss.code === "unrecognized_keys") {
      unrecIssue ?? (unrecIssue = iss);
      for (const k of iss.keys) {
        if (!unrecKeys.has(k))
          unrecKeys.set(k, {});
        unrecKeys.get(k).l = true;
      }
    } else {
      result.issues.push(iss);
    }
  }
  for (const iss of right.issues) {
    if (iss.code === "unrecognized_keys") {
      for (const k of iss.keys) {
        if (!unrecKeys.has(k))
          unrecKeys.set(k, {});
        unrecKeys.get(k).r = true;
      }
    } else {
      result.issues.push(iss);
    }
  }
  const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
  if (bothKeys.length && unrecIssue) {
    result.issues.push({ ...unrecIssue, keys: bothKeys });
  }
  if (aborted(result))
    return result;
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
const $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  const valuesSet = new Set(values);
  inst._zod.values = valuesSet;
  inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (valuesSet.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
const $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    const _out = def.transform(payload.value, payload);
    if (ctx.async) {
      const output = _out instanceof Promise ? _out : Promise.resolve(_out);
      return output.then((output2) => {
        payload.value = output2;
        payload.fallback = true;
        return payload;
      });
    }
    if (_out instanceof Promise) {
      throw new $ZodAsyncError();
    }
    payload.value = _out;
    payload.fallback = true;
    return payload;
  };
});
function handleOptionalResult(result, input) {
  if (input === void 0 && (result.issues.length || result.fallback)) {
    return { issues: [], value: void 0 };
  }
  return result;
}
const $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  inst._zod.optout = "optional";
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, void 0]) : void 0;
  });
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (def.innerType._zod.optin === "optional") {
      const input = payload.value;
      const result = def.innerType._zod.run(payload, ctx);
      if (result instanceof Promise)
        return result.then((r) => handleOptionalResult(r, input));
      return handleOptionalResult(result, input);
    }
    if (payload.value === void 0) {
      return payload;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
const $ZodExactOptional = /* @__PURE__ */ $constructor("$ZodExactOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
  inst._zod.parse = (payload, ctx) => {
    return def.innerType._zod.run(payload, ctx);
  };
});
const $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
  });
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, null]) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
const $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === void 0) {
      payload.value = def.defaultValue;
      return payload;
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleDefaultResult(result2, def));
    }
    return handleDefaultResult(result, def);
  };
});
function handleDefaultResult(payload, def) {
  if (payload.value === void 0) {
    payload.value = def.defaultValue;
  }
  return payload;
}
const $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === void 0) {
      payload.value = def.defaultValue;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
const $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => {
    const v = def.innerType._zod.values;
    return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleNonOptionalResult(result2, inst));
    }
    return handleNonOptionalResult(result, inst);
  };
});
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === void 0) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
const $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => {
        payload.value = result2.value;
        if (result2.issues.length) {
          payload.value = def.catchValue({
            ...payload,
            error: {
              issues: result2.issues.map((iss) => finalizeIssue(iss, ctx, config()))
            },
            input: payload.value
          });
          payload.issues = [];
          payload.fallback = true;
        }
        return payload;
      });
    }
    payload.value = result.value;
    if (result.issues.length) {
      payload.value = def.catchValue({
        ...payload,
        error: {
          issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
        },
        input: payload.value
      });
      payload.issues = [];
      payload.fallback = true;
    }
    return payload;
  };
});
const $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => def.in._zod.values);
  defineLazy(inst._zod, "optin", () => def.in._zod.optin);
  defineLazy(inst._zod, "optout", () => def.out._zod.optout);
  defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise) {
        return right.then((right2) => handlePipeResult(right2, def.in, ctx));
      }
      return handlePipeResult(right, def.in, ctx);
    }
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left2) => handlePipeResult(left2, def.out, ctx));
    }
    return handlePipeResult(left, def.out, ctx);
  };
});
function handlePipeResult(left, next, ctx) {
  if (left.issues.length) {
    left.aborted = true;
    return left;
  }
  return next._zod.run({ value: left.value, issues: left.issues, fallback: left.fallback }, ctx);
}
const $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
  defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then(handleReadonlyResult);
    }
    return handleReadonlyResult(result);
  };
});
function handleReadonlyResult(payload) {
  payload.value = Object.freeze(payload.value);
  return payload;
}
const $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def);
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _) => {
    return payload;
  };
  inst._zod.check = (payload) => {
    const input = payload.value;
    const r = def.fn(input);
    if (r instanceof Promise) {
      return r.then((r2) => handleRefineResult(r2, payload, input, inst));
    }
    handleRefineResult(r, payload, input, inst);
    return;
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      // incorporates params.error into issue reporting
      path: [...inst._zod.def.path ?? []],
      // incorporates params.error into issue reporting
      continue: !inst._zod.def.abort
      // params: inst._zod.def.params,
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}
var _a;
class $ZodRegistry {
  constructor() {
    this._map = /* @__PURE__ */ new WeakMap();
    this._idmap = /* @__PURE__ */ new Map();
  }
  add(schema, ..._meta) {
    const meta = _meta[0];
    this._map.set(schema, meta);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.set(meta.id, schema);
    }
    return this;
  }
  clear() {
    this._map = /* @__PURE__ */ new WeakMap();
    this._idmap = /* @__PURE__ */ new Map();
    return this;
  }
  remove(schema) {
    const meta = this._map.get(schema);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.delete(meta.id);
    }
    this._map.delete(schema);
    return this;
  }
  get(schema) {
    const p = schema._zod.parent;
    if (p) {
      const pm = { ...this.get(p) ?? {} };
      delete pm.id;
      const f = { ...pm, ...this._map.get(schema) };
      return Object.keys(f).length ? f : void 0;
    }
    return this._map.get(schema);
  }
  has(schema) {
    return this._map.has(schema);
  }
}
function registry() {
  return new $ZodRegistry();
}
(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
const globalRegistry = globalThis.__zod_globalRegistry;
// @__NO_SIDE_EFFECTS__
function _string(Class, params) {
  return new Class({
    type: "string",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _email(Class, params) {
  return new Class({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _guid(Class, params) {
  return new Class({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuid(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv4(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv6(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv7(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _url(Class, params) {
  return new Class({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _emoji(Class, params) {
  return new Class({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _nanoid(Class, params) {
  return new Class({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cuid(Class, params) {
  return new Class({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cuid2(Class, params) {
  return new Class({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ulid(Class, params) {
  return new Class({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _xid(Class, params) {
  return new Class({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ksuid(Class, params) {
  return new Class({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ipv4(Class, params) {
  return new Class({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ipv6(Class, params) {
  return new Class({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cidrv4(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cidrv6(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _base64(Class, params) {
  return new Class({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _base64url(Class, params) {
  return new Class({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _e164(Class, params) {
  return new Class({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _jwt(Class, params) {
  return new Class({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDateTime(Class, params) {
  return new Class({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDate(Class, params) {
  return new Class({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoTime(Class, params) {
  return new Class({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDuration(Class, params) {
  return new Class({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _number(Class, params) {
  return new Class({
    type: "number",
    checks: [],
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _int(Class, params) {
  return new Class({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _unknown(Class) {
  return new Class({
    type: "unknown"
  });
}
// @__NO_SIDE_EFFECTS__
function _never(Class, params) {
  return new Class({
    type: "never",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
// @__NO_SIDE_EFFECTS__
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
// @__NO_SIDE_EFFECTS__
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
// @__NO_SIDE_EFFECTS__
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
// @__NO_SIDE_EFFECTS__
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
// @__NO_SIDE_EFFECTS__
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
// @__NO_SIDE_EFFECTS__
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
// @__NO_SIDE_EFFECTS__
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
// @__NO_SIDE_EFFECTS__
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
// @__NO_SIDE_EFFECTS__
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix
  });
}
// @__NO_SIDE_EFFECTS__
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
// @__NO_SIDE_EFFECTS__
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
// @__NO_SIDE_EFFECTS__
function _normalize(form) {
  return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
}
// @__NO_SIDE_EFFECTS__
function _trim() {
  return /* @__PURE__ */ _overwrite((input) => input.trim());
}
// @__NO_SIDE_EFFECTS__
function _toLowerCase() {
  return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function _toUpperCase() {
  return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function _slugify() {
  return /* @__PURE__ */ _overwrite((input) => slugify(input));
}
// @__NO_SIDE_EFFECTS__
function _array(Class, element, params) {
  return new Class({
    type: "array",
    element,
    // get element() {
    //   return element;
    // },
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _refine(Class, fn, _params) {
  const schema = new Class({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema;
}
// @__NO_SIDE_EFFECTS__
function _superRefine(fn, params) {
  const ch = /* @__PURE__ */ _check((payload) => {
    payload.addIssue = (issue$1) => {
      if (typeof issue$1 === "string") {
        payload.issues.push(issue(issue$1, payload.value, ch._zod.def));
      } else {
        const _issue = issue$1;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(issue(_issue));
      }
    };
    return fn(payload.value, payload);
  }, params);
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _check(fn, params) {
  const ch = new $ZodCheck({
    check: "custom",
    ...normalizeParams(params)
  });
  ch._zod.check = fn;
  return ch;
}
function initializeContext(params) {
  let target = params?.target ?? "draft-2020-12";
  if (target === "draft-4")
    target = "draft-04";
  if (target === "draft-7")
    target = "draft-07";
  return {
    processors: params.processors ?? {},
    metadataRegistry: params?.metadata ?? globalRegistry,
    target,
    unrepresentable: params?.unrepresentable ?? "throw",
    override: params?.override ?? (() => {
    }),
    io: params?.io ?? "output",
    counter: 0,
    seen: /* @__PURE__ */ new Map(),
    cycles: params?.cycles ?? "ref",
    reused: params?.reused ?? "inline",
    external: params?.external ?? void 0
  };
}
function process$1(schema, ctx, _params = { path: [], schemaPath: [] }) {
  var _a2;
  const def = schema._zod.def;
  const seen = ctx.seen.get(schema);
  if (seen) {
    seen.count++;
    const isCycle = _params.schemaPath.includes(schema);
    if (isCycle) {
      seen.cycle = _params.path;
    }
    return seen.schema;
  }
  const result = { schema: {}, count: 1, cycle: void 0, path: _params.path };
  ctx.seen.set(schema, result);
  const overrideSchema = schema._zod.toJSONSchema?.();
  if (overrideSchema) {
    result.schema = overrideSchema;
  } else {
    const params = {
      ..._params,
      schemaPath: [..._params.schemaPath, schema],
      path: _params.path
    };
    if (schema._zod.processJSONSchema) {
      schema._zod.processJSONSchema(ctx, result.schema, params);
    } else {
      const _json = result.schema;
      const processor = ctx.processors[def.type];
      if (!processor) {
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
      }
      processor(schema, ctx, _json, params);
    }
    const parent = schema._zod.parent;
    if (parent) {
      if (!result.ref)
        result.ref = parent;
      process$1(parent, ctx, params);
      ctx.seen.get(parent).isParent = true;
    }
  }
  const meta = ctx.metadataRegistry.get(schema);
  if (meta)
    Object.assign(result.schema, meta);
  if (ctx.io === "input" && isTransforming(schema)) {
    delete result.schema.examples;
    delete result.schema.default;
  }
  if (ctx.io === "input" && "_prefault" in result.schema)
    (_a2 = result.schema).default ?? (_a2.default = result.schema._prefault);
  delete result.schema._prefault;
  const _result = ctx.seen.get(schema);
  return _result.schema;
}
function extractDefs(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const idToSchema = /* @__PURE__ */ new Map();
  for (const entry of ctx.seen.entries()) {
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      const existing = idToSchema.get(id);
      if (existing && existing !== entry[0]) {
        throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      }
      idToSchema.set(id, entry[0]);
    }
  }
  const makeURI = (entry) => {
    const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
    if (ctx.external) {
      const externalId = ctx.external.registry.get(entry[0])?.id;
      const uriGenerator = ctx.external.uri ?? ((id2) => id2);
      if (externalId) {
        return { ref: uriGenerator(externalId) };
      }
      const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
      entry[1].defId = id;
      return { defId: id, ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}` };
    }
    if (entry[1] === root) {
      return { ref: "#" };
    }
    const uriPrefix = `#`;
    const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
    const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
    return { defId, ref: defUriPrefix + defId };
  };
  const extractToDef = (entry) => {
    if (entry[1].schema.$ref) {
      return;
    }
    const seen = entry[1];
    const { ref, defId } = makeURI(entry);
    seen.def = { ...seen.schema };
    if (defId)
      seen.defId = defId;
    const schema2 = seen.schema;
    for (const key in schema2) {
      delete schema2[key];
    }
    schema2.$ref = ref;
  };
  if (ctx.cycles === "throw") {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.cycle) {
        throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
      }
    }
  }
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (schema === entry[0]) {
      extractToDef(entry);
      continue;
    }
    if (ctx.external) {
      const ext = ctx.external.registry.get(entry[0])?.id;
      if (schema !== entry[0] && ext) {
        extractToDef(entry);
        continue;
      }
    }
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      extractToDef(entry);
      continue;
    }
    if (seen.cycle) {
      extractToDef(entry);
      continue;
    }
    if (seen.count > 1) {
      if (ctx.reused === "ref") {
        extractToDef(entry);
        continue;
      }
    }
  }
}
function finalize(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const flattenRef = (zodSchema) => {
    const seen = ctx.seen.get(zodSchema);
    if (seen.ref === null)
      return;
    const schema2 = seen.def ?? seen.schema;
    const _cached = { ...schema2 };
    const ref = seen.ref;
    seen.ref = null;
    if (ref) {
      flattenRef(ref);
      const refSeen = ctx.seen.get(ref);
      const refSchema = refSeen.schema;
      if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
        schema2.allOf = schema2.allOf ?? [];
        schema2.allOf.push(refSchema);
      } else {
        Object.assign(schema2, refSchema);
      }
      Object.assign(schema2, _cached);
      const isParentRef = zodSchema._zod.parent === ref;
      if (isParentRef) {
        for (const key in schema2) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (!(key in _cached)) {
            delete schema2[key];
          }
        }
      }
      if (refSchema.$ref && refSeen.def) {
        for (const key in schema2) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (key in refSeen.def && JSON.stringify(schema2[key]) === JSON.stringify(refSeen.def[key])) {
            delete schema2[key];
          }
        }
      }
    }
    const parent = zodSchema._zod.parent;
    if (parent && parent !== ref) {
      flattenRef(parent);
      const parentSeen = ctx.seen.get(parent);
      if (parentSeen?.schema.$ref) {
        schema2.$ref = parentSeen.schema.$ref;
        if (parentSeen.def) {
          for (const key in schema2) {
            if (key === "$ref" || key === "allOf")
              continue;
            if (key in parentSeen.def && JSON.stringify(schema2[key]) === JSON.stringify(parentSeen.def[key])) {
              delete schema2[key];
            }
          }
        }
      }
    }
    ctx.override({
      zodSchema,
      jsonSchema: schema2,
      path: seen.path ?? []
    });
  };
  for (const entry of [...ctx.seen.entries()].reverse()) {
    flattenRef(entry[0]);
  }
  const result = {};
  if (ctx.target === "draft-2020-12") {
    result.$schema = "https://json-schema.org/draft/2020-12/schema";
  } else if (ctx.target === "draft-07") {
    result.$schema = "http://json-schema.org/draft-07/schema#";
  } else if (ctx.target === "draft-04") {
    result.$schema = "http://json-schema.org/draft-04/schema#";
  } else if (ctx.target === "openapi-3.0") ;
  else ;
  if (ctx.external?.uri) {
    const id = ctx.external.registry.get(schema)?.id;
    if (!id)
      throw new Error("Schema is missing an `id` property");
    result.$id = ctx.external.uri(id);
  }
  Object.assign(result, root.def ?? root.schema);
  const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
  if (rootMetaId !== void 0 && result.id === rootMetaId)
    delete result.id;
  const defs = ctx.external?.defs ?? {};
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (seen.def && seen.defId) {
      if (seen.def.id === seen.defId)
        delete seen.def.id;
      defs[seen.defId] = seen.def;
    }
  }
  if (ctx.external) ;
  else {
    if (Object.keys(defs).length > 0) {
      if (ctx.target === "draft-2020-12") {
        result.$defs = defs;
      } else {
        result.definitions = defs;
      }
    }
  }
  try {
    const finalized = JSON.parse(JSON.stringify(result));
    Object.defineProperty(finalized, "~standard", {
      value: {
        ...schema["~standard"],
        jsonSchema: {
          input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
          output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
        }
      },
      enumerable: false,
      writable: false
    });
    return finalized;
  } catch (_err) {
    throw new Error("Error converting schema to JSON.");
  }
}
function isTransforming(_schema, _ctx) {
  const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
  if (ctx.seen.has(_schema))
    return false;
  ctx.seen.add(_schema);
  const def = _schema._zod.def;
  if (def.type === "transform")
    return true;
  if (def.type === "array")
    return isTransforming(def.element, ctx);
  if (def.type === "set")
    return isTransforming(def.valueType, ctx);
  if (def.type === "lazy")
    return isTransforming(def.getter(), ctx);
  if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") {
    return isTransforming(def.innerType, ctx);
  }
  if (def.type === "intersection") {
    return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
  }
  if (def.type === "record" || def.type === "map") {
    return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
  }
  if (def.type === "pipe") {
    if (_schema._zod.traits.has("$ZodCodec"))
      return true;
    return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
  }
  if (def.type === "object") {
    for (const key in def.shape) {
      if (isTransforming(def.shape[key], ctx))
        return true;
    }
    return false;
  }
  if (def.type === "union") {
    for (const option of def.options) {
      if (isTransforming(option, ctx))
        return true;
    }
    return false;
  }
  if (def.type === "tuple") {
    for (const item of def.items) {
      if (isTransforming(item, ctx))
        return true;
    }
    if (def.rest && isTransforming(def.rest, ctx))
      return true;
    return false;
  }
  return false;
}
const createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
  const ctx = initializeContext({ ...params, processors });
  process$1(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
const createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
  const { libraryOptions, target } = params ?? {};
  const ctx = initializeContext({ ...libraryOptions ?? {}, target, io, processors });
  process$1(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
const formatMap = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
  // do not set
};
const stringProcessor = (schema, ctx, _json, _params) => {
  const json = _json;
  json.type = "string";
  const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
  if (typeof minimum === "number")
    json.minLength = minimum;
  if (typeof maximum === "number")
    json.maxLength = maximum;
  if (format) {
    json.format = formatMap[format] ?? format;
    if (json.format === "")
      delete json.format;
    if (format === "time") {
      delete json.format;
    }
  }
  if (contentEncoding)
    json.contentEncoding = contentEncoding;
  if (patterns && patterns.size > 0) {
    const regexes = [...patterns];
    if (regexes.length === 1)
      json.pattern = regexes[0].source;
    else if (regexes.length > 1) {
      json.allOf = [
        ...regexes.map((regex) => ({
          ...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
          pattern: regex.source
        }))
      ];
    }
  }
};
const numberProcessor = (schema, ctx, _json, _params) => {
  const json = _json;
  const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema._zod.bag;
  if (typeof format === "string" && format.includes("int"))
    json.type = "integer";
  else
    json.type = "number";
  const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
  const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
  const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
  if (exMin) {
    if (legacy) {
      json.minimum = exclusiveMinimum;
      json.exclusiveMinimum = true;
    } else {
      json.exclusiveMinimum = exclusiveMinimum;
    }
  } else if (typeof minimum === "number") {
    json.minimum = minimum;
  }
  if (exMax) {
    if (legacy) {
      json.maximum = exclusiveMaximum;
      json.exclusiveMaximum = true;
    } else {
      json.exclusiveMaximum = exclusiveMaximum;
    }
  } else if (typeof maximum === "number") {
    json.maximum = maximum;
  }
  if (typeof multipleOf === "number")
    json.multipleOf = multipleOf;
};
const neverProcessor = (_schema, _ctx, json, _params) => {
  json.not = {};
};
const unknownProcessor = (_schema, _ctx, _json, _params) => {
};
const enumProcessor = (schema, _ctx, json, _params) => {
  const def = schema._zod.def;
  const values = getEnumValues(def.entries);
  if (values.every((v) => typeof v === "number"))
    json.type = "number";
  if (values.every((v) => typeof v === "string"))
    json.type = "string";
  json.enum = values;
};
const customProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Custom types cannot be represented in JSON Schema");
  }
};
const transformProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Transforms cannot be represented in JSON Schema");
  }
};
const arrayProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const { minimum, maximum } = schema._zod.bag;
  if (typeof minimum === "number")
    json.minItems = minimum;
  if (typeof maximum === "number")
    json.maxItems = maximum;
  json.type = "array";
  json.items = process$1(def.element, ctx, {
    ...params,
    path: [...params.path, "items"]
  });
};
const objectProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  json.type = "object";
  json.properties = {};
  const shape = def.shape;
  for (const key in shape) {
    json.properties[key] = process$1(shape[key], ctx, {
      ...params,
      path: [...params.path, "properties", key]
    });
  }
  const allKeys = new Set(Object.keys(shape));
  const requiredKeys = new Set([...allKeys].filter((key) => {
    const v = def.shape[key]._zod;
    if (ctx.io === "input") {
      return v.optin === void 0;
    } else {
      return v.optout === void 0;
    }
  }));
  if (requiredKeys.size > 0) {
    json.required = Array.from(requiredKeys);
  }
  if (def.catchall?._zod.def.type === "never") {
    json.additionalProperties = false;
  } else if (!def.catchall) {
    if (ctx.io === "output")
      json.additionalProperties = false;
  } else if (def.catchall) {
    json.additionalProperties = process$1(def.catchall, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
};
const unionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const isExclusive = def.inclusive === false;
  const options = def.options.map((x, i) => process$1(x, ctx, {
    ...params,
    path: [...params.path, isExclusive ? "oneOf" : "anyOf", i]
  }));
  if (isExclusive) {
    json.oneOf = options;
  } else {
    json.anyOf = options;
  }
};
const intersectionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const a = process$1(def.left, ctx, {
    ...params,
    path: [...params.path, "allOf", 0]
  });
  const b = process$1(def.right, ctx, {
    ...params,
    path: [...params.path, "allOf", 1]
  });
  const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
  const allOf = [
    ...isSimpleIntersection(a) ? a.allOf : [a],
    ...isSimpleIntersection(b) ? b.allOf : [b]
  ];
  json.allOf = allOf;
};
const nullableProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const inner = process$1(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  if (ctx.target === "openapi-3.0") {
    seen.ref = def.innerType;
    json.nullable = true;
  } else {
    json.anyOf = [inner, { type: "null" }];
  }
};
const nonoptionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  process$1(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
const defaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process$1(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json.default = JSON.parse(JSON.stringify(def.defaultValue));
};
const prefaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process$1(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  if (ctx.io === "input")
    json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
};
const catchProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process$1(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  let catchValue;
  try {
    catchValue = def.catchValue(void 0);
  } catch {
    throw new Error("Dynamic catch values are not supported in JSON Schema");
  }
  json.default = catchValue;
};
const pipeProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  const inIsTransform = def.in._zod.traits.has("$ZodTransform");
  const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
  process$1(innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = innerType;
};
const readonlyProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process$1(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json.readOnly = true;
};
const optionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  process$1(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
const ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
  $ZodISODateTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function datetime(params) {
  return /* @__PURE__ */ _isoDateTime(ZodISODateTime, params);
}
const ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
  $ZodISODate.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function date(params) {
  return /* @__PURE__ */ _isoDate(ZodISODate, params);
}
const ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
  $ZodISOTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function time(params) {
  return /* @__PURE__ */ _isoTime(ZodISOTime, params);
}
const ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
  $ZodISODuration.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function duration(params) {
  return /* @__PURE__ */ _isoDuration(ZodISODuration, params);
}
const initializer = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  Object.defineProperties(inst, {
    format: {
      value: (mapper) => formatError(inst, mapper)
      // enumerable: false,
    },
    flatten: {
      value: (mapper) => flattenError(inst, mapper)
      // enumerable: false,
    },
    addIssue: {
      value: (issue2) => {
        inst.issues.push(issue2);
        inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
      }
      // enumerable: false,
    },
    addIssues: {
      value: (issues2) => {
        inst.issues.push(...issues2);
        inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
      }
      // enumerable: false,
    },
    isEmpty: {
      get() {
        return inst.issues.length === 0;
      }
      // enumerable: false,
    }
  });
};
const ZodRealError = /* @__PURE__ */ $constructor("ZodError", initializer, {
  Parent: Error
});
const parse = /* @__PURE__ */ _parse(ZodRealError);
const parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
const safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
const safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
const encode = /* @__PURE__ */ _encode(ZodRealError);
const decode = /* @__PURE__ */ _decode(ZodRealError);
const encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
const decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
const safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
const safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
const safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
const safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
const _installedGroups = /* @__PURE__ */ new WeakMap();
function _installLazyMethods(inst, group, methods) {
  const proto = Object.getPrototypeOf(inst);
  let installed = _installedGroups.get(proto);
  if (!installed) {
    installed = /* @__PURE__ */ new Set();
    _installedGroups.set(proto, installed);
  }
  if (installed.has(group))
    return;
  installed.add(group);
  for (const key in methods) {
    const fn = methods[key];
    Object.defineProperty(proto, key, {
      configurable: true,
      enumerable: false,
      get() {
        const bound = fn.bind(this);
        Object.defineProperty(this, key, {
          configurable: true,
          writable: true,
          enumerable: true,
          value: bound
        });
        return bound;
      },
      set(v) {
        Object.defineProperty(this, key, {
          configurable: true,
          writable: true,
          enumerable: true,
          value: v
        });
      }
    });
  }
}
const ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
  $ZodType.init(inst, def);
  Object.assign(inst["~standard"], {
    jsonSchema: {
      input: createStandardJSONSchemaMethod(inst, "input"),
      output: createStandardJSONSchemaMethod(inst, "output")
    }
  });
  inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
  inst.def = def;
  inst.type = def.type;
  Object.defineProperty(inst, "_def", { value: def });
  inst.parse = (data, params) => parse(inst, data, params, { callee: inst.parse });
  inst.safeParse = (data, params) => safeParse(inst, data, params);
  inst.parseAsync = async (data, params) => parseAsync(inst, data, params, { callee: inst.parseAsync });
  inst.safeParseAsync = async (data, params) => safeParseAsync(inst, data, params);
  inst.spa = inst.safeParseAsync;
  inst.encode = (data, params) => encode(inst, data, params);
  inst.decode = (data, params) => decode(inst, data, params);
  inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
  inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
  inst.safeEncode = (data, params) => safeEncode(inst, data, params);
  inst.safeDecode = (data, params) => safeDecode(inst, data, params);
  inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
  inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
  _installLazyMethods(inst, "ZodType", {
    check(...chks) {
      const def2 = this.def;
      return this.clone(mergeDefs(def2, {
        checks: [
          ...def2.checks ?? [],
          ...chks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
        ]
      }), { parent: true });
    },
    with(...chks) {
      return this.check(...chks);
    },
    clone(def2, params) {
      return clone(this, def2, params);
    },
    brand() {
      return this;
    },
    register(reg, meta) {
      reg.add(this, meta);
      return this;
    },
    refine(check, params) {
      return this.check(refine(check, params));
    },
    superRefine(refinement, params) {
      return this.check(superRefine(refinement, params));
    },
    overwrite(fn) {
      return this.check(/* @__PURE__ */ _overwrite(fn));
    },
    optional() {
      return optional(this);
    },
    exactOptional() {
      return exactOptional(this);
    },
    nullable() {
      return nullable(this);
    },
    nullish() {
      return optional(nullable(this));
    },
    nonoptional(params) {
      return nonoptional(this, params);
    },
    array() {
      return array(this);
    },
    or(arg) {
      return union([this, arg]);
    },
    and(arg) {
      return intersection(this, arg);
    },
    transform(tx) {
      return pipe(this, transform(tx));
    },
    default(d) {
      return _default(this, d);
    },
    prefault(d) {
      return prefault(this, d);
    },
    catch(params) {
      return _catch(this, params);
    },
    pipe(target) {
      return pipe(this, target);
    },
    readonly() {
      return readonly(this);
    },
    describe(description) {
      const cl = this.clone();
      globalRegistry.add(cl, { description });
      return cl;
    },
    meta(...args) {
      if (args.length === 0)
        return globalRegistry.get(this);
      const cl = this.clone();
      globalRegistry.add(cl, args[0]);
      return cl;
    },
    isOptional() {
      return this.safeParse(void 0).success;
    },
    isNullable() {
      return this.safeParse(null).success;
    },
    apply(fn) {
      return fn(this);
    }
  });
  Object.defineProperty(inst, "description", {
    get() {
      return globalRegistry.get(inst)?.description;
    },
    configurable: true
  });
  return inst;
});
const _ZodString = /* @__PURE__ */ $constructor("_ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json);
  const bag = inst._zod.bag;
  inst.format = bag.format ?? null;
  inst.minLength = bag.minimum ?? null;
  inst.maxLength = bag.maximum ?? null;
  _installLazyMethods(inst, "_ZodString", {
    regex(...args) {
      return this.check(/* @__PURE__ */ _regex(...args));
    },
    includes(...args) {
      return this.check(/* @__PURE__ */ _includes(...args));
    },
    startsWith(...args) {
      return this.check(/* @__PURE__ */ _startsWith(...args));
    },
    endsWith(...args) {
      return this.check(/* @__PURE__ */ _endsWith(...args));
    },
    min(...args) {
      return this.check(/* @__PURE__ */ _minLength(...args));
    },
    max(...args) {
      return this.check(/* @__PURE__ */ _maxLength(...args));
    },
    length(...args) {
      return this.check(/* @__PURE__ */ _length(...args));
    },
    nonempty(...args) {
      return this.check(/* @__PURE__ */ _minLength(1, ...args));
    },
    lowercase(params) {
      return this.check(/* @__PURE__ */ _lowercase(params));
    },
    uppercase(params) {
      return this.check(/* @__PURE__ */ _uppercase(params));
    },
    trim() {
      return this.check(/* @__PURE__ */ _trim());
    },
    normalize(...args) {
      return this.check(/* @__PURE__ */ _normalize(...args));
    },
    toLowerCase() {
      return this.check(/* @__PURE__ */ _toLowerCase());
    },
    toUpperCase() {
      return this.check(/* @__PURE__ */ _toUpperCase());
    },
    slugify() {
      return this.check(/* @__PURE__ */ _slugify());
    }
  });
});
const ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  _ZodString.init(inst, def);
  inst.email = (params) => inst.check(/* @__PURE__ */ _email(ZodEmail, params));
  inst.url = (params) => inst.check(/* @__PURE__ */ _url(ZodURL, params));
  inst.jwt = (params) => inst.check(/* @__PURE__ */ _jwt(ZodJWT, params));
  inst.emoji = (params) => inst.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
  inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
  inst.uuid = (params) => inst.check(/* @__PURE__ */ _uuid(ZodUUID, params));
  inst.uuidv4 = (params) => inst.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
  inst.uuidv6 = (params) => inst.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
  inst.uuidv7 = (params) => inst.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
  inst.nanoid = (params) => inst.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
  inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
  inst.cuid = (params) => inst.check(/* @__PURE__ */ _cuid(ZodCUID, params));
  inst.cuid2 = (params) => inst.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
  inst.ulid = (params) => inst.check(/* @__PURE__ */ _ulid(ZodULID, params));
  inst.base64 = (params) => inst.check(/* @__PURE__ */ _base64(ZodBase64, params));
  inst.base64url = (params) => inst.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
  inst.xid = (params) => inst.check(/* @__PURE__ */ _xid(ZodXID, params));
  inst.ksuid = (params) => inst.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
  inst.ipv4 = (params) => inst.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
  inst.ipv6 = (params) => inst.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
  inst.cidrv4 = (params) => inst.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
  inst.cidrv6 = (params) => inst.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
  inst.e164 = (params) => inst.check(/* @__PURE__ */ _e164(ZodE164, params));
  inst.datetime = (params) => inst.check(datetime(params));
  inst.date = (params) => inst.check(date(params));
  inst.time = (params) => inst.check(time(params));
  inst.duration = (params) => inst.check(duration(params));
});
function string(params) {
  return /* @__PURE__ */ _string(ZodString, params);
}
const ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  _ZodString.init(inst, def);
});
const ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
  $ZodEmail.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
  $ZodGUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
  $ZodUUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
  $ZodURL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
  $ZodEmoji.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
  $ZodNanoID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
  $ZodCUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
  $ZodCUID2.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
  $ZodULID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
  $ZodXID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
  $ZodKSUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
  $ZodIPv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
  $ZodIPv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
  $ZodCIDRv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
  $ZodCIDRv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
  $ZodBase64.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
  $ZodBase64URL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
  $ZodE164.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
  $ZodJWT.init(inst, def);
  ZodStringFormat.init(inst, def);
});
const ZodNumber = /* @__PURE__ */ $constructor("ZodNumber", (inst, def) => {
  $ZodNumber.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json);
  _installLazyMethods(inst, "ZodNumber", {
    gt(value, params) {
      return this.check(/* @__PURE__ */ _gt(value, params));
    },
    gte(value, params) {
      return this.check(/* @__PURE__ */ _gte(value, params));
    },
    min(value, params) {
      return this.check(/* @__PURE__ */ _gte(value, params));
    },
    lt(value, params) {
      return this.check(/* @__PURE__ */ _lt(value, params));
    },
    lte(value, params) {
      return this.check(/* @__PURE__ */ _lte(value, params));
    },
    max(value, params) {
      return this.check(/* @__PURE__ */ _lte(value, params));
    },
    int(params) {
      return this.check(int(params));
    },
    safe(params) {
      return this.check(int(params));
    },
    positive(params) {
      return this.check(/* @__PURE__ */ _gt(0, params));
    },
    nonnegative(params) {
      return this.check(/* @__PURE__ */ _gte(0, params));
    },
    negative(params) {
      return this.check(/* @__PURE__ */ _lt(0, params));
    },
    nonpositive(params) {
      return this.check(/* @__PURE__ */ _lte(0, params));
    },
    multipleOf(value, params) {
      return this.check(/* @__PURE__ */ _multipleOf(value, params));
    },
    step(value, params) {
      return this.check(/* @__PURE__ */ _multipleOf(value, params));
    },
    finite() {
      return this;
    }
  });
  const bag = inst._zod.bag;
  inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
  inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
  inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? 0.5);
  inst.isFinite = true;
  inst.format = bag.format ?? null;
});
function number(params) {
  return /* @__PURE__ */ _number(ZodNumber, params);
}
const ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def);
  ZodNumber.init(inst, def);
});
function int(params) {
  return /* @__PURE__ */ _int(ZodNumberFormat, params);
}
const ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unknownProcessor();
});
function unknown() {
  return /* @__PURE__ */ _unknown(ZodUnknown);
}
const ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json);
});
function never(params) {
  return /* @__PURE__ */ _never(ZodNever, params);
}
const ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  $ZodArray.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
  inst.element = def.element;
  _installLazyMethods(inst, "ZodArray", {
    min(n, params) {
      return this.check(/* @__PURE__ */ _minLength(n, params));
    },
    nonempty(params) {
      return this.check(/* @__PURE__ */ _minLength(1, params));
    },
    max(n, params) {
      return this.check(/* @__PURE__ */ _maxLength(n, params));
    },
    length(n, params) {
      return this.check(/* @__PURE__ */ _length(n, params));
    },
    unwrap() {
      return this.element;
    }
  });
});
function array(element, params) {
  return /* @__PURE__ */ _array(ZodArray, element, params);
}
const ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
  $ZodObjectJIT.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
  defineLazy(inst, "shape", () => {
    return def.shape;
  });
  _installLazyMethods(inst, "ZodObject", {
    keyof() {
      return _enum(Object.keys(this._zod.def.shape));
    },
    catchall(catchall) {
      return this.clone({ ...this._zod.def, catchall });
    },
    passthrough() {
      return this.clone({ ...this._zod.def, catchall: unknown() });
    },
    loose() {
      return this.clone({ ...this._zod.def, catchall: unknown() });
    },
    strict() {
      return this.clone({ ...this._zod.def, catchall: never() });
    },
    strip() {
      return this.clone({ ...this._zod.def, catchall: void 0 });
    },
    extend(incoming) {
      return extend(this, incoming);
    },
    safeExtend(incoming) {
      return safeExtend(this, incoming);
    },
    merge(other) {
      return merge(this, other);
    },
    pick(mask) {
      return pick(this, mask);
    },
    omit(mask) {
      return omit(this, mask);
    },
    partial(...args) {
      return partial(ZodOptional, this, args[0]);
    },
    required(...args) {
      return required(ZodNonOptional, this, args[0]);
    }
  });
});
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...normalizeParams(params)
  };
  return new ZodObject(def);
}
const ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
  inst.options = def.options;
});
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...normalizeParams(params)
  });
}
const ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
const ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json);
  inst.enum = def.entries;
  inst.options = Object.values(def.entries);
  const keys = new Set(Object.keys(def.entries));
  inst.extract = (values, params) => {
    const newEntries = {};
    for (const value of values) {
      if (keys.has(value)) {
        newEntries[value] = def.entries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries
    });
  };
  inst.exclude = (values, params) => {
    const newEntries = { ...def.entries };
    for (const value of values) {
      if (keys.has(value)) {
        delete newEntries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...normalizeParams(params)
  });
}
const ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  $ZodTransform.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx);
  inst._zod.parse = (payload, _ctx) => {
    if (_ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    payload.addIssue = (issue$1) => {
      if (typeof issue$1 === "string") {
        payload.issues.push(issue(issue$1, payload.value, def));
      } else {
        const _issue = issue$1;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = inst);
        payload.issues.push(issue(_issue));
      }
    };
    const output = def.transform(payload.value, payload);
    if (output instanceof Promise) {
      return output.then((output2) => {
        payload.value = output2;
        payload.fallback = true;
        return payload;
      });
    }
    payload.value = output;
    payload.fallback = true;
    return payload;
  };
});
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
const ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
const ZodExactOptional = /* @__PURE__ */ $constructor("ZodExactOptional", (inst, def) => {
  $ZodExactOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
  return new ZodExactOptional({
    type: "optional",
    innerType
  });
}
const ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
const ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
const ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
const ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...normalizeParams(params)
  });
}
const ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
  });
}
const ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
  inst.in = def.in;
  inst.out = def.out;
});
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
    // ...util.normalizeParams(params),
  });
}
const ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
const ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx);
});
function refine(fn, _params = {}) {
  return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
  return /* @__PURE__ */ _superRefine(fn, params);
}
class InMemoryEmbeddingStore {
  entries = [];
  add(vector, segment) {
    const id = crypto.randomUUID();
    this.entries.push({ id, vector, segment });
    return id;
  }
  addAll(items) {
    return items.map((item) => this.add(item.vector, item.segment));
  }
  allSegments() {
    return this.entries.map((e) => e.segment).filter(Boolean);
  }
  removeByExperienceId(experienceId) {
    const idStr = String(experienceId);
    this.entries = this.entries.filter((e) => e.segment.metadata?.experienceId !== idStr);
  }
  clear() {
    this.entries = [];
  }
  findRelevant(queryVector, maxResults, minScore) {
    return this.entries.map((e) => ({
      score: cosineScore(queryVector, e.vector),
      id: e.id,
      embedding: e.vector,
      segment: e.segment
    })).filter((m) => m.score >= minScore).sort((a, b) => b.score - a.score).slice(0, maxResults);
  }
  size() {
    return this.entries.length;
  }
}
function cosineScore(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
const embeddingStore = new InMemoryEmbeddingStore();
const MAX_RETRY = 3;
async function embed(text) {
  const list = await embedAll([text]);
  return list[0] ?? [];
}
async function embedAll(texts) {
  if (!apiConfig.isEmbeddingConfigured()) {
    throw new Error("Embedding API Key 未配置。请在前端「设置」页填入,或设置环境变量 EMBEDDING_API_KEY。");
  }
  if (!texts.length) return [];
  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      return await doRequest(texts);
    } catch (e) {
      lastErr = e;
      const status = e?.status ?? e?.response?.status;
      if (status === 429 && attempt < MAX_RETRY) {
        await sleepBackoff(attempt, "429 限流");
        continue;
      }
      if (status >= 500 && attempt < MAX_RETRY) {
        await sleepBackoff(attempt, `${status} 服务端错误`);
        continue;
      }
      throw new Error(`Embedding 调用失败: ${e?.message ?? e}`);
    }
  }
  throw new Error(`Embedding 调用失败(重试耗尽): ${lastErr?.message ?? "unknown"}`);
}
async function doRequest(texts) {
  const baseUrl = apiConfig.embeddingBaseUrl.replace(/\/$/, "");
  const url = baseUrl.endsWith("/embeddings") ? baseUrl : `${baseUrl}/embeddings`;
  const body = {
    model: apiConfig.embeddingModel,
    input: texts.length === 1 ? texts[0] : texts
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiConfig.embeddingApiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = new Error(`Embedding HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const items = data?.data ?? [];
  if (!items.length) throw new Error("Embedding 返回无 data");
  items.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return items.map((m) => {
    const vec = m.embedding ?? [];
    return vec;
  });
}
function sleepBackoff(attempt, reason) {
  const backoff = 1e3 * Math.pow(2, attempt);
  console.warn(`Embedding ${reason},${backoff}ms 后重试(第${attempt + 1}次)`);
  return new Promise((r) => setTimeout(r, backoff));
}
const MAX_CHARS_PER_CHUNK = 800;
const MAX_CHUNKS_PER_EXPERIENCE = 2;
const THROTTLE_MS = 500;
const TYPE_OVERVIEW = "总述";
const TYPE_INTERNSHIP = "实习";
const TYPE_PROJECT = "项目";
const TYPE_BAGU_JAVA = "八股_Java";
const TYPE_BAGU_AI = "八股_AI";
const TYPE_ALGORITHM = "算法";
function buildChunks(exp) {
  const list = [];
  const company = exp.company ?? "";
  const dept = exp.department ?? "";
  const pos = exp.position ?? "";
  const overview = `公司: ${company}
部门: ${dept}
岗位: ${pos}
内容: ${exp.content ?? ""}`;
  if (overview.trim()) list.push({ text: overview, type: TYPE_OVERVIEW });
  if (exp.internshipExperiences?.trim())
    list.push({ text: `公司: ${company}
部门: ${dept}
实习经历: ${exp.internshipExperiences}`, type: TYPE_INTERNSHIP });
  if (exp.projectExperiences?.trim())
    list.push({ text: `公司: ${company}
部门: ${dept}
项目经历: ${exp.projectExperiences}`, type: TYPE_PROJECT });
  if (exp.projectExperience?.trim())
    list.push({ text: `公司: ${company}
部门: ${dept}
项目经历: ${exp.projectExperience}`, type: TYPE_PROJECT });
  if (exp.baguQuestions?.trim())
    list.push({ text: `公司: ${company}
部门: ${dept}
八股: ${exp.baguQuestions}`, type: TYPE_BAGU_JAVA });
  if (exp.llmQuestions?.trim())
    list.push({ text: `公司: ${company}
部门: ${dept}
大模型八股: ${exp.llmQuestions}`, type: TYPE_BAGU_AI });
  if (exp.algorithmQuestions?.trim()) {
    let algo = `公司: ${company}
部门: ${dept}
算法题: ${exp.algorithmQuestions}`;
    if (exp.algorithmLink?.trim()) algo += `
算法原题链接: ${exp.algorithmLink}`;
    list.push({ text: algo, type: TYPE_ALGORITHM });
  }
  return list;
}
function truncate(text) {
  if (text.length > MAX_CHARS_PER_CHUNK) return text.slice(0, MAX_CHARS_PER_CHUNK) + "...";
  return text;
}
async function indexExperience(exp) {
  if (exp.id != null) embeddingStore.removeByExperienceId(exp.id);
  const chunks = buildChunks(exp);
  const segments = chunks.filter((c) => c.text && c.text.trim()).map((c) => ({
    text: truncate(c.text),
    metadata: {
      experienceId: exp.id != null ? String(exp.id) : "",
      company: exp.company ?? "",
      department: exp.department ?? "",
      type: c.type
    }
  }));
  if (!segments.length) return;
  let vectors;
  try {
    vectors = await embedAll(segments.map((s) => s.text));
  } catch (batchErr) {
    console.warn("批量 embedding 失败,降级逐条:", batchErr);
    vectors = [];
    for (const seg of segments) {
      try {
        vectors.push(await embed(seg.text));
      } catch (e) {
        console.error("逐条 embed 失败,跳过:", e);
      }
    }
  }
  for (let i = 0; i < vectors.length && i < segments.length; i++) {
    embeddingStore.add(vectors[i], segments[i]);
  }
}
async function indexExperiences(experiences) {
  for (let i = 0; i < experiences.length; i++) {
    await indexExperience(experiences[i]);
    if (i < experiences.length - 1) await new Promise((r) => setTimeout(r, THROTTLE_MS));
  }
}
function clearAll() {
  embeddingStore.clear();
}
function storeSize() {
  return embeddingStore.size();
}
function tokenize(q) {
  if (!q) return [];
  const cleaned = q.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const parts = cleaned.split(/[\s,，;；/|]+/);
  return parts.map((p) => p.trim()).filter((t) => t.length >= 2);
}
function keywordScore(tokens, seg) {
  if (!tokens.length || !seg) return 0;
  const text = seg.text ?? "";
  const company = seg.metadata?.company ?? "";
  const dept = seg.metadata?.department ?? "";
  const type = seg.metadata?.type ?? "";
  const hay = `${company} ${dept} ${type} ${text}`.toLowerCase();
  let hit = 0;
  for (const t of tokens) {
    if (hay.includes(t.toLowerCase())) hit++;
  }
  return tokens.length ? hit / tokens.length : 0;
}
async function search(query, company, department, maxResults) {
  const tokens = tokenize(query);
  const queryVec = await embed(query);
  const fetchN = Math.max(maxResults * 3, 20);
  const vecMatches = embeddingStore.findRelevant(queryVec, fetchN, 0.4);
  const all = embeddingStore.allSegments();
  const keywordHits = [];
  if (tokens.length && all.length) {
    for (const seg of all) {
      const ks = keywordScore(tokens, seg);
      if (ks <= 0) continue;
      keywordHits.push({ score: 0.35 + ks * 0.25, seg });
    }
  }
  const merged = /* @__PURE__ */ new Map();
  const key = (seg) => `${seg.metadata?.experienceId ?? ""}:${seg.text.slice(0, 40)}`;
  for (const m of vecMatches) {
    const seg = m.segment;
    if (!seg) continue;
    const s = m.score + keywordScore(tokens, seg) * 0.25;
    const k = key(seg);
    const prev = merged.get(k)?.score ?? 0;
    merged.set(k, { score: Math.max(prev, s), seg });
  }
  for (const h of keywordHits) {
    const k = key(h.seg);
    const prev = merged.get(k)?.score ?? 0;
    merged.set(k, { score: Math.max(prev, h.score), seg: h.seg });
  }
  const candidates = [...merged.values()].sort((a, b) => b.score - a.score);
  const expCount = /* @__PURE__ */ new Map();
  const result = [];
  for (const { seg } of candidates) {
    if (!seg.metadata) continue;
    if (company) {
      const c = seg.metadata.company;
      if (!c || company !== c) continue;
    }
    if (department) {
      const d = seg.metadata.department;
      if (!d || department !== d) continue;
    }
    const eid = seg.metadata.experienceId ?? "";
    const cnt = expCount.get(eid) ?? 0;
    if (cnt >= MAX_CHUNKS_PER_EXPERIENCE) continue;
    expCount.set(eid, cnt + 1);
    result.push(seg.text);
    if (result.length >= maxResults) break;
  }
  return result;
}
const PISTON_URL = "https://emkc.org/api/v2/piston";
const LANG_MAP = {
  java: "java",
  python: "python",
  python3: "python",
  go: "go",
  javascript: "javascript",
  js: "javascript",
  cpp: "c++",
  c: "c"
};
async function executeCodeRemote(language, code, stdin, acmMode) {
  const lang = LANG_MAP[language.toLowerCase()];
  if (!lang) return { success: false, output: "", error: `不支持的语言: ${language}` };
  const body = {
    language: lang,
    version: "*",
    files: [{ name: "main", content: code }],
    stdin: stdin || "",
    compile_timeout: 1e4,
    run_timeout: 5e3
  };
  const res = await fetch(PISTON_URL + "/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) return { success: false, output: "", error: `Piston HTTP ${res.status}` };
  const data = await res.json();
  const run = data?.run ?? {};
  const compile = data?.compile;
  if (compile?.code && compile.code !== 0) {
    return { success: false, output: "", error: compile.stderr || compile.output || "编译失败" };
  }
  const out = (run.stdout || "") + (run.stderr ? `
${run.stderr}` : "");
  if (run.code === 0) return { success: true, output: out };
  return { success: false, output: out, error: `退出码 ${run.code}` };
}
const APP_BASE_URL = "";
const searchInterviewsTool = tool(
  async ({ query, company, department }) => {
    const results = await search(query, company || null, department || null, 8);
    if (!results.length) return "未检索到相关面经。";
    return results.map((r, i) => `[片段${i + 1}]
${r}`).join("\n\n");
  },
  {
    name: "searchInterviews",
    description: "按公司或部门检索面经内容。当用户想查某公司/部门的面经、面试题、八股时调用。company 和 department 可为空表示不限定。",
    schema: object({
      query: string().describe("检索关键词"),
      company: string().optional().describe("公司名,可空"),
      department: string().optional().describe("部门名,可空")
    })
  }
);
const interviewHotTopicsTool = tool(
  async ({ company, department }) => {
    let exps;
    if (company && department) exps = interviewExperienceRepo.findByCompanyAndDepartment(company, department);
    else if (company) exps = interviewExperienceRepo.findByCompany(company);
    else exps = interviewExperienceRepo.findAll();
    if (!exps.length) return "暂无该公司的面经数据。";
    const topicCount = /* @__PURE__ */ new Map();
    for (const e of exps) {
      for (const f of [e.baguQuestions, e.llmQuestions, e.algorithmQuestions]) {
        if (!f) continue;
        for (const line of f.split("\n")) {
          const t = line.replace(/^[•\-\d.]+\s*/, "").split(/[:：]/)[0].trim();
          if (t) topicCount.set(t, (topicCount.get(t) ?? 0) + 1);
        }
      }
    }
    const sorted = [...topicCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    if (!sorted.length) return "暂未提取到高频考点。";
    return sorted.map(([t, n]) => `${t}(${n}次)`).join("、");
  },
  {
    name: "interviewHotTopics",
    description: "生成面经高频考点统计。当用户问「这个公司高频考什么」「八股高频」时调用。company/department 可空。",
    schema: object({
      company: string().optional(),
      department: string().optional()
    })
  }
);
const listAlgorithmQuestionsTool = tool(
  async ({ difficulty }) => {
    let list;
    if (difficulty) list = algorithmRepo.findByDifficulty(difficulty);
    else list = algorithmRepo.findAll();
    if (!list.length) return "题库暂无题目。";
    const q = list[Math.floor(Math.random() * list.length)];
    const url = `${APP_BASE_URL}/#/ide?questionId=${q.id}`;
    return `已随机抽取: ${q.title}(${q.difficulty ?? "medium"})
做题链接: ${url}`;
  },
  {
    name: "listAlgorithmQuestions",
    description: "获取题库中的算法题列表。可选按难度筛选:easy/medium/hard。当用户要「一道算法题」「来道题」时调用;未指定难度则随机抽取一道并返回本站在线 IDE 链接。",
    schema: object({
      difficulty: string().optional().describe("easy/medium/hard,可空")
    })
  }
);
const findAlgorithmQuestionByTitleTool = tool(
  async ({ title }) => {
    const list = algorithmRepo.findByTitleContainingIgnoreCase(title);
    if (list.length) {
      const q = list[0];
      const url = `${APP_BASE_URL}/#/ide?questionId=${q.id}`;
      return `已查到: ${q.title}(${q.difficulty ?? "medium"})
做题链接: ${url}`;
    }
    return `本站题库无「${title}」。力扣搜索: https://leetcode.cn/problemset/all/?search=${encodeURIComponent(title)}`;
  },
  {
    name: "findAlgorithmQuestionByTitle",
    description: "根据题目标题或关键词查找一道算法题。本站有则返回题目详情与本站 IDE 链接(一条 URL);无则返回力扣搜索链接。用户说具体题名时必须调用。链接只输出原始 URL,严禁 HTML 标签、target/rel、严禁输出两遍。",
    schema: object({
      title: string().describe("题目标题或关键词")
    })
  }
);
const getAlgorithmQuestionByIdTool = tool(
  async ({ questionId }) => {
    const q = algorithmRepo.findById(questionId);
    if (!q) return `未找到 ID 为 ${questionId} 的题目。`;
    const url = `${APP_BASE_URL}/#/ide?questionId=${q.id}`;
    return `第${questionId}题: ${q.title}(${q.difficulty ?? "medium"})
做题链接: ${url}`;
  },
  {
    name: "getAlgorithmQuestionById",
    description: "根据题目 ID 获取一道算法题详情。仅当用户明确说「第几题」「ID 为 x」时调用。链接只输出原始 URL。",
    schema: object({
      questionId: number().describe("题目 ID")
    })
  }
);
const runCodeTool = tool(
  async ({ language, code }) => {
    const result = await executeCodeRemote(language, code, "");
    return result.success ? `运行成功:
${result.output}` : `运行失败:
${result.error ?? result.output}`;
  },
  {
    name: "runCode",
    description: "运行一段代码并返回执行结果。language 支持:java,python,go,javascript,cpp。code 为源代码字符串。",
    schema: object({
      language: string().describe("java/python/go/javascript/cpp"),
      code: string().describe("源代码")
    })
  }
);
const allTools = [
  searchInterviewsTool,
  interviewHotTopicsTool,
  listAlgorithmQuestionsTool,
  findAlgorithmQuestionByTitleTool,
  getAlgorithmQuestionByIdTool,
  runCodeTool
];
const DEEP_QUESTIONS_SYSTEM = `你是一位资深互联网后端技术面试官，会根据候选人简历与目标公司面经，设计有深度、有区分度的面试问题。
要求：1. 问题须与候选人简历项目强相关；2. 覆盖项目深挖、系统设计、八股基础、算法；3. 每题给出考察意图。
输出：纯 JSON 数组，每项含 question(问题)、intent(考察意图)、category(分类)。`;
const REPLAY_SYSTEM = `你是面试复盘专家，分析用户提供的面经，判断其考察侧重点、难易程度，并给出针对性准备建议。
若用户提供了自己的回答，则评估回答质量并给出改进建议。`;
const CHAT_SESSION_SYSTEM = `你是 sspOffer AI 面试官，与候选人进行模拟面试对话。
根据已有面经和候选人简历，提出有深度的问题，评估回答，引导深入。
保持专业、友好，用中文交流。

## 可用工具（Function Calling）
你可以调用以下工具，无需在回复里写死答案：
1. searchInterviews：按公司/部门/关键词检索面经（候选人问『字节后端面经怎么准备』时调）
2. interviewHotTopics：统计某公司/部门高频考点
3. listAlgorithmQuestions：列出题库或随机一道
4. findAlgorithmQuestionByTitle：候选人提到具体题名（『反转链表』『两数之和』）时必须调
5. getAlgorithmQuestionById：候选人明确说第几题/ID 时
6. runCode：候选人贴出代码时调，给运行结果

## 何时调用工具
- 候选人问『查一下XX面经』『XX高频考点』→ searchInterviews / interviewHotTopics
- 候选人说『给我一道算法题』『来道题』→ listAlgorithmQuestions
- 候选人提具体题名 → findAlgorithmQuestionByTitle（必须）
- 候选人贴代码想运行 → runCode
- 候选人正常回答面试问题（不需要查资料/题库）→ 不要调工具，直接追问或点评

## 输出要求
- 工具返回的链接必须原样输出，禁止修改或省略
- 用中文、简洁、专业
- 一次只问一个问题，等候选人回答`;
const TOOLS_ASSISTANT_SYSTEM = `角色：你是 sspOffer 面经助手，可以根据用户意图使用以下工具后回答。
工具：1. searchInterviews：按公司/部门/关键词检索面经；2. interviewHotTopics：统计公司/部门的高频考点；3. listAlgorithmQuestions：列出题库或随机一道题；4. findAlgorithmQuestionByTitle：根据题目标题或关键词查找（用户说「我要搜索插入位置」「给我反转链表」等具体题名时必须调用）；5. getAlgorithmQuestionById：仅当用户明确说「第几题」「ID 为 x」时用；6. runCode：运行用户提供的代码并返回结果。
规则：查面经时先调用 searchInterviews；要「一道算法题」「来道题」时调用 listAlgorithmQuestions；指定具体题名时必须调用 findAlgorithmQuestionByTitle(该题名)。若题目在本站题库：只输出本站在线 IDE 链接（app.base-url/ide?questionId=数字）；若不在本站：只原样输出工具返回的一条力扣/搜索链接。工具返回的 URL 必须原样、完整放入回复，只输出纯 URL 或 Markdown [题目](URL)，禁止在链接前后添加任何 HTML（target、rel、引号、> 等）。必须输出链接时不可省略。运行代码时调用 runCode 后根据结果一句话说明成功或失败。
格式：用中文，简洁友好；若调用了查题工具，先简要说明「已查到」，再在回复末尾保留可点击的链接（仅一条）。
查面经排版：先一句引言，再按考点类别分段，每类用一个 ### 小节标题并独占一段（如 ### 📌 项目深挖、### 💻 算法题、### 📚 八股重点、### 📊 高频考点），类别之间用单独一行 --- 分隔；算法题与八股各自独立成段，严禁合并进同一个列表；八股每个考点单独成行、考点名加粗，如「- **Kafka 原理**：消息模型、分区机制、可靠性」。最后一句收尾。
禁止：禁止将链接放入 HTML 标签；禁止编造牛客、codeforces 等链接；禁止错误路径导致 404。`;
const IMAGE_PARSE_PROMPT = `这是一张面经图片，请按下面的规则完整提取全部内容并返回 JSON。要求逐条识别图中的每一道题/每一条要点/每一段描述，不得遗漏、不得合并、不得改写题意；图中共有 N 条知识项时，各字段合计应 ≥ N。

包含以下字段（若无内容填空字符串或空数组）：
{
  "company": "公司名",
  "department": "部门",
  "position": "岗位名（保留完整，如 Product Engineer-产品工程师（AI 应用方向））",
  "type": "校招/社招/实习",
  "internshipExperiences": ["实习经历1：公司/岗位/时间/职责（只放描述，不放提问）", ...],
  "projectExperiences": ["项目经历1：名称/技术栈/职责（只放描述，不放提问）", ...],
  "baguQuestions": "传统计算机八股题目，每题单独一行，**每行必须带【分块名】前缀**",
  "llmQuestions": "AI/大模型/Agent/RAG/LangChain/MCP/Tool Calling/Skill/Spring AI 等相关题目，每题单独一行，每行必须带【分块名】前缀",
  "algorithmQuestions": "需要手写代码/写思路的具体算法/系统设计题，每题单独一行，每行必须带【分块名】前缀",
  "algorithmLink": "力扣或原题链接（若无则空）",
  "content": "面经整体概要（流程、轮次、难度、通过情况、元信息，如『项目只问了 RAG 部分』『手撕未跑通，思路讲解通过』）"
}

### 一、严格分类规则

【baguQuestions】传统计算机基础/八股，包括但不限于：
- 数据库（MySQL/Redis/事务/隔离级别/索引/B+树/InnoDB/缓冲池/锁/日志 等）
- Java 基础（多态/继承/接口/集合/并发/泛型/反射/异常/JVM/GC/内存模型/类加载/线程池 等）
- 计算机网络（HTTP/HTTPS/TCP 握手挥手/CDN/DNS/IO 模型/拥塞控制 等）
- 操作系统（进程线程/内存管理/调度/虚拟内存/IO/中断/协程 等）
- 数据结构与算法基础概念题——凡是以「什么是/简述/解释/区别/原理/为什么/优劣」开头，或要求描述算法思想、时间复杂度、适用场景的，全部归入 baguQuestions。
  - 典型例子：什么是动态规划？什么是贪心？动态规划与贪心的区别？二分查找原理？哈希表如何解决冲突？红黑树与 B+ 树的区别？快速排序的时空复杂度？什么是对数时间？等等
- 计算机组成原理、网络安全、消息队列、分布式理论、设计模式等
- **禁止把这些概念辨析题放进 algorithmQuestions**，它们是八股，不是手撕题

【algorithmQuestions】需要面试者当场手写代码/写思路的具体编码题，特征：
- 给出明确的题面（输入输出、样例、约束、时间/空间复杂度要求）
- 通常以「手撕」「写一下」「用代码实现」「让实现一个」开头或独立成题
- 例子：「K 个一组翻转链表」「LRU 缓存」「岛屿最大面积」「反转链表 II」「二分查找」「接雨水」「最小生成树」「topK」等
- **只有真正要求写代码的具体题才放这里**，不带题面的概念题一律归入 baguQuestions

【llmQuestions】AI/大模型/Agent/RAG/LangChain/MCP/Tool Calling/Skill/Spring AI 等相关问题，以及对 AI 项目的深挖提问（例如 RAG 召回策略、Agent 工具调用、向量化、重排序、prompt 工程、模型评估 等）。

【internshipExperiences / projectExperiences】只放经历描述本身（公司/岗位/时间/职责/技术栈），不含提问。

【content】整体面经的元信息：流程、轮次、是否通过、难度、感受、注意点，例如「项目部分只问了 RAG」「手撕核心代码难度不大，main 未包在类里没跑起来，最后讲解思路通过」。

### 二、分块标签规则（必须保留图中的分块标题）

图中通常会有类似「八股：」「数据库：」「Java 虚拟机（JVM）：」「Java 基础：」「算法与数据结构：」「计算机网络：」「操作系统：」「手撕代码：」「项目深挖：」等分块标题。**必须保留这些分块**，否则用户无法按模块查看。具体规则：

1. 在每条题目前添加内联分类标签，格式为「【分块名】题目正文」。
2. 每个分块首次出现时另外单独占一行输出一份「【分块名】」，作为分块标题（便于按块聚合显示）。
3. 题目里也要保留分类前缀，即下面的示例风格。
4. 算法题如果原文属于「手撕」「算法与数据结构」「系统设计」等子分类，也必须加【xxx】前缀，统一放进 algorithmQuestions。
5. 八股相关题目统一在**原分类**下加前缀，例如「数据库」的所有题目统一加【数据库】前缀，「Java 虚拟机（JVM）」统一加【Java 虚拟机（JVM）】前缀。
6. llmQuestions 同样按分块加【xxx】前缀。

示例（仅作格式示例，不是答案）：
【数据库】
【数据库】数据库事务是什么意思？请具体说明
【数据库】读视图的具体实现是什么？
【数据库】MySQL 中事务是如何实现的？
【数据库】MySQL 中的索引类型有哪些？
【数据库】MySQL 支持哪些存储引擎？
【数据库】InnoDB 引擎的底层数据结构是什么？为什么使用 B+ 树？
【Java 虚拟机（JVM）】
【Java 虚拟机（JVM）】了解过虚拟机或垃圾回收机制吗？
【Java 虚拟机（JVM）】JVM 的内存分配是怎么做的？（提到了运行时内存区）
【算法与数据结构】
【算法与数据结构】什么是动态规划？它用来解决什么样的问题？
【算法与数据结构】什么是贪心算法？
【算法与数据结构】动态规划和贪心算法的区别是什么？
【Java 基础】
【Java 基础】在代码中如何实现多态？
【Java 基础】除了继承和接口，还有其他实现多态的方法吗？
【手撕算法】
【手撕算法】K 个一组反转链表。核心代码部分难度不大，main 方法没包在类里面没跑起来，最后给面试官讲了讲思路结束。

### 三、硬性格式要求

1. 每条题目/要点必须原样逐条保留，禁止省略、合并或概括；宁可多列也不漏列。
2. baguQuestions、llmQuestions、algorithmQuestions 均为字符串：每条独立占一行，行内用「【分块名】题目正文」格式，条目之间用 
 分隔，绝不合并。
3. 严格遵守分类规则：算法概念/原理题 → baguQuestions；只有需要写代码的具体题才 → algorithmQuestions。
4. 不在多字词中间插入空格；不输出无意义的竖线、连续省略号等无关符号；保留中文标点。
5. 若图中没有某个分类，返回该字段为空字符串（baguQuestions/llmQuestions/algorithmQuestions/content/algorithmLink）或空数组（internshipExperiences/projectExperiences）。
6. 经历字段不要放过任何「实习/项目」段落；但不要把八股/算法题混进经历字段。

只返回 JSON，不要任何额外说明、Markdown 代码块或前言。`;
const RESUME_PARSE_PROMPT = `这是一份简历的图片，请识别并提取其中的全部文字内容。
保持原有的格式和结构（如教育经历、项目经历、技能等分段）。
只返回提取的文本内容，不要添加任何说明或解释。`;
const MASTERY_DIAGNOSE_SYSTEM = `你是资深技术导师，根据候选人对底层概念探测性问题的回答，判定其掌握程度。
每个概念判定为以下之一：
- solid：理解深入，能说清原理和权衡
- shallow：表面了解，缺乏深度
- unknown：不了解或答错
同时给出：
- gap：知识缺口描述（如掌握则填"无明显缺口"）
- drillSuggestion：补强建议（如掌握则填"保持"）
输出纯 JSON：
{
  "summary": "整体评价摘要",
  "assessments": [{ "concept": "", "level": "solid|shallow|unknown", "gap": "", "drillSuggestion": "" }],
  "weakFocus": ["薄弱概念1", "薄弱概念2"]
}`;
const INTERVIEW_REPORT_SYSTEM = `你是面试评估专家，根据模拟面试的完整对话记录，给出评估报告。
分析候选人的回答质量，覆盖以下维度：
1. 技术深度：回答是否触及底层原理
2. 表达清晰度：STAR 结构是否完整
3. 知识盲区：哪些概念未答好或答错
4. 改进建议：针对性的提升方向

输出纯 JSON：
{
  "overallScore": 85,
  "summary": "整体表现摘要（2-3句话）",
  "strengths": ["亮点1", "亮点2"],
  "weaknesses": ["不足1", "不足2"],
  "improvements": ["改进建议1", "改进建议2"],
  "topicScores": [{ "topic": "Redis缓存", "score": 90, "comment": "理解深入" }]
}`;
const TOOL_TOOLS = allTools;
async function chatWithTools(userMessage) {
  if (!userMessage?.trim()) {
    return "请输入您的问题,例如:查一下字节后端的面经、给我一道中等难度的算法题、运行这段 Java 代码。";
  }
  const msg = userMessage.trim();
  if (isAlgorithmQuery(msg)) return handleAlgorithmQuery(msg);
  const harness = new AgentHarness({
    systemPrompt: TOOLS_ASSISTANT_SYSTEM,
    tools: TOOL_TOOLS,
    maxIterations: 6
  });
  return harness.run(msg);
}
async function* chatWithToolsStream(userMessage) {
  if (!userMessage?.trim()) {
    yield { type: "done", data: { text: "请输入您的问题。" } };
    return;
  }
  const msg = userMessage.trim();
  if (isAlgorithmQuery(msg)) {
    const text = handleAlgorithmQuery(msg);
    yield { type: "delta", data: { text } };
    yield { type: "done", data: { text } };
    return;
  }
  const harness = new AgentHarness({
    systemPrompt: TOOLS_ASSISTANT_SYSTEM,
    tools: TOOL_TOOLS,
    maxIterations: 6
  });
  for await (const ev of harness.stream(msg)) {
    yield ev;
  }
}
async function chatWithSession(sessionId, userMessage, context) {
  const { history, numericId, nextSort, session: session2 } = await loadSession(sessionId, context);
  if (!userMessage?.trim()) return "请输入您的回答。";
  chatSessionRepo.addMessage({ sessionId: numericId, role: "user", content: userMessage, sortOrder: nextSort });
  const harness = new AgentHarness({
    systemPrompt: buildInterviewerSystemPrompt(context),
    tools: TOOL_TOOLS,
    maxIterations: 6,
    maxContextTokens: 6e3,
    maxHistoryMessages: 20
  });
  const reply = await harness.run(userMessage, history);
  chatSessionRepo.addMessage({ sessionId: numericId, role: "assistant", content: reply, sortOrder: nextSort + 1 });
  if (session2 && (!session2.resume || !session2.company)) {
    chatSessionRepo.updateFields(session2.id, {
      resume: context?.resume ?? null,
      company: context?.company ?? null,
      department: context?.department ?? null,
      questions: context?.questions ?? null
    });
  }
  return reply;
}
async function* chatWithSessionStream(sessionId, userMessage, context) {
  const { history, numericId, nextSort, session: session2 } = await loadSession(sessionId, context);
  if (!userMessage?.trim()) {
    yield { type: "done", data: { text: "请输入您的回答。" } };
    return;
  }
  chatSessionRepo.addMessage({ sessionId: numericId, role: "user", content: userMessage, sortOrder: nextSort });
  const harness = new AgentHarness({
    systemPrompt: buildInterviewerSystemPrompt(context),
    // 接通工具：面试官在对话中可调用面经检索/算法题/代码执行
    tools: TOOL_TOOLS,
    maxIterations: 6,
    maxContextTokens: 6e3,
    maxHistoryMessages: 20
  });
  let fullReply = "";
  for await (const ev of harness.stream(userMessage, history)) {
    if (ev.type === "delta") fullReply += ev.data.text;
    yield ev;
  }
  const finalText = fullReply || "抱歉，未能生成回复。";
  chatSessionRepo.addMessage({ sessionId: numericId, role: "assistant", content: finalText, sortOrder: nextSort + 1 });
  if (session2 && (!session2.resume || !session2.company)) {
    chatSessionRepo.updateFields(session2.id, {
      resume: context?.resume ?? null,
      company: context?.company ?? null,
      department: context?.department ?? null,
      questions: context?.questions ?? null
    });
  }
}
async function loadSession(sessionId, context) {
  let session2 = chatSessionRepo.findBySessionId(sessionId);
  if (!session2) {
    session2 = chatSessionRepo.create({
      sessionId,
      questions: context?.questions ?? null,
      resume: context?.resume ?? null,
      company: context?.company ?? null,
      department: context?.department ?? null
    });
  }
  const numericId = session2.id;
  const history = chatSessionRepo.findMessages(numericId);
  const recent = history.slice(-20);
  const nextSort = (history[history.length - 1]?.sortOrder ?? 0) + 1;
  const chatTurns = recent.map((m) => ({ role: m.role, content: m.content }));
  return { history: chatTurns, numericId, nextSort, session: session2 };
}
function buildInterviewerSystemPrompt(ctx) {
  let prompt = CHAT_SESSION_SYSTEM;
  if (ctx?.company || ctx?.department) {
    prompt += `

目标公司: ${ctx.company || "未指定"} / 部门: ${ctx.department || "未指定"}`;
  }
  if (ctx?.resume) {
    prompt += `

候选人简历摘要:
${ctx.resume.slice(0, 2e3)}`;
  }
  if (ctx?.questions) {
    prompt += `

参考面试题（可按此顺序提问，也可根据回答灵活调整）:
${ctx.questions}`;
  }
  prompt += `

面试规则:
1. 每次只问一个问题，等候选人回答后再追问或换题
2. 候选人回答后，先简短评价（正确/部分正确/需补强），再追问或转下一题
3. 追问要基于候选人回答中的薄弱点深入
4. 全程用中文，语气专业友好
5. 不要一次性输出所有问题`;
  return prompt;
}
function isAlgorithmQuery(message) {
  if (!message) return false;
  const m = message.trim().replace(/\s+/g, " ");
  if (m.length <= 25 && (m.includes("算法题") || m.includes("一道题"))) return true;
  return /(给|来|推荐).*(算法题|一道题|题目)/.test(m) || /(一道|来道).*题/.test(m) || m.includes("算法题") || m.includes("一道算法题");
}
function handleAlgorithmQuery(userQuery) {
  const keyword = extractKeyword(userQuery);
  if (keyword) {
    const list = algorithmRepo.findByTitleContainingIgnoreCase(keyword);
    if (list.length) {
      const q2 = list[0];
      return `已查到: ${q2.title}(${q2.difficulty ?? "medium"})
做题链接: /#/ide?questionId=${q2.id}`;
    }
    return `本站题库无「${keyword}」。
力扣搜索: https://leetcode.cn/problemset/all/?search=${encodeURIComponent(keyword)}`;
  }
  const all = algorithmRepo.findAll();
  if (!all.length) return "题库暂无题目。";
  const q = all[Math.floor(Math.random() * all.length)];
  return `已随机抽取: ${q.title}(${q.difficulty ?? "medium"})
做题链接: /#/ide?questionId=${q.id}`;
}
function extractKeyword(userQuery) {
  const s = userQuery.replace(/(给我|来一道|推荐一道|一道|的|算法题|查询|搜索|一下)/gi, " ").replace(/\s+/g, " ").trim();
  return s || "";
}
async function transcribeWithWhisper(audioBase64, mimeType, language = "zh") {
  if (!apiConfig.isSttConfigured()) {
    throw new Error("Whisper 未配置：请在设置页选择语音识别引擎为 OpenAI Whisper 并填入 API Key（可与 LLM Key 共用）");
  }
  const apiKey = apiConfig.sttApiKey;
  const baseUrl = apiConfig.sttBaseUrl.replace(/\/+$/, "");
  const model = apiConfig.sttModel;
  const url = `${baseUrl}/audio/transcriptions`;
  const buf = Buffer.from(audioBase64, "base64");
  const blob = new Blob([buf], { type: mimeType });
  const form = new FormData();
  form.append("file", blob, "audio." + (mimeType?.includes("mp4") ? "mp4" : mimeType?.includes("ogg") ? "ogg" : "webm"));
  form.append("model", model);
  form.append("language", language);
  form.append("response_format", "json");
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Whisper ${resp.status} ${resp.statusText}: ${errText.slice(0, 200)}`);
  }
  const json = await resp.json();
  return { text: (json?.text || "").trim() };
}
function registerIpc() {
  initSchema();
  ipcMain.handle(Channels.APPLICATION_LIST, () => applicationRepo.findAll());
  ipcMain.handle(Channels.APPLICATION_CREATE, (_e, a) => applicationRepo.create(a));
  ipcMain.handle(Channels.APPLICATION_UPDATE, (_e, id, a) => applicationRepo.update(id, a));
  ipcMain.handle(Channels.APPLICATION_DELETE, (_e, id) => {
    applicationRepo.remove(id);
    return true;
  });
  ipcMain.handle(Channels.ALGORITHM_LIST, (_e, filter) => {
    if (filter?.title) return algorithmRepo.findByTitleContainingIgnoreCase(filter.title);
    if (filter?.company) return algorithmRepo.findByCompany(filter.company);
    if (filter?.difficulty) return algorithmRepo.findByDifficulty(filter.difficulty);
    return algorithmRepo.findAll();
  });
  ipcMain.handle(Channels.ALGORITHM_GET, (_e, id) => algorithmRepo.findById(id));
  ipcMain.handle(Channels.ALGORITHM_CREATE, (_e, q) => algorithmRepo.create(q));
  ipcMain.handle(Channels.ALGORITHM_UPDATE, (_e, id, q) => algorithmRepo.update(id, q));
  ipcMain.handle(Channels.ALGORITHM_DELETE, (_e, id) => {
    algorithmRepo.remove(id);
    return true;
  });
}
ipcMain.handle(AI_CHANNELS.CHAT_WITH_TOOLS, async (_e, message) => {
  try {
    return { content: await chatWithTools(message) };
  } catch (e) {
    return { error: e?.message ?? "AI 调用失败" };
  }
});
ipcMain.handle(AI_CHANNELS.CHAT_WITH_SESSION, async (_e, sessionId, message, context) => {
  try {
    const reply = await chatWithSession(sessionId, message, context);
    return { reply, content: reply };
  } catch (e) {
    return { error: e?.message ?? "AI 调用失败" };
  }
});
function getSender(e) {
  const wc = e.sender;
  return (type, data) => wc.send(AI_CHANNELS.CHAT_STREAM, { type, data });
}
ipcMain.handle(AI_CHANNELS.CHAT_STREAM, async (e, message) => {
  const push = getSender(e);
  try {
    for await (const ev of chatWithToolsStream(message)) {
      push(ev.type, ev.data);
      if (ev.type === "done") return { content: ev.data.text };
    }
    return { content: "" };
  } catch (err) {
    push("error", { message: err?.message ?? "AI 调用失败" });
    return { error: err?.message ?? "AI 调用失败" };
  }
});
ipcMain.handle(AI_CHANNELS.SESSION_STREAM, async (e, sessionId, message, context) => {
  const wc = e.sender;
  try {
    for await (const ev of chatWithSessionStream(sessionId, message, context)) {
      wc.send(AI_CHANNELS.SESSION_STREAM, { type: ev.type, data: ev.data });
      if (ev.type === "done") return { reply: ev.data.text ?? "", content: ev.data.text ?? "" };
    }
    return { reply: "", content: "" };
  } catch (err) {
    wc.send(AI_CHANNELS.SESSION_STREAM, { type: "error", data: { message: err?.message ?? "AI 调用失败" } });
    return { error: err?.message ?? "AI 调用失败" };
  }
});
ipcMain.handle(AI_CHANNELS.LOG_RECENT, (_e, limit = 100) => getRecentEntries(limit));
ipcMain.handle(AI_CHANNELS.LOG_STATS, () => getStats());
ipcMain.handle(AI_CHANNELS.LOG_CLEAR, () => {
  clearEntries();
  return { ok: true };
});
ipcMain.handle(
  AI_CHANNELS.STT_TRANSCRIBE,
  async (_e, payload) => {
    try {
      if (!payload?.audioBase64) return { error: "audio data is empty" };
      const result = await transcribeWithWhisper(
        payload.audioBase64,
        payload.mimeType || "audio/webm",
        payload.language || "zh"
      );
      return { text: result.text };
    } catch (e) {
      return { error: e?.message || "STT 转写失败" };
    }
  }
);
ipcMain.handle(AI_CHANNELS.RAG_STATS, () => ({ size: storeSize() }));
ipcMain.handle(AI_CHANNELS.REINDEX, async () => {
  try {
    clearAll();
    const all = interviewExperienceRepo.findAll();
    await indexExperiences(all);
    return { ok: true, indexed: all.length, size: storeSize() };
  } catch (e) {
    return { ok: false, error: e?.message ?? "重建索引失败" };
  }
});
function maskKey(key) {
  return key ? key.slice(0, 8) + "..." : "";
}
ipcMain.handle(SETTINGS_CHANNELS.GET, () => {
  const snap = apiConfig.snapshot();
  return {
    llm: {
      apiKey: maskKey(snap.llmApiKey),
      baseUrl: snap.llmBaseUrl,
      model: snap.llmModel,
      configured: apiConfig.isLlmConfigured()
    },
    embedding: {
      apiKey: maskKey(snap.embeddingApiKey),
      baseUrl: snap.embeddingBaseUrl,
      model: snap.embeddingModel,
      configured: apiConfig.isEmbeddingConfigured()
    },
    vision: {
      apiKey: maskKey(snap.visionApiKey),
      baseUrl: snap.visionBaseUrl,
      model: snap.visionModel,
      configured: apiConfig.isVisionConfigured()
    },
    stt: {
      engine: snap.sttEngine,
      apiKey: maskKey(snap.sttApiKey || snap.llmApiKey),
      baseUrl: snap.sttBaseUrl || snap.llmBaseUrl,
      model: snap.sttModel,
      configured: apiConfig.isSttConfigured()
    }
  };
});
ipcMain.handle(SETTINGS_CHANNELS.UPDATE, (_e, body) => {
  const { llm, embedding, vision, stt } = body;
  if (llm) apiConfig.updateLlm(llm.apiKey, llm.baseUrl, llm.model);
  if (embedding) apiConfig.updateEmbedding(embedding.apiKey, embedding.baseUrl, embedding.model);
  if (vision) apiConfig.updateVision(vision.apiKey, vision.baseUrl, vision.model);
  if (stt) apiConfig.updateStt(stt.engine, stt.apiKey, stt.baseUrl, stt.model);
  const snap = apiConfig.snapshot();
  return {
    llm: { baseUrl: snap.llmBaseUrl, model: snap.llmModel, configured: apiConfig.isLlmConfigured(), apiKey: maskKey(snap.llmApiKey) },
    embedding: { baseUrl: snap.embeddingBaseUrl, model: snap.embeddingModel, configured: apiConfig.isEmbeddingConfigured(), apiKey: maskKey(snap.embeddingApiKey) },
    vision: { baseUrl: snap.visionBaseUrl, model: snap.visionModel, configured: apiConfig.isVisionConfigured(), apiKey: maskKey(snap.visionApiKey) },
    stt: { engine: snap.sttEngine, baseUrl: snap.sttBaseUrl || snap.llmBaseUrl, model: snap.sttModel, configured: apiConfig.isSttConfigured(), apiKey: maskKey(snap.sttApiKey || snap.llmApiKey) }
  };
});
ipcMain.handle(SETTINGS_CHANNELS.REINDEX, async () => {
  try {
    clearAll();
    const all = interviewExperienceRepo.findAll();
    await indexExperiences(all);
    return { ok: true, count: all.length, size: storeSize() };
  } catch (e) {
    return { ok: false, error: e?.message ?? "重建索引失败" };
  }
});
async function callVision(imageBase64, mimeType, prompt) {
  if (!apiConfig.isVisionConfigured()) {
    throw new Error("多模态 LLM API Key 未配置。请在「设置」页填入多模态模型配置。");
  }
  const baseUrl = apiConfig.visionBaseUrl.replace(/\/$/, "");
  const dataUrl = `data:${mimeType};base64,${imageBase64}`;
  try {
    const result = await tryChatCompletions(baseUrl, dataUrl, prompt);
    if (result) return result;
  } catch (e) {
    if (!isEndpointError(e)) throw e;
  }
  try {
    const result = await tryResponsesApi(baseUrl, dataUrl, prompt);
    if (result) return result;
  } catch (e) {
    throw new Error(`多模态 LLM 调用失败: ${e?.message || "未知错误"}`);
  }
  throw new Error("多模态 LLM 返回空内容");
}
function isEndpointError(e) {
  const msg = String(e?.message || "");
  return msg.includes("404") || msg.includes("Not Found") || msg.includes("not found") || msg.includes("unsupported");
}
async function tryChatCompletions(baseUrl, dataUrl, prompt) {
  const url = baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`;
  const body = {
    model: apiConfig.visionModel,
    max_tokens: 8192,
    temperature: 0.3,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl } },
          { type: "text", text: prompt }
        ]
      }
    ]
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiConfig.visionApiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    let msg = `${res.status} ${res.statusText}`;
    try {
      const errJson = JSON.parse(errText);
      if (errJson?.error?.message) msg = errJson.error.message;
    } catch {
    }
    throw new Error(`Chat Completions: ${msg}`);
  }
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) return null;
  return typeof content === "string" ? content : JSON.stringify(content);
}
async function tryResponsesApi(baseUrl, dataUrl, prompt) {
  const url = baseUrl.endsWith("/responses") ? baseUrl : `${baseUrl}/responses`;
  const body = {
    model: apiConfig.visionModel,
    input: [
      {
        role: "user",
        content: [
          { type: "input_image", image_url: dataUrl },
          { type: "input_text", text: prompt }
        ]
      }
    ]
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiConfig.visionApiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    let msg = `${res.status} ${res.statusText}`;
    try {
      const errJson = JSON.parse(errText);
      if (errJson?.error?.message) msg = errJson.error.message;
    } catch {
    }
    throw new Error(`Responses API: ${msg}`);
  }
  const json = await res.json();
  const output = json?.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (item?.content && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c?.text) return c.text;
          if (c?.type === "output_text" && c?.text) return c.text;
        }
      }
    }
  }
  const choices = json?.choices;
  if (Array.isArray(choices) && choices[0]?.message?.content) {
    const c = choices[0].message.content;
    return typeof c === "string" ? c : JSON.stringify(c);
  }
  return null;
}
function extractJson(text) {
  if (!text) return null;
  let s = text.trim();
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) s = fenceMatch[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    const first = s.indexOf("{");
    const last = s.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(s.slice(first, last + 1));
      } catch {
      }
    }
    return null;
  }
}
async function parsePdf(buffer2) {
  const pdfParse = require2("pdf-parse");
  const data = await pdfParse(buffer2);
  return {
    text: data?.text || "",
    numpages: data?.numpages
  };
}
function safeJsonParse(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
function stripJsonFence(raw) {
  let s = raw.trim();
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) s = m[1].trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) return s.slice(first, last + 1);
  return s;
}
const masteryService = {
  async createProject(input) {
    const sourceParts = [];
    const fileStatus = [];
    let success = 0, failed = 0;
    for (const f of input.files || []) {
      const entry = { filename: f.filename, parser: "unknown" };
      const ext = (f.filename.match(/\.[^.]+$/) || [""])[0].toLowerCase();
      const buffer2 = (() => {
        try {
          return Buffer$1.from(f.data, "base64");
        } catch {
          return null;
        }
      })();
      if (!buffer2) {
        entry.status = "failed";
        entry.error = "文件读取失败（非 base64）";
        fileStatus.push(entry);
        failed++;
        continue;
      }
      if (ext === ".md" || ext === ".markdown" || /\.(md|markdown)$/.test(ext)) {
        try {
          const text = buffer2.toString("utf8").replace(/\r\n?/g, "\n").trim();
          if (text) {
            sourceParts.push(`===== 文件: ${f.filename} =====
${text}

`);
            entry.status = "success";
            entry.parser = "markdown_plain";
            entry.textLength = text.length;
            fileStatus.push(entry);
            success++;
          } else {
            entry.status = "failed";
            entry.error = "Markdown 内容为空";
            fileStatus.push(entry);
            failed++;
          }
        } catch (e) {
          entry.status = "failed";
          entry.error = e?.message || "解析失败";
          fileStatus.push(entry);
          failed++;
        }
        continue;
      }
      if (ext === ".txt" || ext === ".text" || ext === ".log") {
        try {
          const text = buffer2.toString("utf8").replace(/\r\n?/g, "\n").trim();
          if (text) {
            sourceParts.push(`===== 文件: ${f.filename} =====
${text}

`);
            entry.status = "success";
            entry.parser = "plain_text";
            entry.textLength = text.length;
            fileStatus.push(entry);
            success++;
          } else {
            entry.status = "failed";
            entry.error = "文本内容为空";
            fileStatus.push(entry);
            failed++;
          }
        } catch (e) {
          entry.status = "failed";
          entry.error = e?.message || "解析失败";
          fileStatus.push(entry);
          failed++;
        }
        continue;
      }
      if (ext === ".pdf") {
        try {
          const { text } = await parsePdf(buffer2);
          const trimmed = (text || "").trim();
          if (trimmed) {
            const charsPerPage = trimmed.length;
            if (charsPerPage < 20) {
              entry.status = "failed";
              entry.error = `PDF 仅 ${charsPerPage} 个字符，疑似扫描件。请另存为图片或先 OCR 后以 .md 上传。`;
              fileStatus.push(entry);
              failed++;
            } else {
              sourceParts.push(`===== 文件: ${f.filename} =====
${trimmed}

`);
              entry.status = "success";
              entry.parser = "pdfbox_text";
              entry.textLength = trimmed.length;
              fileStatus.push(entry);
              success++;
            }
          } else {
            entry.status = "failed";
            entry.error = "PDF 没有可抽取的文字（疑似扫描件），请以图片或 .md 上传";
            fileStatus.push(entry);
            failed++;
          }
        } catch (e) {
          entry.status = "failed";
          entry.error = e?.message || "PDF 解析失败";
          fileStatus.push(entry);
          failed++;
        }
        continue;
      }
      if (/\.(png|jpg|jpeg|gif|webp)$/.test(ext)) {
        try {
          const RESUME_IMAGE_PROMPT = `这是一份项目文档图片，请提取全部文字内容并按原样输出。不要添加任何结构化标注或开场白，保持段落换行。`;
          const content = await callVision(f.data, f.mimeType, RESUME_IMAGE_PROMPT);
          if (content && content.trim()) {
            sourceParts.push(`===== 文件: ${f.filename} =====
${content.trim()}

`);
            entry.status = "success";
            entry.parser = "llm_vision";
            entry.textLength = content.trim().length;
            fileStatus.push(entry);
            success++;
          } else {
            entry.status = "failed";
            entry.error = "视觉模型返回空。请检查「设置 → 多模态大模型」是否配置正确，并确认模型支持图片";
            fileStatus.push(entry);
            failed++;
          }
        } catch (e) {
          entry.status = "failed";
          entry.error = e?.message || "图片解析失败";
          fileStatus.push(entry);
          failed++;
        }
        continue;
      }
      entry.status = "failed";
      entry.error = `暂不支持的文件类型：${ext || "(无后缀)"}。请用 PDF / MD / TXT / 图片`;
      fileStatus.push(entry);
      failed++;
    }
    const summary = {
      files: fileStatus,
      successCount: success,
      failedCount: failed,
      totalCount: fileStatus.length
    };
    if (fileStatus.length > 0 && failed === fileStatus.length) {
      const firstError = fileStatus.find((x) => x.status !== "success")?.error || "未知错误";
      throw new Error(
        `全部 ${failed} 个文档解析失败，无法生成。原因（第一条）：${firstError}。请到「设置 → 多模态大模型」确认视觉 API Key 与模型配置是否正确。`
      );
    }
    const project = internshipProjectRepo.create({
      name: input.name || "未命名项目",
      company: input.company || null,
      role: input.role || null,
      startDate: input.startDate || null,
      endDate: input.endDate || null,
      sourceText: sourceParts.join(""),
      parseStatusJson: JSON.stringify(summary)
    });
    return project;
  },
  async generate(id, emit) {
    const project = internshipProjectRepo.findById(id);
    if (!project) throw new Error("项目不存在");
    const source = project.sourceText || project.experienceText || "";
    if (!source || !source.trim()) {
      const sts = safeJsonParse(project.parseStatusJson);
      const failedList = sts?.files?.filter((f) => f.status !== "success") || [];
      const detail = failedList.slice(0, 3).map((f) => `  · ${f.filename} → ${f.error}`).join("\n");
      throw new Error(
        `该项目无可用文档内容，无法生成。共 ${sts?.totalCount ?? 0} 个文档，成功 ${sts?.successCount ?? 0}，失败 ${sts?.failedCount ?? 0}。
${detail}
建议：到「设置」确认 LLM 和视觉 API Key 配置，或先单独上传 1 张图片验证。`
      );
    }
    emit("step", { stage: "outline", status: "in_progress", title: "文档归类与项目识别", detail: "正在通读文档识别项目骨架" });
    let outlineRaw = "";
    try {
      outlineRaw = await chat(
        `你是一位资深简历顾问。通读这份实习/项目文档，识别其中包含的项目并按项目归类整理事实。
严格输出 JSON（不要 markdown），结构：{"projects":[{"name":"","documentTypes":[],"background":"","techStack":"","myContributions":"","achievements":""}]}`,
        `【全部项目文档】
${source.slice(0, 12e3)}

只输出 JSON。`
      );
    } catch (e) {
      emit("step", { stage: "outline", status: "failed", title: "骨架生成失败", detail: e?.message || "LLM 调用失败" });
      throw e;
    }
    const outline = safeJsonParse(stripJsonFence(outlineRaw)) || {};
    internshipProjectRepo.updateFields(id, { projectOutlineJson: JSON.stringify(outline) });
    emit("outline", JSON.stringify(outline));
    emit("step", { stage: "outline", status: "completed", title: "项目识别完成", detail: `共识别 ${(outline.projects || []).length} 个项目` });
    emit("step", { stage: "experience", status: "in_progress", title: "生成实习经历", detail: "正在按项目骨架流式生成 STAR 经历" });
    const expPrompt = `你是资深技术简历顾问。从候选人提供的实习/项目文档中，提取可写进简历的 STAR 格式实习经历，分条输出。
原则：只基于文档真实内容，不编造量化指标；区分个人贡献与团队成果；无数据时用"参与/支持"等可验证措辞。
格式：每条经历以"· "开头，先 STAR 一句概述，再紧跟要点；条目之间空行分隔；用中文；不要 markdown 加粗或除"·"外的符号。
各条经历开头用「【项目：xxx】」标注所属项目。直接输出经历正文。`;
    const expUser = `项目信息：${project.company || ""} / ${project.role || ""} / ${project.name}
时间：${project.startDate || ""} ~ ${project.endDate || ""}

【项目骨架】
${JSON.stringify(outline).slice(0, 4e3)}

【项目文档原文】
${source.slice(0, 8e3)}`;
    let experienceText = "";
    try {
      for await (const chunk of chatStream(expPrompt, expUser)) {
        experienceText += chunk;
        emit("delta", chunk);
      }
    } catch (e) {
      emit("step", { stage: "experience", status: "failed", title: "经历生成失败", detail: e?.message || "LLM 调用失败" });
      throw e;
    }
    experienceText = experienceText.trim();
    emit("step", { stage: "experience", status: "completed", title: "实习经历生成完成", detail: "" });
    emit("step", { stage: "graph", status: "in_progress", title: "提取概念图谱", detail: "正在把经历拆成面试官会深挖的底层概念树" });
    const graphPrompt = `你是资深大厂技术面试官。基于候选人的实习经历，为每条经历列出面试官最可能深挖的底层概念图谱。
严格输出 JSON（不要 markdown、不要代码块），结构：
{"conceptGraph":[{"experienceRef":"对应经历的关键描述","concepts":[{"concept":"概念名","category":"原理|故障|一致性|选型|边界","depthLevel":"表层|中层|底层","whyItMatters":"面试官会怎么拷打","probeQuestion":"开放式诊断题"}]}]}`;
    let graphRaw = "";
    try {
      graphRaw = await chat(graphPrompt, `【生成的实习经历】
${experienceText.slice(0, 3e3)}

【原始文档片段】
${source.slice(0, 4e3)}

只输出 JSON。`);
    } catch (e) {
      emit("step", { stage: "graph", status: "failed", title: "图谱生成失败", detail: e?.message || "LLM 调用失败" });
      throw e;
    }
    const parsed = safeJsonParse(stripJsonFence(graphRaw));
    const graph = parsed?.conceptGraph ? parsed : parsed ? { conceptGraph: parsed } : { conceptGraph: [] };
    internshipProjectRepo.updateFields(id, {
      experienceText,
      conceptGraphJson: JSON.stringify(graph)
    });
    emit("graph", JSON.stringify(graph));
    emit("step", { stage: "graph", status: "completed", title: "概念图谱完成", detail: `共提取 ${(graph.conceptGraph || []).reduce((n, g) => n + (g.concepts || []).length, 0)} 个底层概念` });
    emit("step", { stage: "done", status: "completed", title: "全部完成", detail: "经历与概念图谱已生成" });
    return { experienceText, conceptGraph: graph, outline };
  },
  async diagnose(id, answers) {
    const project = internshipProjectRepo.findById(id);
    if (!project) throw new Error("项目不存在");
    if (!project.conceptGraphJson || !project.conceptGraphJson.trim()) {
      throw new Error("该项目尚未生成概念图谱，请先生成经历与图谱。");
    }
    const answerText = answers.map((a) => `概念: ${a.concept}
问题: ${a.question}
回答: ${a.answer || "未作答"}`).join("\n\n");
    const userMsg = `项目背景: ${project.experienceText || project.sourceText || "无"}

以下是候选人对各概念探测题的回答:

${answerText}

请逐概念判定掌握度等级。`;
    const raw = await chat(MASTERY_DIAGNOSE_SYSTEM, userMsg);
    const parsed = safeJsonParse(stripJsonFence(raw));
    const masteryMap = parsed || { assessments: [], summary: "", weakFocus: [] };
    internshipProjectRepo.updateFields(id, { masteryMapJson: JSON.stringify(masteryMap) });
    return { masteryMap };
  }
};
function registerModuleIpc() {
  ipcMain.handle(INTERVIEW_CHANNELS.COMPANIES, () => interviewExperienceRepo.findDistinctCompanies());
  ipcMain.handle(INTERVIEW_CHANNELS.DEPARTMENTS, (_e, company) => interviewExperienceRepo.findDistinctDepartmentsByCompany(company));
  ipcMain.handle(INTERVIEW_CHANNELS.SEARCH, (_e, company, department) => {
    if (department) return interviewExperienceRepo.findByCompanyAndDepartment(company, department);
    return interviewExperienceRepo.findByCompany(company);
  });
  ipcMain.handle(INTERVIEW_CHANNELS.GET_EXPERIENCE, (_e, id) => interviewExperienceRepo.findById(id));
  ipcMain.handle(INTERVIEW_CHANNELS.ADD_EXPERIENCES, (_e, experiences) => {
    const saved = experiences.map((e) => interviewExperienceRepo.create(e));
    return saved;
  });
  ipcMain.handle(INTERVIEW_CHANNELS.DELETE_EXPERIENCE, (_e, id) => {
    interviewExperienceRepo.remove(id);
    return true;
  });
  ipcMain.handle(INTERVIEW_CHANNELS.PARSE_IMAGE, async (_e, payload) => {
    if (!payload?.data) return { error: "图片数据为空" };
    try {
      const raw = await callVision(payload.data, payload.mimeType || "image/jpeg", IMAGE_PARSE_PROMPT);
      const parsed = extractJson(raw) || {};
      return parsed;
    } catch (e) {
      return { error: e?.message ?? "图片解析失败" };
    }
  });
  ipcMain.handle(CHAT_SESSION_CHANNELS.LIST, () => chatSessionRepo.findAll());
  ipcMain.handle(CHAT_SESSION_CHANNELS.GET_BY_ID, (_e, id) => {
    const s = chatSessionRepo.findById(id);
    if (!s) return null;
    return { ...s, messages: chatSessionRepo.findMessages(id) };
  });
  ipcMain.handle(CHAT_SESSION_CHANNELS.GET_BY_SID, (_e, sid) => {
    const s = chatSessionRepo.findBySessionId(sid);
    if (!s) return null;
    return { ...s, messages: chatSessionRepo.findMessages(s.id) };
  });
  ipcMain.handle(CHAT_SESSION_CHANNELS.DELETE_BY_ID, (_e, id) => {
    chatSessionRepo.remove(id);
    return true;
  });
  ipcMain.handle(CHAT_SESSION_CHANNELS.DELETE_BY_SID, (_e, sid) => {
    const s = chatSessionRepo.findBySessionId(sid);
    if (s) chatSessionRepo.remove(s.id);
    return true;
  });
  ipcMain.handle(CHAT_SESSION_CHANNELS.END, async (_e, sid, questions, resume, company, department) => {
    const s = chatSessionRepo.findBySessionId(sid);
    if (!s) return { error: "会话不存在" };
    const numericId = s.id;
    const messages = chatSessionRepo.findMessages(numericId);
    chatSessionRepo.endSession(numericId, { questions, resume, company, department });
    if (messages.length > 0) {
      try {
        const transcript = messages.map((m) => `${m.role === "user" ? "候选人" : "面试官"}: ${m.content}`).join("\n\n");
        const userMsg = `公司: ${company || "未指定"} / 部门: ${department || "未指定"}
简历摘要: ${(resume || "").slice(0, 1e3)}

面试对话记录:
${transcript}`;
        const reportText = await chat(INTERVIEW_REPORT_SYSTEM, userMsg);
        try {
          const parsed = JSON.parse(reportText);
          chatSessionRepo.endSession(numericId, {
            overallScore: parsed.overallScore ?? null,
            reportSummary: parsed.summary ?? "",
            reportJson: JSON.stringify(parsed)
          });
        } catch {
          chatSessionRepo.endSession(numericId, {
            reportSummary: reportText.slice(0, 500),
            reportJson: reportText
          });
        }
      } catch (e) {
        console.error("生成面试报告失败:", e);
      }
    }
    return { ok: true };
  });
  ipcMain.handle(RESUME_CHANNELS.LIST, () => userResumeRepo.findAll());
  ipcMain.handle(RESUME_CHANNELS.GET, (_e, id) => userResumeRepo.findById(id));
  ipcMain.handle(RESUME_CHANNELS.DELETE, (_e, id) => {
    userResumeRepo.remove(id);
    return true;
  });
  ipcMain.handle(RESUME_CHANNELS.UPLOAD, (_e, r) => userResumeRepo.create(r));
  ipcMain.handle(RESUME_CHANNELS.DOWNLOAD, (_e, id) => {
    const r = userResumeRepo.findById(id);
    if (!r) return null;
    return { fileName: r.fileName, contentType: r.contentType, fileData: r.fileData ? Array.from(r.fileData) : null };
  });
  ipcMain.handle(RESUME_CHANNELS.PARSE, async (_e, payload) => {
    if (payload?.text && !payload?.data) {
      return { content: payload.text };
    }
    if (!payload?.data) {
      return { error: "简历数据为空" };
    }
    const mime = payload.mimeType || "";
    const isPdf = payload.isPdf || mime === "application/pdf";
    if (isPdf) {
      try {
        const pdfBuffer = Buffer.from(payload.data, "base64");
        const pdfData = await parsePdf(pdfBuffer);
        const text = (pdfData?.text || "").trim();
        if (text.length > 50) {
          return { content: text };
        }
        return { error: "该 PDF 为扫描版(无可提取文本)，请将简历导出为图片后上传" };
      } catch (e) {
        return { error: "PDF 解析失败: " + (e?.message || "未知错误") };
      }
    }
    try {
      const raw = await callVision(payload.data, mime || "image/jpeg", RESUME_PARSE_PROMPT);
      return { content: raw };
    } catch (e) {
      return { error: e?.message ?? "简历解析失败" };
    }
  });
  ipcMain.handle(REPLAY_CHANNELS.RECORDS, () => userInterviewRecordRepo.findAll());
  ipcMain.handle(REPLAY_CHANNELS.SAVE, (_e, record) => userInterviewRecordRepo.create(record));
  ipcMain.handle(REPLAY_CHANNELS.DELETE, (_e, id) => {
    userInterviewRecordRepo.remove(id);
    return true;
  });
  ipcMain.handle(REPLAY_CHANNELS.ANALYZE, async (_e, company, department, content) => {
    const userMsg = `公司: ${company} / 部门: ${department}
面经内容:
${content}`;
    const result = await chat(REPLAY_SYSTEM, userMsg);
    try {
      return JSON.parse(result);
    } catch {
      return { analysis: result };
    }
  });
  ipcMain.handle(IDE_CHANNELS.EXECUTE, async (_e, language, code, stdin, acmMode) => {
    return executeCodeRemote(language, code, stdin);
  });
  ipcMain.handle(MASTERY_CHANNELS.LIST, () => internshipProjectRepo.findAll());
  ipcMain.handle(MASTERY_CHANNELS.GET, (_e, id) => internshipProjectRepo.findById(id));
  ipcMain.handle(
    MASTERY_CHANNELS.CREATE,
    async (_e, p) => {
      try {
        const project = await masteryService.createProject(p);
        return { ok: true, project };
      } catch (e) {
        return { error: e?.message ?? "创建项目失败" };
      }
    }
  );
  ipcMain.handle(MASTERY_CHANNELS.UPDATE_EXP, (_e, id, exp) => {
    internshipProjectRepo.updateExperience(id, exp);
    return true;
  });
  ipcMain.handle(MASTERY_CHANNELS.DELETE, (_e, id) => {
    internshipProjectRepo.remove(id);
    return true;
  });
  ipcMain.handle(
    MASTERY_CHANNELS.GENERATE,
    async (_e, id) => {
      const emit = (type, data) => {
        try {
          _e.sender.send("mastery:generate:events:" + id, { type, data });
        } catch {
        }
      };
      emit("step", { stage: "prepare", status: "in_progress", title: "准备", detail: "读取项目文档" });
      try {
        const result = await masteryService.generate(id, emit);
        emit("step", { stage: "done", status: "completed", title: "全部完成", detail: "" });
        return result;
      } catch (e) {
        const msg = e?.message ?? "生成失败";
        emit("step", { stage: "error", status: "failed", title: "生成失败", detail: msg });
        return { error: msg };
      }
    }
  );
  ipcMain.handle(
    MASTERY_CHANNELS.DIAGNOSE,
    async (_e, id, answers) => {
      try {
        const res = await masteryService.diagnose(id, answers);
        return res;
      } catch (e) {
        return { error: e?.message ?? "诊断失败" };
      }
    }
  );
  ipcMain.handle(INTERVIEW_CHANNELS.GENERATE_QUESTIONS, async (e, company, department, resume) => {
    const streamChannel = `${INTERVIEW_CHANNELS.GENERATE_QUESTIONS}:stream`;
    const send = (type, data) => {
      try {
        e.sender.send(streamChannel, { type, data });
      } catch {
      }
    };
    const userMsg = `公司: ${company} / 部门: ${department}
候选人简历摘要:
${resume || "无"}
请生成 8 道面试问题。`;
    try {
      send("step", { title: "分析简历与面经要点", detail: "结合目标公司面经与候选人简历定位考察方向", stage: "analyze", status: "in_progress" });
      await new Promise((r) => setTimeout(r, 200));
      send("step", { title: "分析简历与面经要点", detail: "结合目标公司面经与候选人简历定位考察方向", stage: "analyze", status: "completed" });
      send("step", { title: "生成深挖问题", detail: "流式生成项目深挖、系统设计、八股与算法题目", stage: "generate", status: "in_progress" });
      let full = "";
      for await (const chunk of chatStream(DEEP_QUESTIONS_SYSTEM, userMsg)) {
        full += chunk;
        send("delta", chunk);
      }
      send("step", { title: "生成深挖问题", detail: "流式生成项目深挖、系统设计、八股与算法题目", stage: "generate", status: "completed" });
      send("result", full);
      return { content: full };
    } catch (err) {
      const msg = err?.message ?? "生成失败";
      send("error", msg);
      return { error: msg };
    }
  });
}
function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: true,
    autoHideMenuBar: true,
    title: "sspOffer",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false,
      contextIsolation: true
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });
  console.log("main __dirname:", __dirname, "| dev:", is.dev, "| RENDERER_URL:", process.env["ELECTRON_RENDERER_URL"] || "(none)");
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html")).catch((e) => console.error("loadFile 失败:", e));
  }
}
app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.sspoffer.desktop");
  registerIpc();
  registerModuleIpc();
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  closeDb();
  if (process.platform !== "darwin") app.quit();
});
