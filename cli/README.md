# sspoffer (npm 启动器)

sspOffer 面经助手的 npm 安装入口。本包只含一个零依赖的 Node.js 启动器，
`postinstall` 时会从 GitHub Releases 下载 Spring Boot fat JAR 到 `~/.sspoffer/cache`，
运行时检测 JDK 17+ 并以 `java -jar` 启动，前端已打包进 JAR 的 `static/`。

## 安装

```bash
npm install -g sspoffer
```

> 前置：本机已安装 [JDK 17+](https://adoptium.net/) 与 Node.js 16+。

## 使用

```bash
sspoffer                  # 默认 8080
sspoffer --port 9090 --open
sspoffer -- --debug       # 透传 Spring Boot 参数
```

把 API Key 写入 `~/.sspoffer/.env`（首次启动前）：

```
DEEPSEEK_API_KEY=你的key
ZHIPU_API_KEY=你的key
APP_ADMIN_PASSWORD=可选
```

浏览器访问 http://localhost:8080 即可。H2 数据持久化在 `~/.sspoffer/data`。

## 选项

| 选项 | 说明 |
|------|------|
| `--port <N>` | 监听端口 |
| `--workdir <dir>` | 运行目录（数据/日志存放处） |
| `--open` | 启动后打开浏览器 |
| `-- <args>` | 透传给 Spring Boot 的参数 |
| `-v / --version` | 版本 |
| `-h / --help` | 帮助 |

## 环境变量

| 变量 | 说明 |
|------|------|
| `DEEPSEEK_API_KEY` | DeepSeek 大模型 Key（必填） |
| `ZHIPU_API_KEY` | 智谱 Embedding Key（推荐配：RAG 向量检索；不配也能启动，RAG 降级为关键词搜索） |
| `APP_ADMIN_PASSWORD` | 可选管理员密码 |
| `JAVA_HOME` | 指定 JDK 路径 |
| `SSPOFFER_JAR` | 本地 JAR 路径（开发模式，跳过下载） |
| `SSPOFFER_SKIP_DOWNLOAD=1` | 安装时跳过 JAR 下载 |

## 开发模式

本地构建后直接跑（不发布、不下载）：

```bash
(cd frontend && npm install && npm run build)
mvn -DskipTests package
SSPOFFER_JAR=target/interview-assistant-1.0.0.jar sspoffer
```
