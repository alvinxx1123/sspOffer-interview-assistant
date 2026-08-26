#!/usr/bin/env bash
# 一键起 sspOffer：Spring Boot 后端 + Electron 桌面端
# 任意窗口 Ctrl+C 都会清掉两个进程

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
SB_LOG="/tmp/sspoffer-sb.log"
ELEC_LOG="/tmp/sspoffer-elec.log"

cleanup() {
  echo
  echo "→ 关闭 Spring Boot (PID=$SB_PID) ..."
  [ -n "$SB_PID" ] && kill "$SB_PID" 2>/dev/null || true
  wait "$SB_PID" 2>/dev/null || true
  echo "→ 关闭 Electron (PID=$ELEC_PID) ..."
  [ -n "$ELEC_PID" ] && kill "$ELEC_PID" 2>/dev/null || true
  wait "$ELEC_PID" 2>/dev/null || true
  echo "✓ done"
}
trap cleanup EXIT INT TERM

echo "== 1/2 启动 Spring Boot 后端（端口 8080）=="
cd "$ROOT"
mvn -o spring-boot:run -DskipTests > "$SB_LOG" 2>&1 &
SB_PID=$!
echo "Spring Boot PID=$SB_PID, 日志 $SB_LOG"
echo "→ 等待后端就绪..."

# 等 /actuator/health 或 /api/settings/models 返回 200
for i in $(seq 1 60); do
  if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/api/settings/models | grep -q "200"; then
    echo "✓ 后端就绪"
    break
  fi
  if ! kill -0 "$SB_PID" 2>/dev/null; then
    echo "✗ Spring Boot 启动失败，查看日志：$SB_LOG"
    tail -50 "$SB_LOG"
    exit 1
  fi
  sleep 1
done

echo "== 2/2 启动 Electron 桌面端 =="
cd "$ROOT/electron"
npx electron-vite dev > "$ELEC_LOG" 2>&1 &
ELEC_PID=$!
echo "Electron PID=$ELEC_PID, 日志 $ELEC_LOG"

# 等 Electron 退或 Ctrl+C
wait "$ELEC_PID"
