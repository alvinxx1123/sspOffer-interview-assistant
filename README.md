<img src="logo.png" alt="sspOffer Logo" width="50%">

**sspOffer面经助手** - 互联网面试准备平台  
Live Demo: http://8.138.47.162:8080

基于 LangChain4j 的面经整合与 AI 面试准备应用。支持面经搜索、AI 面试模拟（RAG + 深挖题 + 连续追问 + 整场评分）、面试复盘、在线算法 IDE，并通过 Function Calling 让大模型自动调用「查面经、查算法题、运行代码、统计高频考点」等后端能力。

---

## 功能特性

- **面经搜索**：按公司、部门检索个人面经，支持手动录入或**图片解析**（八股/算法题自动换行、常见 OCR 纠错）
- **AI 面试模拟**：根据目标公司/部门**面经库 RAG** + 简历生成 **9–12 道深挖题**，覆盖实习、项目、Java 八股、AI/Agent/LLM、算法等方向；支持 **SSE 流式**展示结构化思考过程，并让题单内容**逐段实时生成**
- **连续面试对话**：题单一次性生成后，用户可按自己的节奏挑题作答；面试官默认围绕**当前问题**继续深挖，减少重复念题和跑题
- **当前回答点评 / 参考答案 / 深挖建议**：作为辅助训练功能存在，不打断主面试流程
- **本场完整面试评价**：结束会话后基于**本场完整问答**生成结构化中文评分
- **系统历史对比分析**：将本场结果与历史会话按正确性、深度、结构、表达、风险意识等维度比较，输出进步项、退步项、稳定项与优先加强建议
- **面试复盘**：上传真实面经，AI 深度复盘分析，给出改进建议
- **在线 IDE**：支持 Java、Python、Go 等 ACM 模式运行，题库支持手动添加题目
- **智能助手（Function Calling）**：模型可自动调用「查面经」「查算法题」「运行代码」「统计高频考点」，返回可点击的纯净链接
- **简历 + 投递**：简历管理、投递进度追踪（编辑时自动滚动到表单并提示“正在编辑”）
- **Skill Pack + Capability 架构**：将面试流程、简历画像、评分标准、历史对比、面经清洗抽象为项目内 `skill-packs/*.md`，并以 Java `capability` 模块驱动实际运行逻辑
- **简单密码保护**：部署时可配置管理员密码，防止他人修改数据

---

## 技术栈

| 类别 | 技术 |
|------|------|
| 后端 | Spring Boot 3.2 + LangChain4j（RAG + Function Calling + Skill Pack 驱动 Prompt）+ H2 |
| 前端 | React 18 + Vite + Monaco Editor |
| AI | 智谱 GLM（glm-4.6v、glm-4-flash、glm-4v-plus 等） |
| RAG | 面经按字段分块（实习/项目/八股/大模型/算法）+ 多路召回简单 rerank（向量 + 关键词） |
| 技能体系 | 项目内 Skill Packs（`src/main/resources/skill-packs`）+ Java Capabilities（`src/main/java/.../capability`） |
| 代码执行 | Piston API（可自建） |

---

## 本地快速开始

### 1. 克隆与配置

```bash
git clone https://github.com/alvinxx1123/sspOffer-interview-assistant.git
cd sspOffer-interview-assistant
```

在 `src/main/resources/` 下创建 `application-local.yml`（不提交到 Git）：

```yaml
zhipu:
  apiKey: "你的智谱API_Key"

# 可选：管理员密码
app:
  admin-password: "你的密码"
```

也可使用环境变量：

```bash
export ZHIPU_API_KEY=xxx
export APP_ADMIN_PASSWORD=xxx
```

### 2. 启动

```bash
# 终端 1：后端
mvn spring-boot:run

# 终端 2：前端
cd frontend && npm install && npm run dev
```

浏览器访问：

- 开发态前端：http://localhost:5173
- 若已有前端打包产物，也可直接访问后端静态页：http://localhost:8080

### 3. 可选配置

- **联网搜索算法题原题**：在 `application-local.yml` 中配置 `app.algorithm-search`（如 SearchCans/Bing/Serper），未命中题库时可返回力扣等链接
- **智谱 Embedding**：在 `application.yml` 中配置 `zhipu.apiKey` 后，RAG 默认使用智谱 Embedding-2；未配置则使用本地 AllMiniLM
- **图片简历解析建议**：优先上传 PDF；图片解析目前依赖智谱视觉模型，若后续引入本地 OCR（如 Tesseract），则部署环境中也需要安装对应 OCR 引擎或打进 Docker 镜像

---

## 评分体系

### 1. 本场完整面试评价

结束当前模拟面试后，系统会基于**本场完整问答记录**生成结构化评价，包括：

- 总分（0-100）
- 维度分：正确性、深度、结构、表达、风险意识
- 亮点
- 不足
- 改进建议
- 缺失关键点
- 建议补强

### 2. 系统历史对比分析

若存在历史面试样本，系统会额外输出：

- 历史样本数
- 历史平均分
- 本场相对历史差值
- 相比历史的进步
- 相比历史的不足
- 保持稳定的方面
- 建议优先加强

