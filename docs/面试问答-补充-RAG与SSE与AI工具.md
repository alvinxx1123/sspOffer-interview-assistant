# 面试问答补充：RAG、SSE、Spring AI、Agent、AI 工具

与《面试问答-项目亮点与实现》配套，按面试官常问的题目整理。

---

## 一、RAG 相关

### 1. RAG 流程，有没有复杂的逻辑判断，是用的已有框架还是自己开发的？

**流程**：面经入库 → 按字段分块（buildChunks）→ 转 TextSegment 带 metadata → 调用 EmbeddingModel 得到向量 → 写入 EmbeddingStore；检索时 query 做 embedding → findRelevant 取 topK → 按 company/department 过滤、同 experienceId 限流 → 按 type 聚合（深挖场景）→ 拼进 prompt 给大模型生成。

**复杂逻辑**：有。分块是按**业务字段**（实习/项目/八股_Java/八股_AI/算法）拆的，不是通用按长度切；检索后有**公司/部门过滤**、**同一条面经最多取 2 块**（避免单条占满）、深挖时再按 **type 聚合成 Map** 拼成【参考面经-实习】等多段。这些是我们在 **LangChain4j** 之上写的业务逻辑。

**框架与自研**：**用的是 LangChain4j**（EmbeddingModel、EmbeddingStore、ChatLanguageModel、AiServices），不是 Spring AI。分块策略、检索后过滤与聚合、Prompt 模板、智谱 API 的 Embedding 封装（ZhipuEmbeddingModel）是**自己开发**的；向量检索、模型调用是**框架**提供的。

---

### 2. RAG 分片怎么做？如何优化？

**当前做法**：**按字段分片**（Field-based Chunk）。一条面经拆成多块：总述、实习经历、项目经历、八股_Java、八股_AI、算法，每块带 metadata（experienceId、company、department、type）。单块超过 **800 字**会截断并加 "..."。

**优化方向**：
- **长度与 overlap**：可对超长字段再按 300～500 字或按题目/段落做子块切分，块间加少量 overlap 减少边界截断。
- **metadata**：保证 type、company、department 准确，便于检索后过滤和按类型聚合。
- **检索侧**：同一条面经限流（当前最多 2 块），避免一条面经占满结果；深挖场景按 type 聚合后再拼 prompt，保证「实习/项目/八股」都有对应参考。

---

### 3. RAG 检索怎么优化？多路召回讲一讲

**当前**：**单路向量召回**。query 做 embedding 后 `findRelevant(queryEmbedding, fetch, 0.4)`，再按 company/department 过滤、同 experienceId 限流、按 type 聚合。

**多路召回**：可以这样说——  
「目前是单路向量召回；多路召回可以做成：**一路向量检索**（语义相似）、**一路关键词/BM25**（公司名、部门、八股术语等精确匹配），两路结果做**融合**（如并集去重、按来源加权），再**重排**（Reranker 或规则）取 topK 给大模型。这样既保留语义又避免漏掉关键词明显的片段。」

**其他优化**：换更好的 Embedding（智谱、BGE）、加 Reranker、query 扩展（如拼上「实习 项目 八股」）、调相似度阈值与 fetch 数量。

---

### 4. RAG 的幻觉怎么降低的？

**项目里**：
- **控制注入内容**：只把**检索到的面经片段**和**简历**放进 prompt，并做长度截断（单段 500/600 字），避免塞入过多无关内容诱发幻觉。
- **Prompt 约束**：明确写「根据【参考面经-实习】等和【候选人简历】出题」「不要问简历未涉及的方向」「直接以 1.2.3. 开头」等，限制格式和范围。
- **未单独做**：没有再做事后幻觉检测或引用校验；可以补充说「若进一步降低幻觉，可以加：要求模型标注引用来源、或对关键事实做检索校验」。

---

### 5. 上下文的控制

