#!/usr/bin/env bash
# 本地打包脚本：构建前端 + 后端，生成可部署的 jar
# 用法：./scripts/deploy.sh
set -e
cd "$(dirname "$0")/.."

echo "==> 安装前端依赖并构建..."
cd frontend
npm ci --prefer-offline --no-audit 2>/dev/null || npm install
npm run build
cd ..

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
echo "上传到阿里云 ECS 示例："
echo "  scp $JAR root@你的公网IP:/opt/"
echo ""
echo "在 ECS 上运行示例："
echo "  export ZHIPU_API_KEY=你的API_Key"
echo "  export APP_ADMIN_PASSWORD=你的密码"
echo "  nohup java -jar $(basename "$JAR") --server.port=8080 > app.log 2>&1 &"
echo ""
