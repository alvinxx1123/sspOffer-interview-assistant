# 面经 RAG 与对话升级 · 优化方案（供挑选）

本文档针对「面经 chunk、embedding、RAG+简历深挖/对话、会话记忆与上下文、Prompt」五类需求，给出多套可选方案，便于按优先级和实现成本挑选落地。

---

## 一、面经 Chunk 分块方案

当前：一条面经 = 一个 TextSegment，整段 `buildSearchableText` 拼在一起不做切分。

面经字段：`content`（总述）、`internshipExperiences`、`projectExperiences`、`baguQuestions`、`llmQuestions`、`algorithmQuestions` 等，适合按**语义/用途**分块，便于检索时「按实习/项目/八股/算法」精准命中。

### 方案 A：按字段分块（Field-based Chunk）

- **做法**：一条面经拆成多段，每段对应一个「类型」+ 内容。
  - 块1：`公司/部门/岗位` + `content`（总述，可设最大长度如 500 字）；
  - 块2：若有 `internshipExperiences`，单独一块，metadata 标 `type=实习`；
  - 块3：若有 `projectExperiences` / `projectExperience`，单独一块，metadata 标 `type=项目`；
  - 块4：若有 `baguQuestions`，单独一块，metadata 标 `type=八股_Java`；
  - 块5：若有 `llmQuestions`，单独一块，metadata 标 `type=八股_AI`；
  - 块6：若有 `algorithmQuestions`，单独一块，metadata 标 `type=算法`。
- **Metadata**：每块带 `experienceId`、`company`、`department`、`type`（实习/项目/八股_Java/八股_AI/算法）。
- **检索**：query 做 embedding 检索到块后，可按 `type` 过滤（例如用户选「只出八股题」则只取 type=八股_* 的块），或按 company/department 过滤。
- **优点**：实现简单，检索可控，便于「深挖问题」时按类别组 prompt（实习题从实习块出、八股从八股块出）。
- **缺点**：同一面经可能多块，需要去重或按 experienceId 聚合后再拼给模型。

### 方案 B：按字段 + 子块长度切分（Field + 固定长度）

- **做法**：在方案 A 基础上，对「单字段内容过长」的再按字数或句子切子块。
  - 例如 `baguQuestions` 若为一大段，按 300～500 字或按「题目」拆成多条，每条一块，metadata 仍带 `type=八股_Java`、`experienceId`。
  - 块与块之间可加 overlap（如 50 字），减少边界截断。
- **优点**：长八股/长项目描述不会一整块超长，检索更细粒度。
- **缺点**：块数变多，索引与检索量略增；需要定好 maxChunkSize 和 overlap。

### 方案 C：不按字段、按语义句子切块（通用 DocumentSplitter）

- **做法**：仍用 `buildSearchableText` 拼成一大段，然后用 LangChain4j 的 `DocumentSplitter`（按字符数/句子）切块，每块带相同 metadata（company、department、experienceId）。
- **优点**：实现快，与现有「一段文本」兼容好。
- **缺点**：块内可能混合「实习+项目+八股」，检索时无法按「只要八股」过滤，且语义边界不一定对齐「一道题/一段经历」。

**推荐**：优先 **方案 A**，若单字段经常超 500～800 字再叠加 **方案 B** 的子块切分；方案 C 可作为「快速试水」备选。

---

## 二、Embedding 模型优化方案

当前：AllMiniLmL6V2（ONNX 本地），多语言、体积小，中文效果一般。

目标：面经 RAG 更精准，尤其是中文 query、公司/部门/八股/算法等语义区分。

### 方案 A：换 BGE 系列（中文强、可本地）

- **候选**：
  - **bge-m3**：多语言、长文本（如 8192），效果最好，体积和算力要求较高。
  - **bge-base-zh-v1.5** / **bge-small-zh-v1.5**：中文特化，base 效果优于 small，体积适中。
