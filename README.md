<img src="logo.png" alt="sspOffer Logo" width="50%">

**sspOffer面经助手** - 互联网面试准备平台  
Live Demo: http://8.138.47.162:8080

基于 LangChain4j 的面经整合与 AI 面试准备应用。支持面经搜索、AI 面试模拟（RAG + 深挖题）、面试复盘、在线算法 IDE，并通过 Function Calling 让大模型自动调用「查面经、查算法题、运行代码」等后端能力。

---

## 功能特性

- **面经搜索**：按公司、部门检索个人面经，支持手动录入或**图片解析**（八股/算法题自动换行、常见 OCR 纠错）
- **AI 面试模拟**：根据目标公司/部门**面经库 RAG** + 简历生成 **9–12 道深挖题**（实习、项目、八股、大模型/算法），**SSE 流式**输出并展示「思考过程」（检索结果、生成进度）
- **面试对话**：生成深挖题后可「与面试官探讨」，结合 RAG 追问/答疑
- **面试复盘**：上传真实面经，AI 深度复盘分析，给出改进建议
- **在线 IDE**：支持 Java、Python、Go 等 ACM 模式运行，题库支持手动添加题目
- **智能助手（Function Calling）**：模型可自动调用「查面经」「查算法题」「运行代码」，返回可点击的纯净链接
- **简历 + 投递**：简历管理、投递进度追踪（编辑时自动滚动到表单并提示「正在编辑」）
- **简单密码保护**：部署时可配置管理员密码，防止他人修改数据

---

## 技术栈

| 类别     | 技术 |
|----------|------|
| 后端     | Spring Boot 3.2 + LangChain4j（RAG + Function Calling）+ H2 |
| 前端     | React 18 + Vite + Monaco Editor |
| AI       | 智谱 GLM（glm-4-flash、glm-4v-plus 等） |
| RAG      | 面经按字段分块（实习/项目/八股/大模型/算法），可选智谱 Embedding 或本地 AllMiniLM |
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

也可使用环境变量：`export ZHIPU_API_KEY=xxx`、`export APP_ADMIN_PASSWORD=xxx`。

### 2. 启动

```bash
# 终端 1：后端
mvn spring-boot:run

# 终端 2：前端
cd frontend && npm install && npm run dev
```

浏览器访问 http://localhost:5173。

### 3. 可选配置

- **联网搜索算法题原题**：在 `application-local.yml` 中配置 `app.algorithm-search`（如 SearchCans/Bing/Serper），未命中题库时可返回力扣等链接。
- **智谱 Embedding**：在 `application.yml` 中配置 `zhipu.apiKey` 后，RAG 默认使用智谱 Embedding-2；未配置则使用本地 AllMiniLM。

---

## 打包与部署（阿里云 ECS）

在项目根目录执行：

```bash
./scripts/deploy.sh
scp target/interview-assistant-1.0.0.jar root@你的公网IP:/opt/
```

服务器上（首次需配置环境变量或 `/opt/interview-assistant.env`，见下方「开机自启」）：

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

更详细的部署与「提交到 GitHub 且不提交敏感配置」说明见 [docs/部署与提交说明.md](docs/部署与提交说明.md)。

---

## 项目结构

```
interview-assistant/
├── src/main/java/              # 后端
├── src/main/resources/
│   ├── application.yml         # 主配置（不含密钥）
│   └── application-local.yml   # 本地配置（gitignore）
├── frontend/                   # 前端
├── scripts/
│   ├── deploy.sh               # 本地打包（前端 build + 后端 jar）
│   └── run_rag_experiment.sh   # 对比实验：深挖题 API 调用并保存结果
├── docs/                       # 项目文档
│   ├── 部署与提交说明.md
│   ├── 对比实验-面经RAG与通用大模型.md
│   ├── 优化方案-面经RAG与对话升级.md
│   ├── 自建Piston代码执行.md
│   └── ...
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