（与《面试问答-项目亮点与实现》一致，简述）  
对话用 **MessageWindowChatMemory.withMaxMessages(20)**；恢复会话只灌回最近 20 条；简历超 2000 字截断；RAG 单条超 500/600 字截断；每轮只注入 top 5 条检索结果。通过**条数上限 + 单条截断 + 按需 RAG** 控制上下文。

---

## 二、Spring AI 与 Agent

### 6. 介绍一下 Spring AI 这个框架

**Spring AI** 是 Spring 生态里用于集成大模型、向量库、RAG、Prompt 的框架，提供统一的抽象（ChatClient、EmbeddingModel、VectorStore 等），支持 OpenAI、Azure、本地模型等多种后端。和 LangChain4j 类似，都是「在 JVM 上接大模型和 RAG」的解决方案；Spring AI 更贴近 Spring 生态，LangChain4j 的链和 Tool 抽象更丰富。

**我们项目**：用的是 **LangChain4j**（0.36），没有用 Spring AI。原因包括：项目开始时 LangChain4j 的 RAG + Function Calling 文档和示例更符合需求，且智谱可通过 OpenAI 兼容接口接入。

---

### 7. 是用 workflow 方式搭建的 agent 吗？

**不是**。我们是用 **LangChain4j 的 AiServices + 接口 + Tool 注入** 的方式：定义一个带 `@SystemMessage` / `@UserMessage` 的接口（如 `AssistantWithTools`），把 `InterviewAssistantTools` 作为 tools 传给 `AiServices.builder(...).tools(tools).build()`，模型在对话中**自己决定**是否调用工具、调哪个。这是 **Function Calling / Tool Use** 模式，不是显式的 workflow 编排（没有预定义「先 A 再 B 再 C」的流程图）。

---

### 8. 用 Spring AI 写一个 agent 的过程大概是什么样的？

（项目未用 Spring AI，可按通用知识答。）  
大致步骤：引入 Spring AI 依赖 → 配置 ChatClient（如 OpenAI/智谱的 URL 和 Key）→ 若要带工具：实现 Spring AI 的 Function Callback 或 Tool 抽象，在调用 ChatClient 时传入 → 每轮用户输入后调用 `chatClient.prompt().user(...).call()`，根据返回决定是否执行工具再继续对话。若用 Spring AI 的流式 API，则用 `StreamingChatClient` 并消费 Flux。  
和 LangChain4j 的 AiServices + tools 类似，都是「模型决策 + 工具执行」的 agent 模式。

---

### 9. 整个过程完全是大模型自己决策吗？

**基本是**。智能助手场景：用户发一条消息后，我们只调一次 `assistant.chat(message)`，**是否查面经、查算法题、运行代码**由大模型根据意图决定，我们只提供 Tool 实现和 Prompt 约束。  
**有少量业务分支**：例如「查算法题」类请求在代码里做了识别，直接走本地题库/联网搜索逻辑，返回一条标准链接，不经过 LLM，以保证链接格式统一、无 HTML 乱码。所以可以答：**绝大部分是模型决策，少数高确定性、强格式要求的路径做了短路处理**。

---

## 三、SSE 与大模型对接

### 10. SSE 具体是怎么实现的？后端如何通过请求头告诉前端“不要结束连接”？SSE 是基于什么做的？Java 有没有相关库支持？

**实现**：深挖问题流式接口用 **Spring MVC 的 SseEmitter**。接口返回类型为 `SseEmitter`，并设置 `produces = MediaType.TEXT_EVENT_STREAM_VALUE`（即 `text/event-stream`）。在单线程 Executor 里执行生成逻辑，通过 `emitter.send(SseEmitter.event().name("step").data(step))` 和 `emitter.send(SseEmitter.event().name("result").data(result))` 推送事件；最后 `emitter.complete()`。超时 120 秒。