- **集成**：LangChain4j 若有 BGE 的 EmbeddingModel 实现可直接用；否则需自己封装 HTTP 或 ONNX（HuggingFace 有 bge 的 sentence-transformers/ONNX 版本）。
- **优点**：中文检索明显优于 AllMiniLM，可完全本地。
- **缺点**：模型体积和推理耗时大于 AllMiniLM，需评估本机/服务器资源。

### 方案 B：智谱 Embedding API

- **接口**：智谱提供 text-embedding-3 等接口，与现有智谱 API Key 统一，按次计费。
- **集成**：实现 LangChain4j 的 `EmbeddingModel` 接口，内部调智谱 HTTP API；EmbeddingStore 仍用现有 InMemory 或后续迁到向量库。
- **优点**：无需本地 GPU/大内存，中文效果好，与 GLM 同厂一致。
- **缺点**：依赖网络与配额，有延迟和成本；向量需持久化时仍要自建向量库。

### 方案 C：阿里 GTE / 其他中文 API

- **候选**：GTE-Qwen（阿里）、通义 embedding 等，均为 HTTP API。
- **优点**：中文优化好，按量付费。
- **缺点**：多一套 Key 与依赖，需封装成 EmbeddingModel。

### 方案 D：保留 AllMiniLM + 重排序（Reranker）

- **做法**：检索仍用 AllMiniLM 做初筛（如 topK=20），再用一个 Reranker 模型对「query + 候选块」做精排，取 top 5～10 再给大模型。
- **Reranker**：如 bge-reranker-v2-m3、bge-reranker-base 等，可用 HuggingFace 或 ONNX；LangChain4j 若支持 EmbeddingStore 的 rerank 可接入。
- **优点**：改动相对小，只加一层 rerank，检索精度提升明显。
- **缺点**：Reranker 推理增加延迟，需平衡 latency。

**推荐**：  
- 若可接受本地资源：**方案 A（bge-small-zh 或 bge-base-zh）** 作为主方案，后续有需要再上 bge-m3。  
- 若希望零本地算力：**方案 B（智谱 Embedding）**。  
- 若想最小改动先验证：**方案 D（AllMiniLM + Reranker）**。

---

## 三、面经 RAG + 大模型 vs 直接简历+面经给 ChatGPT/DeepSeek 的优化

目标：让「本系统 RAG + 深挖问题/对话」效果优于「把简历和面经整段贴给 ChatGPT/DeepSeek 提问」。

### 3.1 检索侧

- **类别感知检索**：采用「一、方案 A」的按字段分块后，深挖问题生成时可按「实习/项目/八股/算法」分别检索，每类取 top 2～3，再拼进 prompt，避免一股脑塞全量面经。
- **Query 扩展**：用户选公司+部门时，query 不只「公司+部门」，可拼接「实习 项目 八股 Java 大模型 算法 面试题」等关键词，提高召回与语义覆盖。
- **多样性**：检索时对同一 experienceId 的多个块做去重或限流（如同一面经最多 2 块），避免结果被单条面经占满。

### 3.2 深挖问题生成

- **结构化 prompt**：  
  - System：明确角色（大厂面试官）、输出格式（1. 2. 3. 开头、每题 50 字内、顺序：实习→项目→八股→大模型）、禁止项（禁止开场白、禁止总结）。  
  - User：分块给「【目标公司/部门】」「【参考面经-实习】」「【参考面经-项目】」「【参考面经-八股】」「【参考面经-大模型】」「【候选人简历】」，让模型按块对应出题，而不是混在一起泛泛而问。
- **简历对齐**：在 prompt 中显式写「请针对简历中的实习/项目/技术栈出题，不要问简历中未涉及的方向」，减少无关题。
- **可选：两步生成**：第一步只生成「题目列表」，第二步再对每题扩展成「追问/参考要点」（可按需做，避免一次生成长度爆炸）。

### 3.3 对话（面试模拟）

- **每轮 RAG 注入**：当前已有「当前轮 userMessage + 公司/部门」做 RAG，可加强为：  
  - 若用户正在「答某道深挖题」，用该题文本作为 query 再检一次，把「与该题相关的面经片段」注入当轮 system，让模型追问更贴面经。
