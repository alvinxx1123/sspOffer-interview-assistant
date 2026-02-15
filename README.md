<img src="logo.png" alt="sspOffer Logo" width="50%">
                     sspOffer面经助手 - 互联网面试准备平台<br>
                     Live Demo: http://8.138.47.162:8080 <br>               
基于 LangChain4j 的面经整合与 AI 面试准备应用。支持面经搜索、AI 面试模拟、面试复盘、在线算法 IDE。


## 功能特性

- **面经搜索**：按公司、部门检索个人面经，支持手动录入或图片解析
- **AI 面试模拟**：根据目标公司/部门面经(RAG) + 你的简历生成深挖问题
- **面试复盘**：上传真实面经，AI 深度复盘分析，给出改进建议
- **在线 IDE**：支持 Java、Python、Go 等 ACM 模式运行,题库支持手动添加题目
- **简历+投递**：简历管理、投递进度追踪
- **简单密码保护**：部署时可配置管理员密码，防止他人修改数据

## 技术栈

- **后端**：Spring Boot 3.2 + LangChain4j + H2
- **前端**：React 18 + Vite + Monaco Editor
- **AI**：智谱 GLM（glm-4-flash、glm-4v-plus 等）
- **代码执行**：Piston API（免费）

---

## 一、克隆后配置准备

1. **克隆项目**
   ```bash
   git clone https://github.com/alvinxx1123/sspOffer-interview-assistant.git
   cd sspOffer-interview-assistant
   ```

2. **配置智谱 API Key（AI 功能必需）**（可替换）  
   在 `src/main/resources/` 下创建 `application-local.yml`：
   
   ```yaml
   zhipu:
     apiKey: "你的智谱API_Key"
   ```
   
3. **配置管理员密码（可选）**  
   若需密码保护修改操作，在 `application-local.yml` 添加：
   ```yaml
   app:
     admin-password: "你的密码"
   ```
   或设置环境变量：`export ZHIPU_API_KEY=xxx`、`export APP_ADMIN_PASSWORD=xxx`

4. **启动**
   ```bash
   # 后端
   ./mvnw spring-boot:run
   
   # 前端（另一终端）
   cd frontend
   npm install
   npm run dev
   ```
   访问 http://localhost:5173

---

## 二、阿里云部署教程（单机访问网站）

### 方式一：ECS + 单 jar 运行

1. **购买阿里云 ECS**（如 2 核 4G，CentOS 7/8 或 Ubuntu）

2. **在本地打包**
   ```bash
   cd frontend && npm install && npm run build && cd ..
   ./mvn package
   ```
   生成 `target/interview-assistant-1.0.0.jar`

3. **上传到 ECS**
   ```bash
   scp target/interview-assistant-1.0.0.jar root@你的公网IP:/opt/
   ```

4. **在 ECS 上运行**
   ```bash
   ssh root@你的公网IP
   cd /opt
   export ZHIPU_API_KEY=你的API_Key
   export APP_ADMIN_PASSWORD=你的密码
   nohup java -jar interview-assistant-1.0.0.jar --server.port=8080 > app.log 2>&1 &
   ```

5. **开放 8080 端口**  
   阿里云控制台 → 安全组 → 添加入方向规则：TCP 8080

6. **访问**  
   http://你的公网IP:8080

7. **开机自启**（可选）  
   使用 systemd 创建服务：
   ```ini
   # /etc/systemd/system/interview-assistant.service
   [Unit]
   Description=sspOffer Interview Assistant
   After=network.target
   
   [Service]
   User=root
   WorkingDirectory=/opt
   ExecStart=/usr/bin/java -jar /opt/interview-assistant-1.0.0.jar --server.port=8080
   Environment="ZHIPU_API_KEY=你的API_Key"
   Environment="APP_ADMIN_PASSWORD=你的密码"
   Restart=on-failure
   
   [Install]
   WantedBy=multi-user.target
   ```
   ```bash
   systemctl daemon-reload
   systemctl enable interview-assistant
   systemctl start interview-assistant
   ```

---

## 快速开始（本地开发）

### 1. 配置智谱 API Key（AI 功能必需）(可替换自定义大模型API Key)

从 [智谱开放平台](https://open.bigmodel.cn/) 获取 API Key，在 `src/main/resources/` 创建 `application-local.yml`：
```yaml
zhipu:
  apiKey: "你的API_Key"
```

### 2. 启动

```bash
# 后端
./mvnw spring-boot:run

# 前端
cd frontend && npm install && npm run dev
```

访问 http://localhost:5173

---

## 项目结构

```
interview-assistant/
├── src/main/java/          # 后端
├── src/main/resources/
│   ├── application.yml     # 主配置（不含敏感信息）
│   └── application-local.yml  # 本地配置（gitignore）
├── frontend/               # 前端
└── pom.xml
```

---

## License

MIT