**“不要结束连接”**：**响应头**由 Spring 在设置 `TEXT_EVENT_STREAM_VALUE` 时自动带上 `Content-Type: text/event-stream`，以及通常的 **Connection: keep-alive**、**Cache-Control: no-cache** 等，表示这是一个长连接、流式响应，前端会持续读 body 直到服务端关闭或超时。我们不需要手写这些头。

**基于什么**：SSE 是基于 **HTTP 长连接** 的标准（HTML5 规范），单向服务端推送，通过 `event:` 和 `data:` 行组成事件流。

**Java 库**：**Spring** 自带 **SseEmitter**（spring-web），无需额外库。JAX-RS 有 `Sse`、`SseEventSink` 等；若用 WebFlux 可用 `ServerSentEvent` + `Flux`。我们项目用的是 **Spring 的 SseEmitter**。

---

### 11. 调用大模型 API 时用什么协议？如何支持流式输出？

**协议**：**HTTP/HTTPS**，**REST**。智谱提供的是 OpenAI 兼容的 HTTP API（如 `https://open.bigmodel.cn/api/paas/v4/chat/completions`），我们通过 **RestTemplate**（或 LangChain4j 内部用的 HTTP 客户端）发 POST，body 为 JSON（model、messages、max_tokens 等）。

**流式**：OpenAI 兼容接口支持请求体里 **`stream: true`**，响应变为 **chunked 传输**，body 是一系列 SSE 格式的 chunk（`data: {...}`）。我们项目里**深挖问题的流式**是「步骤级」的：后端自己用 SseEmitter 先发 step 再发 result，**没有**把智谱的 token 级 stream 直接推到前端；若要做「打字机效果」，需要后端调智谱时开 `stream: true`，读 chunk 并转发为 SSE 事件给前端。  
所以可以答：**协议是 HTTP REST；流式由 API 的 stream 参数 + chunked 响应支持；我们当前流式是业务层的步骤流式，用 Spring SseEmitter 推送。**

---

## 四、AI 工具与开发流程

### 12. 你在开发中使用了哪些 AI 工具（如 Cursor、GitHub Copilot、Cloud Code）？

按实际情况答即可。例如：**Cursor**（日常写代码、改 bug、生成文档）、**GitHub Copilot** 或 **Cloud Code**（补全与注释）等。若用过 Trae、Windsurf、Codeium 等也可提。

---

### 13. 如何利用 AI 协助开发？从一个新需求到生成代码的流程是怎样的？

可答：**需求理解** → 用 AI 帮助拆解成任务和接口设计；**查文档/查库** → 让 AI 根据报错或 API 名查官方文档、项目内用法；**写代码** → 给出文件路径和需求描述，让 AI 生成或修改代码；**自测与修错** → 跑测试/运行，把报错贴给 AI 一起排查；**提交前** → 自己 review diff，必要时补充边界情况和注释。  
强调：**需求与接口由人定，关键逻辑和安全性由人审，AI 负责具体实现与重复劳动**。

---

### 14. 如何保证 AI 生成代码的正确性和质量？有评估指标吗？

**保证方式**：  
- **小步迭代**：按模块/接口分步生成，每步可运行、可测，避免一次生成一大坨难以定位问题。  
- **必跑必测**：生成后本地运行、单测或关键接口手测，再上库。  
- **人工 review**：对关键分支、数据校验、安全相关逻辑重点看，不盲目信任生成结果。  
- **项目内**：有单测（如 RagServiceTest）、部署前打包与冒烟验证。

**评估指标**：没有成文的自动化指标；可以答「目前以**功能正确性 + 单测通过 + Code Review** 为主；若要做量化，可以加：单测覆盖率、静态检查（如 SpotBugs）、或对生成 diff 做简单规则检查（如敏感 API、SQL 拼接）」。

---

以上可直接作为面试回答提纲；结合项目时优先扣 **LangChain4j、RAG 分片与检索、SseEmitter、智谱 HTTP API** 等实际用到的点。