- **角色与规则**：System 中明确「先让候选人答，再根据回答追问或点评；若候选人要求答疑，则给简明参考答案」，减少模型抢答或跑题。
- **对比实验**：用同一份简历+同一公司面经，一组走本系统 RAG+深挖/对话，一组把相同内容贴给 ChatGPT/DeepSeek 让它们出题+对话，人工对比「题目相关性、是否有针对简历、追问是否贴面经」并记录，用于迭代 prompt 和检索策略。

**推荐**：  
- 先做 **3.2 结构化 prompt + 简历对齐** 和 **3.1 类别感知检索**（依赖 chunk 方案 A）；  
- 再补 **3.3 每轮 RAG 注入** 和 **对比实验**，形成闭环优化。

---

## 四、会话不遗忘与上下文约束

目标：兼顾「不丢记忆」与「上下文不超长、不截断」。

### 方案 A：滑动窗口 + 会话恢复时从 DB 灌回

- **当前**：内存里 `MessageWindowChatMemory` 保留最近 20 条，会话结束后新会话重新建 memory，不读 DB。
- **优化**：  
  - 新会话若带 `sessionId` 且 DB 中已有该 session 的历史消息，**首次请求时**从 DB 拉取该 session 的最近 N 条消息（如 20 条），按顺序 add 到 `MessageWindowChatMemory`，再执行当轮对话。  
  - 这样「刷新页面/重进会话」后仍能延续记忆。  
- **上下文约束**：N 条消息总 token 数可估算（如按 1 条≈100 token），若超过模型上下文一半（如 4k），则只灌最近 M 条（M&lt;N），或对更早的消息做摘要（见方案 B）。

### 方案 B：滑动窗口 + 早期消息摘要

- **做法**：保留最近 K 条完整消息（如 10 条），更早的消息用大模型做一次「摘要」（例如「候选人介绍了项目 A、问了八股 B、模型给出了参考答案」），把摘要作为一条 System 或 User 注入，再拼最近 K 条完整消息。  
- **优点**：既保留长期记忆，又控制 token。  
- **缺点**：多一次摘要调用，实现和调参稍复杂。

### 方案 C：固定 token 预算

- **做法**：设定「system + 历史 + 本轮」总 token 上限（如 6k），按时间顺序从新到旧取消息，直到塞满预算为止；更早的丢弃或进摘要。  
- **实现**：可用 tiktoken 或按字符数粗算（如 1 中文≈2 token），在拼 messages 前做截断。

### 方案 D：双轨 memory（简要 + 完整）

- **做法**：内存里只保留「简要版」历史（例如每轮只存「用户问/答主题」一两句），完整内容存 DB；拼 prompt 时用简要版 + 当前轮完整内容，需要时再从 DB 取最近几轮完整内容。  
- **优点**：控制 prompt 长度，同时不丢完整记录。  
- **缺点**：设计和实现复杂度较高。

**推荐**：  
- **先做方案 A**：会话恢复时从 DB 灌回最近 N 条到 memory，并设定 N 的上限（如 20）和总长度上限（方案 C 的粗算），避免单 session 过长。  
- 若仍超长再考虑 **方案 B（摘要）** 或 **方案 C（严格 token 预算）**。

---

## 五、Prompt 优化

目标：全项目 prompt 更清晰、可维护、效果更好。

### 5.1 统一结构

- **角色 + 任务 + 格式 + 禁止项**：  
  - 角色：一句话说明身份（如「你是 sspOffer 面经助手 / 大厂技术面试官」）。  
  - 任务：本接口要做什么（生成深挖题 / 模拟面试 / 复盘 / 答疑）。  
  - 格式：输出长什么样（编号、字数、顺序、是否 Markdown）。  
  - 禁止项：不要做什么（不要 HTML、不要开场白、不要编造链接等）。
- **涉及位置**：`InterviewCoach`（深挖问题）、`ReplayCoach`（复盘）、`AssistantWithTools`（带 Tool 助手）、`InterviewChatService.SYSTEM_PROMPT`（面试模拟）、`ChatAssistant`（面经问答）。

