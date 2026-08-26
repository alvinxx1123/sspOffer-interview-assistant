#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const pkg = require('../package.json');

const VERSION = pkg.version;
const cfg = pkg.sspoffer || {};
const REPO = cfg.repo || 'alvinxx1123/sspOffer-interview-assistant';
const MIN_JAVA = cfg.minJava || 17;

const HOME_DIR = path.join(os.homedir(), '.sspoffer');
const CACHE_DIR = path.join(HOME_DIR, 'cache');

function log(msg) { process.stdout.write(`[sspoffer] ${msg}\n`); }

function detectJava() {
  const bin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
  let r;
  try {
    r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  } catch (e) {
    return null;
  }
  if (r.error || r.status !== 0) return null;
  const out = (r.stderr || '') + (r.stdout || '');
  const m = out.match(/version "([0-9]+)(?:\.([0-9]+))?/);
  if (!m) return { bin, major: 0, raw: out };
  let major = parseInt(m[1], 10);
  if (major === 1 && m[2]) major = parseInt(m[2], 10);
  return { bin, major, raw: out };
}

function findJar() {
  if (process.env.SSPOFFER_JAR && fs.existsSync(process.env.SSPOFFER_JAR)) return process.env.SSPOFFER_JAR;
  const cached = path.join(CACHE_DIR, `sspoffer-${VERSION}.jar`);
  if (fs.existsSync(cached)) return cached;
  return null;
}

function loadEnvFile(file) {
  if (!file || !fs.existsSync(file)) return {};
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[k] = v;
  }
  return env;
}

function printHelp() {
  process.stdout.write(
`sspoffer v${VERSION} - sspOffer 面经助手启动器

用法:
  sspoffer [options] [-- spring-boot-args...]

选项:
  --port <N>        监听端口 (默认 8080)
  --workdir <dir>   运行目录，H2 数据库存放于此 (默认 ~/.sspoffer)
  --open            启动后打开浏览器
  -v, --version     输出版本
  -h, --help        显示帮助

说明:
  - 默认仅监听 127.0.0.1（仅本机访问），不设 APP_ADMIN_PASSWORD 即无密码保护
  - 个人桌面使用推荐保持默认；如需对外发布请设置 APP_ADMIN_PASSWORD 并改用 0.0.0.0

配置 (环境变量 或 ~/.sspoffer/.env):
  DEEPSEEK_API_KEY    DeepSeek 大模型 API Key (必填)
  ZHIPU_API_KEY       智谱 Embedding API Key (必填)
  APP_ADMIN_PASSWORD  可选管理员密码
  JAVA_HOME           指定 JDK 17+ 路径
  SSPOFFER_JAR        使用本地 JAR (开发模式)

示例:
  sspoffer
  sspoffer --port 9090 --open
  sspoffer -- --server.port=9090 --debug
`);
}

function parseArgs(argv) {
  // 默认仅监听 127.0.0.1：个人本地使用不设密码也安全，避免暴露到局域网。
  // 需要对外暴露时用 -- --server.address=0.0.0.0 覆盖（后写覆盖先写）。
  const springArgs = ['--server.address=127.0.0.1'];
  const passthrough = [];
  let workdir = HOME_DIR;
  let openBrowser = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { printHelp(); process.exit(0); }
    if (a === '-v' || a === '--version') { log(`sspoffer v${VERSION}`); process.exit(0); }
    if (a === '--open') { openBrowser = true; continue; }
    if (a === '--workdir') { workdir = argv[++i]; continue; }
    if (a.startsWith('--workdir=')) { workdir = a.slice('--workdir='.length); continue; }
    if (a === '--port') { const p = argv[++i]; springArgs.push(`--server.port=${p}`); continue; }
    if (a.startsWith('--port=')) { springArgs.push(`--server.port=${a.slice(7)}`); continue; }
    if (a === '--') continue;
    passthrough.push(a);
  }
  return { springArgs, passthrough, workdir, openBrowser };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const java = detectJava();
  if (!java) {
    process.stderr.write(`[sspoffer] 未找到 Java 运行时，需要 JDK ${MIN_JAVA}+。\n`);
    process.stderr.write(`[sspoffer] 安装 JDK: https://adoptium.net/  或设置 JAVA_HOME。\n`);
    process.exit(1);
  }
  if (java.major && java.major < MIN_JAVA) {
    process.stderr.write(`[sspoffer] 检测到 Java ${java.major}，需要 Java ${MIN_JAVA}+。\n`);
    process.stderr.write(`[sspoffer] 请升级 JDK: https://adoptium.net/\n`);
    process.exit(1);
  }

  const jar = findJar();
  if (!jar) {
    process.stderr.write(`[sspoffer] 未找到应用 JAR (v${VERSION})。\n`);
    process.stderr.write(`[sspoffer] 请重新安装: npm install -g sspoffer\n`);
    process.stderr.write(`[sspoffer] 或本地构建后设置 SSPOFFER_JAR 环境变量。\n`);
    process.exit(1);
  }

  fs.mkdirSync(args.workdir, { recursive: true });

  const userEnv = loadEnvFile(path.join(HOME_DIR, '.env'));
  const localEnv = loadEnvFile(path.join(process.cwd(), '.env'));
  // 优先级: shell 环境变量 > cwd/.env > ~/.sspoffer/.env
  const env = { ...userEnv, ...localEnv, ...process.env };

  const allArgs = ['-jar', jar, ...args.springArgs, ...args.passthrough];
  const portArg = args.springArgs.find((a) => a.startsWith('--server.port='));
  const port = portArg ? portArg.split('=')[1] : '8080';

  log(`Java:    ${java.bin} (v${java.major})`);
  log(`JAR:     ${jar}`);
  log(`Workdir: ${args.workdir}`);
  log(`启动中... http://localhost:${port}  (Ctrl+C 退出)`);

  if (!process.env.DEEPSEEK_API_KEY && !userEnv.DEEPSEEK_API_KEY && !localEnv.DEEPSEEK_API_KEY) {
    log('提示: 未配置 DEEPSEEK_API_KEY，请在 ~/.sspoffer/.env 填写后重启。');
  }

  const child = spawn(java.bin, allArgs, { cwd: args.workdir, env, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));

  if (args.openBrowser) {
    const cmd = process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'start'
      : 'xdg-open';
    const openArgs = process.platform === 'win32' ? ['', `http://localhost:${port}`] : [`http://localhost:${port}`];
    const opener = spawn(cmd, openArgs, { detached: true, stdio: 'ignore' });
    opener.unref();
  }
}

main();
