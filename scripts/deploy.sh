#!/usr/bin/env bash
# 本地打包脚本：构建前端 + 后端，生成可部署的 jar
# 用法：./scripts/deploy.sh
set -e
cd "$(dirname "$0")/.."

# 注：前端构建（`npm run build`）会在 `frontend/dist` 下产出静态资源；
# 启动 Spring Boot 时会从 `classpath:/static/` 提供给浏览器并自动回退到 `index.html`，
# 无需手动复制。如果重新构建了前端，需要 `mvn clean package` 让 `frontend/dist` 内容
# 被 maven-resources-plugin 复制到 target/classes/static/。

echo "==> Maven 打包..."
mvn -q package -DskipTests

JAR=$(ls -t target/interview-assistant-*.jar 2>/dev/null | head -1)
if [ -z "$JAR" ]; then
  echo "错误: 未找到 target/interview-assistant-*.jar"
  exit 1
fi

echo ""
echo "==> 打包完成: $JAR"
echo ""
echo "本地直接跑（推荐）："
echo "  export LLM_API_KEY=你的DeepSeek_Key     # LLM，大模型对话/出题/复盘/视觉 OCR"
echo "  export EMBEDDING_API_KEY=你的智谱Key    # 推荐配：RAG 向量检索；不配也能启动，RAG 降级为关键词"
echo "  export APP_ADMIN_PASSWORD=你的密码      # 可选，开启后台写接口校验"
echo "  java -jar $(basename "$JAR") --server.port=8080"
echo ""
echo "或者直接走桌面端（更省心，自带 JRE）："
echo "  ./pack-sspoffer.sh    # 产出 sspoffer-0.1.0.tgz，npm install -g 后 sspoffer 即可"
echo ""