### 5.2 深挖问题生成（InterviewCoach）

- 在 UserMessage 中**分块**提供：目标公司/部门、参考面经-实习、参考面经-项目、参考面经-八股、参考面经-大模型、候选人简历；并加一句「请针对简历中的经历和技术栈出题，不要问简历未涉及的方向」。
- 若采用「一、方案 A」chunk，可在拼「参考面经」时按 type 分段标注，便于模型对应出题。

### 5.3 面试模拟（InterviewChatService.SYSTEM_PROMPT）

- 明确「本场深挖问题列表」与「候选人简历摘要」的用法：面试官应围绕这些问题和简历追问，答疑时简短、分点、控制字数。
- 可加 1～2 条 **few-shot** 示例（例如：用户答了一句话 → 面试官应如何追问；用户说「请讲一下这道题」→ 面试官应如何给参考答案），减少模型自由发挥过度。

### 5.4 带 Tool 助手（AssistantWithTools）

- 保持「URL 原样、禁止 HTML、仅一条链接」等约束；可把「何时用哪个 Tool」写得更短、更条目化，便于模型解析。
- 若发现某类误用（如总用错 getAlgorithmQuestionById），可在 System 里加一条反例说明。

### 5.5 复盘（ReplayCoach）

- 保持「不用 * / ###、用数字序号+小标题」等格式约束；可补充「若面经无候选人回答，则侧重考察方向与准备建议；若有回答，则逐题评估并给改进建议」。

### 5.6 可维护性

- 将长 prompt 抽到配置文件或常量类（如 `PromptTemplates`），按功能分块，避免散落在各 Service 里；便于后续做 A/B 或多语言。

**推荐**：  
- 先做 **5.1 统一结构** 和 **5.2 / 5.3 / 5.4** 的针对性加强；  
- 再视情况加 **few-shot** 和 **5.6 抽配置**。

---

## 六、实施顺序建议

| 优先级 | 项目 | 建议方案 | 依赖 |
|--------|------|----------|------|
| P0 | 面经 Chunk | 方案 A（按字段分块） | 无 |
| P0 | Embedding | 方案 A（bge-small-zh/base-zh）或 方案 D（Reranker） | 无 |
| P0 | RAG+深挖/对话优于裸贴 | 3.2 结构化 prompt + 简历对齐；3.1 类别感知检索 | Chunk 方案 A |
| P1 | 会话不遗忘 | 方案 A（DB 灌回 memory） | 无 |
| P1 | 上下文约束 | 方案 C（token 预算）或 N 条上限 | 方案 A |
| P1 | Prompt 优化 | 5.1～5.5 | 无 |
| P2 | 对话每轮 RAG 加强 | 3.3 每轮 RAG 注入 | Chunk |
| P2 | 记忆摘要 | 方案 B | 方案 A |

完成 P0 后，再对「深挖问题/对话」与「直接贴 ChatGPT/DeepSeek」做一次小规模对比评测，根据结果迭代 prompt 与检索策略。

---

## 七、常见疑问与补充

### Q1. 同一面经多块时，怎么去重 / 按 experienceId 聚合后再拼给模型？

**思路**：检索出来的是「块列表」，每块带 `experienceId` 和 `type`，需要在拼进 prompt 前做**按面经聚合 + 条数控制**，避免同一篇面经占满上下文、也避免重复感。

**做法一：按 experienceId 去重 + 限流**

- 检索得到 `List<Chunk>` 后，按 `experienceId` 分组，每组（同一面经）最多保留 N 块（如 N=2）。
  - 保留策略：可按 `type` 优先级（如实习 > 项目 > 八股 > 算法）或按检索得分取前 N 块。
- 再按得分或 type 顺序排序，取全局 top K 条（如 5～10 条）拼进 prompt。
- 这样同一面经最多出现 2 块，既保留多类型覆盖，又不会同一篇刷屏。

**做法二：按 experienceId 聚合后再拼**

