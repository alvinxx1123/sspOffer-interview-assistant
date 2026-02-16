#!/usr/bin/env bash
# 在阿里云 ECS 上运行此脚本：安装 systemd 服务，开机自启，无需手动启动 Spring Boot
# 用法：
#   1. 先把 jar 上传到 /opt/，再上传本脚本到 /opt/
#   2. ssh 登录服务器后： chmod +x /opt/setup-ecs.sh && /opt/setup-ecs.sh
#   3. 按提示编辑 /opt/interview-assistant.env 填入 API Key 和密码，然后 systemctl restart interview-assistant

set -e
JAR_PATH="${1:-/opt/interview-assistant-1.0.0.jar}"
SVC_NAME="interview-assistant"
ENV_FILE="/opt/interview-assistant.env"
UNIT_FILE="/etc/systemd/system/${SVC_NAME}.service"

echo "==> 使用 JAR: $JAR_PATH"
if [ ! -f "$JAR_PATH" ]; then
  echo "错误: 未找到 $JAR_PATH"
  echo "请先将 jar 上传到 /opt/，例如： scp target/interview-assistant-1.0.0.jar root@公网IP:/opt/"
  exit 1
fi

# 检查 Java 17
if ! command -v java &>/dev/null; then
  echo "错误: 未安装 Java。请先安装 Java 17，例如："
  echo "  CentOS/Alibaba Linux: sudo yum install -y java-17-openjdk"
  echo "  Ubuntu/Debian:        sudo apt update && sudo apt install -y openjdk-17-jdk"
  exit 1
fi
JAVA_VER=$(java -version 2>&1 | head -1)
echo "==> 已检测到: $JAVA_VER"

# 环境变量文件（API Key、管理员密码）
if [ ! -f "$ENV_FILE" ]; then
  echo "==> 创建环境变量模板: $ENV_FILE"
  cat > "$ENV_FILE" << 'EOF'
# 智谱 API Key（必填，否则 AI 功能不可用）
ZHIPU_API_KEY=你的智谱API_Key
# 管理员密码（可选，不设则不校验）
APP_ADMIN_PASSWORD=你的管理员密码
EOF
  chmod 600 "$ENV_FILE"
  echo "请编辑该文件填入真实值后，执行: systemctl restart $SVC_NAME"
  echo "  nano $ENV_FILE"
fi

# 安装 systemd 服务
echo "==> 安装 systemd 服务: $UNIT_FILE"
sudo tee "$UNIT_FILE" > /dev/null << EOF
[Unit]
Description=sspOffer Interview Assistant
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt
ExecStart=/usr/bin/java -jar $JAR_PATH --server.port=8080
EnvironmentFile=$ENV_FILE
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

echo "==> 启用并启动服务..."
sudo systemctl daemon-reload
sudo systemctl enable "$SVC_NAME"
sudo systemctl start "$SVC_NAME"

echo ""
echo "==> 部署完成"
echo "  查看状态: systemctl status $SVC_NAME"
echo "  查看日志: journalctl -u $SVC_NAME -f"
echo "  重启服务: systemctl restart $SVC_NAME"
echo ""
echo "请确保安全组已开放 TCP 8080，然后访问: http://你的公网IP:8080"
echo "若已配置 Nginx 反向代理，可访问: http://你的域名"
echo ""

sudo systemctl status "$SVC_NAME" --no-pager || true
