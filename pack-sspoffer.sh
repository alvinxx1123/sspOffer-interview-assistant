#!/usr/bin/env bash
# 本地打包脚本 — 模拟 AgentRecall 的 npm install -g 流程
# 不依赖 CI / GitHub Actions，本地就能跑通 + 验证

set -e
cd "$(dirname "$0")"
ROOT="$(pwd)"

echo "== 1/4 编译 Spring Boot jar =="
mvn -o package -DskipTests
JAR="$ROOT/target/sspoffer-backend-1.0.0.jar"
[ -f "$JAR" ] || { echo "✗ jar not found: $JAR"; exit 1; }
echo "✓ $JAR ($(du -h $JAR | cut -f1))"

echo "== 2/4 jlink 定制 JRE =="
JRE_DIR="$ROOT/electron/build/jre"
if [ ! -d "$JRE_DIR" ]; then
    JMODS="$(/usr/libexec/java_home -v 17 2>/dev/null)/jmods"
    [ -d "$JMODS" ] || JMODS="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home/jmods"
    [ -d "$JMODS" ] || { echo "✗ 找不到 JDK 17 的 jmods 目录"; exit 1; }
    jlink --module-path "$JMODS" \
        --add-modules java.base,java.logging,java.sql,java.naming,java.management,java.security.jgss,java.desktop,jdk.crypto.ec,java.net.http,jdk.httpserver,jdk.unsupported \
        --output "$JRE_DIR" \
        --strip-debug --no-man-pages --compress=2
fi
echo "✓ JRE ($(du -h $JRE_DIR | cut -f1))"

echo "== 3/4 编译 Electron =="
cd "$ROOT/electron"
npx electron-vite build
echo "✓ Electron app in electron/out/"

echo "== 4/4 打成可 npm install -g 的 tgz =="
cd "$ROOT"
# 创建临时 staging 目录
STAGE=$(mktemp -d)
mkdir -p "$STAGE/sspoffer"
cp -R electron/out "$STAGE/sspoffer/app"
cp "$JAR" "$STAGE/sspoffer/sspoffer-backend.jar"
cp -R "$JRE_DIR" "$STAGE/sspoffer/jre"
mkdir -p "$STAGE/sspoffer/bin"
cat > "$STAGE/sspoffer/bin/sspoffer.cjs" << 'JS_EOF'
#!/usr/bin/env node
"use strict";
const { spawn } = require("node:child_process");
const path = require("node:path");
const os = require("os");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const isWin = process.platform === "win32";
const javaExe = isWin ? "jre/bin/java.exe" : path.join("jre", "Contents", "Home", "bin", "java");
const jar = path.join(ROOT, "sspoffer-backend.jar");

function waitForBackend(port = 8080, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const http = require("http");
    const tick = () => {
      const req = http.get(`http://127.0.0.1:${port}/api/settings/models`, (res) => {
        res.resume(); res.on("end", resolve);
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) reject(new Error("backend timeout"));
        else setTimeout(tick, 500);
      });
      req.setTimeout(2000, () => req.destroy());
    };
    tick();
  });
}

async function main() {
  const javaPath = path.join(ROOT, javaExe);
  if (!fs.existsSync(javaPath)) { console.error("JRE missing:", javaPath); process.exit(1); }
  console.log("[sspOffer] starting Java backend...");
  const jproc = spawn(javaPath, ["-Dfile.encoding=UTF-8", "-jar", jar, "--server.port=8080"],
    { detached: true, stdio: "ignore", windowsHide: true });
  jproc.unref();
  try { await waitForBackend(8080); }
  catch (e) { console.error("[sspOffer] Java backend never became ready"); process.exit(1); }
  
  const electronPath = require("electron");
  const appEntry = path.join(ROOT, "app", "main", "index.js");
  console.log("[sspOffer] launching Electron...");
  const eproc = spawn(electronPath, [appEntry], { detached: true, stdio: "ignore" });
  eproc.unref();
}
main().catch(e => { console.error(e); process.exit(1); });
JS_EOF
chmod +x "$STAGE/sspoffer/bin/sspoffer.cjs"

cat > "$STAGE/sspoffer/package.json" << 'JSON_EOF'
{
  "name": "sspoffer",
  "version": "0.1.0",
  "description": "AI 模拟面试 / 实习项目解析 / 面经复盘 - 桌面应用",
  "bin": { "sspoffer": "bin/sspoffer.cjs" },
  "engines": { "node": ">=20" },
  "dependencies": { "electron": "34.5.8" }
}
JSON_EOF

# 打 tgz
cd "$STAGE"
tar -czf "$ROOT/sspoffer-0.1.0.tgz" sspoffer
echo "✓ 打包完成: $ROOT/sspoffer-0.1.0.tgz ($(du -h $ROOT/sspoffer-0.1.0.tgz | cut -f1))"

echo
echo "=== 测试本地安装 ==="
echo "执行: npm install -g $ROOT/sspoffer-0.1.0.tgz"
echo "然后: sspoffer"
echo
echo "=== 上传 GitHub Release 时 ==="
echo "gh release create v0.1.0 $ROOT/sspoffer-0.1.0.tgz --title 'sspOffer v0.1.0'"