- 检索得到块列表后，按 `experienceId` 分组；
- 每组内把多块文本**按 type 顺序拼成一段**（例如：总述 + 实习 + 项目 + 八股_Java + 八股_AI + 算法），并在段落前加小标题（【实习】【项目】【八股】等）；
- 每个 experienceId 只对应「一段」聚合后的文本，再按检索得分取 top 几「段」拼给模型。
- 优点：模型看到的是「一篇面经的完整结构」，可读性更好；缺点：单段可能偏长，需要设 maxLength 截断。

**做法三：混用——深挖用聚合、对话用限流**

- **深挖问题生成**：用做法二，按 experienceId 聚合成「一篇一篇」的面经，再取 top 3～5 篇拼进 prompt，便于模型按「整篇面经」出题。
- **对话 / 单轮问答**：用做法一，同一 experienceId 最多 2 块，保证响应快、不超长。

**推荐**：实现上先做**做法一**（简单、可控）；若发现模型需要更强「整篇面经」语境，再加**做法二**用于深挖接口。

---

### Q2. BGE 要部署在本地/服务器吗？机器撑不住怎么办？选智谱 Embedding API 可以吗？MTEB 上没看到 GLM 是排名太低吗？

**BGE 是否必须本地/自建服务器？**

- **不一定**。BGE 有两种用法：
  1. **自部署**：在本地或服务器上跑（ONNX / Python / Docker），需要算力和内存。  
     - **bge-small-zh** 很轻：约 33M 参数、130MB 左右，可 **CPU 推理**（较慢），量化后显存可压到约 1.2GB，低配服务器或笔记本也能跑。  
     - **bge-base-zh / bge-m3** 更大，建议有 GPU 或较高配置。
  2. **用别人提供的 BGE API**：例如 SiliconCloud 等有 BGE 的云端 API（付费）；或自建 BGE 的服务用 HTTP 调（如 Docker 起一个 bge-api，本机或另一台机跑）。  
- 若**本机或现有 ECS 性能不够**，又不想自己扩机器，可以：  
  - **不跑 BGE**，改用 **智谱 Embedding API**（见下），或  
  - 用 **AllMiniLM 本地 + Reranker 云端/本地**（Reranker 相对轻量，有的可 CPU 跑）。

**选智谱 GLM 的 Embedding API 可以吗？**

- **可以**。智谱有 **Embedding-2**（1024 维、8K 上下文）、**Embedding-3** 等，和现有智谱 Chat API 同账号、同 Key，按量计费，无需本地算力。
- 适合：已经用智谱做对话/生成，希望 embedding 也统一、且不想维护本地模型的情况。
- 集成方式：实现 LangChain4j 的 `EmbeddingModel` 接口，内部 HTTP 调智谱 embedding 接口，向量仍存现有 InMemory 或后续向量库。

**MTEB 上没看到 GLM/智谱，是排名太低吗？**

- **大概率不是「排名太低」**，而是 **MTEB 榜单本身是「提交制」**：模型方或社区把模型提交到 [MTEB Leaderboard](https://huggingface.co/spaces/mteb/leaderboard) 上跑评测才会出现。很多**商业 API（智谱、阿里、OpenAI 部分型号）并没有提交**，所以榜上看不到，不代表效果差。
- 智谱 Embedding 官方主要宣传在「中英文语义理解、搜索/推荐」等场景，没有强调 MTEB 名次；**选它做中文面经 RAG 是合理选择**，尤其你已经在用智谱 Chat，一致性和运维都更简单。
- 若想「心里有底」，可以自己用一小批面经 + 典型 query 做 **A/B**：同一批 query 分别用 AllMiniLM、智谱 Embedding、BGE-small 做检索，看 topK 命中率或人工打分，选最适合你数据的那一个。

**小结**

- 机器撑不住 BGE：优先用 **智谱 Embedding API**，或 **AllMiniLM + Reranker** 做折中。  
- 智谱在 MTEB 上看不到：多半是没提交，不是排名低；用于中文 RAG 没问题，可按需做小规模 A/B 验证。