历史详情接口也会在读取旧会话时自动补齐 `comparison` 字段，减少旧数据缺失造成的展示不完整问题。

---

## Skill Pack 架构

项目内新增了 5 个可维护的 skill pack，用于将“规则、参考标准、模板”从 Java 代码中抽离：

- `interview-flow-skill`
  - 作用：控制面试官追问节奏，避免重复念题和跑题
- `resume-grounding-skill`
  - 作用：从简历中抽取候选人画像，让题目更贴近实习/项目/技术栈
- `interview-evaluation-skill`
  - 作用：统一单题点评与整场评价的维度、语言、输出格式
- `history-comparison-skill`
  - 作用：把本场表现与历史会话进行维度级对比
- `experience-cleaning-skill`
  - 作用：清洗 OCR / 手动录入面经，提升 RAG 语料质量

每个 skill pack 结构类似：

```text
skill-packs/<skill-name>/
├── SKILL.md
├── references/
└── templates/
```

运行时由 [SkillPackService](/Users/alvin/workspace/sspOffer/interview-assistant/src/main/java/com/interview/assistant/service/SkillPackService.java) 加载，并注入到：

- 出题链路：`InterviewAgentService`
- 会话链路：`InterviewChatService`
- 评分/历史对比链路：`InterviewCoachingService`
- 面经清洗链路：`ImageParseService`、`InterviewDataService`

---

## 主要接口

- `POST /api/interviews/questions`
  - 生成整套深挖题
- `POST /api/interviews/questions/stream`
  - SSE 流式生成深挖题与思考过程
- `POST /api/interviews/chat-session`
  - 与面试官继续深挖当前题
- `POST /api/interviews/chat-session/end`
  - 结束会话并生成本场完整评分
- `POST /api/interviews/coach/answer`
  - 查看参考答案（辅助功能）
- `POST /api/interviews/coach/followups`
  - 查看可继续深挖点（辅助功能）
- `POST /api/interviews/coach/evaluate`
  - 当前回答点评（辅助功能）
- `GET /api/interviews/chat-sessions`
  - 获取历史会话列表
- `GET /api/interviews/chat-sessions/by-id/{id}`
  - 获取历史会话详情（含本场评分与历史对比）

---

## 打包与部署（阿里云 ECS）

在项目根目录执行：

```bash
./scripts/deploy.sh
scp target/interview-assistant-1.0.0.jar root@你的公网IP:/opt/
```

服务器上（首次需配置环境变量或 `/opt/interview-assistant.env`，见下方“开机自启”）：

```bash
sudo pkill -9 java
sudo systemctl restart interview-assistant
```

**开机自启（systemd）**：将 `ZHIPU_API_KEY`、`APP_ADMIN_PASSWORD` 写在 `/opt/interview-assistant.env` 或 Service 的 `Environment` 中，然后：

```bash
systemctl daemon-reload
systemctl enable interview-assistant
systemctl start interview-assistant
```

若你的前端是通过后端静态页访问 `http://<server>:8080`，每次部署前都要先执行 `frontend/npm run build` 或直接运行 `./scripts/deploy.sh`，确保最新前端产物被复制进 `target/classes/static`。

若未来引入本地 OCR（例如 Tesseract）用于图片简历解析，需要注意：

- 仅在本机安装 OCR 引擎并不足够
- 部署到阿里云 ECS 时，目标服务器或 Docker 镜像中也必须具备相同 OCR 依赖
- 纯 Java 代码会打进 jar，但系统级 OCR 二进制不会自动跟随 jar 上传

更详细的部署与“提交到 GitHub 且不提交敏感配置”说明见 [docs/部署与提交说明.md](docs/部署与提交说明.md)。

---

## 项目结构

```text
interview-assistant/
├── src/main/java/
│   ├── .../service/            # Agent 编排、RAG、评分、SkillPackService
│   └── .../capability/         # 运行时能力模块（原 skill，已重命名）
├── src/main/resources/
│   ├── application.yml
│   ├── application-local.yml
│   └── skill-packs/            # 项目内 .md skill 包（规则、reference、template）
├── frontend/
├── scripts/
│   ├── deploy.sh
│   └── run_rag_experiment.sh
├── docs/
└── pom.xml
```

---

## 文档索引

| 文档 | 说明 |
|------|------|
| [部署与提交说明](docs/部署与提交说明.md) | 打包部署、推送到 GitHub（不提交 application.yml） |
| [对比实验-面经RAG与通用大模型](docs/对比实验-面经RAG与通用大模型.md) | RAG+智谱 vs 直接上传 DeepSeek/ChatGPT 的差异与实验步骤 |
| [优化方案-面经RAG与对话升级](docs/优化方案-面经RAG与对话升级.md) | 面经分块、Embedding、Prompt 等方案说明 |
| [自建Piston代码执行](docs/自建Piston代码执行.md) | 代码执行超时或不可用时自建 Piston |
| [后端技术栈与改进建议](docs/后端技术栈与改进建议.md) | 技术栈与后续优化建议 |

---

## License

[MIT License](./LICENSE)
