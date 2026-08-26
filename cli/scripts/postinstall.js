#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const pkg = require('../package.json');

const cfg = pkg.sspoffer || {};
const REPO = cfg.repo || 'alvinxx1123/sspOffer-interview-assistant';
const ASSET = cfg.jarAsset || 'sspoffer.jar';
const VERSION = pkg.version;

const CACHE_DIR = path.join(os.homedir(), '.sspoffer', 'cache');
const JAR_PATH = path.join(CACHE_DIR, `sspoffer-${VERSION}.jar`);

function log(msg) { process.stdout.write(`[sspoffer] ${msg}\n`); }
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }

function download(url, dest, cb) {
  const file = fs.createWriteStream(dest + '.tmp');
  const req = https.get(url, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      file.close(() => fs.unlinkSync(dest + '.tmp'));
      return download(res.headers.location, dest, cb);
    }
    if (res.statusCode !== 200) {
      res.resume();
      file.close(() => { try { fs.unlinkSync(dest + '.tmp'); } catch (e) {} });
      return cb(new Error(`HTTP ${res.statusCode} for ${url}`));
    }
    const total = parseInt(res.headers['content-length'] || '0', 10);
    let got = 0, last = 0;
    res.on('data', (chunk) => {
      got += chunk.length;
      if (total) {
        const pct = Math.floor((got / total) * 100);
        if (pct - last >= 5) { last = pct; process.stdout.write(`\r[sspoffer] downloading ${pct}%`); }
      }
    });
    res.pipe(file);
    file.on('finish', () => file.close(() => {
      if (total) process.stdout.write('\n');
      fs.renameSync(dest + '.tmp', dest);
      cb(null);
    }));
  });
  req.on('error', (err) => {
    try { fs.unlinkSync(dest + '.tmp'); } catch (e) {}
    cb(err);
  });
}

if (process.env.SSPOFFER_SKIP_DOWNLOAD === '1' || process.env.npm_config_sspoffer_skip_download === '1') {
  log('SSPOFFER_SKIP_DOWNLOAD=1, 跳过 JAR 下载。');
  process.exit(0);
}

if (fs.existsSync(JAR_PATH)) {
  log(`JAR 已存在: ${JAR_PATH}`);
  process.exit(0);
}

mkdirp(CACHE_DIR);
const url = `https://github.com/${REPO}/releases/download/v${VERSION}/${ASSET}`;
log(`正在下载 sspoffer v${VERSION} ...`);
log(url);
download(url, JAR_PATH, (err) => {
  if (err) {
    process.stderr.write(`\n[sspoffer] 下载应用 JAR 失败: ${err.message}\n`);
    process.stderr.write(`[sspoffer] 可自行构建:\n`);
    process.stderr.write(`  git clone https://github.com/${REPO}.git\n`);
    process.stderr.write(`  cd sspOffer-interview-assistant && (cd frontend && npm install && npm run build) && mvn -DskipTests package\n`);
    process.stderr.write(`  然后设置 SSPOFFER_JAR=/path/to/interview-assistant-*.jar\n`);
    process.exit(1);
  }
  log(`完成: ${JAR_PATH}`);
});
