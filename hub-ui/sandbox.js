'use strict';
// Docker sandbox: agent'ın komutları konteynerde çalışır; yalnızca bağlanan klasörleri görür.
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const IMAGE = 'agent-hub-sandbox:1';
const MEM = process.env.HUB_SANDBOX_MEM || '4g';
const CPUS = process.env.HUB_SANDBOX_CPUS || '4';
let cache = { at: 0, ok: false };
let building = null;

function dockerUp() {
  if (Date.now() - cache.at < 8000) return cache.ok;
  const r = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  cache = { at: Date.now(), ok: r.status === 0 && !!(r.stdout || '').trim() };
  return cache.ok;
}
const imageExists = (image = IMAGE) => spawnSync('docker', ['image', 'inspect', image], { windowsHide: true }).status === 0;
function status() { return { docker: dockerUp(), image: dockerUp() && imageExists(), building: !!building, image_name: IMAGE }; }

// imajı derle (arka planda). onLog satır satır ilerleme verir.
function build(dir, onLog) {
  if (building) return building;
  building = new Promise((resolve) => {
    const c = spawn('docker', ['build', '-t', IMAGE, '.'], { cwd: dir, windowsHide: true });
    let tail = '';
    const feed = (d) => { const s = d.toString('utf8'); tail = (tail + s).slice(-3000); s.split(/\r?\n/).filter(Boolean).forEach((l) => onLog && onLog(l)); };
    c.stdout.setEncoding('utf8'); c.stderr.setEncoding('utf8'); c.stdout.on('data', feed); c.stderr.on('data', feed);
    c.on('close', (code) => { building = null; resolve({ ok: code === 0, tail }); });
    c.on('error', (e) => { building = null; resolve({ ok: false, tail: String(e) }); });
  });
  return building;
}

// agent'ın konteyner içi ~/.claude klasörü (oturumlar burada kalıcıdır). Hesap kimliği kopyalanır.
function prepareConfig(dataDir, agentId, hostCfgDir, withAccount) {
  const cfg = path.join(dataDir, 'sandbox', agentId, 'claude');
  fs.mkdirSync(cfg, { recursive: true });
  const claudeJson = path.join(cfg, '.claude.json');
  if (!fs.existsSync(claudeJson)) fs.writeFileSync(claudeJson, JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', projects: { '/work': { hasTrustDialogAccepted: true } } }));
  if (withAccount) {
    const src = path.join(hostCfgDir, '.credentials.json');
    const dst = path.join(cfg, '.credentials.json');
    try { if (fs.existsSync(src) && (!fs.existsSync(dst) || fs.statSync(src).mtimeMs > fs.statSync(dst).mtimeMs)) fs.copyFileSync(src, dst); } catch { /* */ }
  }
  return cfg;
}
// konteyner token'ı yeniledi ise ana bilgisayardaki kopyayı da güncelle (yoksa ana oturum kapanabilir)
function syncBack(cfg, hostCfgDir) {
  try {
    const c = path.join(cfg, '.credentials.json'); const h = path.join(hostCfgDir, '.credentials.json');
    if (!fs.existsSync(c) || !fs.existsSync(h)) return;
    if (fs.statSync(c).mtimeMs > fs.statSync(h).mtimeMs && fs.readFileSync(c, 'utf8') !== fs.readFileSync(h, 'utf8')) fs.copyFileSync(c, h);
  } catch { /* */ }
}

// `docker run` argümanları. mounts: [{host, cont, ro}]
function runArgs({ name, image, mounts, envFile, work, interactive, cmd }) {
  const a = ['run', interactive ? '-i' : '--init', '--rm', '--name', name, '--user', 'node', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--memory', MEM, '--cpus', CPUS, '--pids-limit', '1024', '--add-host', 'host.docker.internal:host-gateway', '-w', work || '/work'];
  for (const m of mounts) a.push('-v', `${m.host}:${m.cont}${m.ro ? ':ro' : ''}`);
  if (envFile) a.push('--env-file', envFile);
  a.push(image || IMAGE, ...cmd);
  return a;
}
function kill(name) { try { spawnSync('docker', ['kill', name], { windowsHide: true, timeout: 15000 }); } catch { /* */ } }

// ortam değişkenlerini geçici dosyaya yaz (komut satırında / süreç listesinde görünmesin)
function writeEnvFile(dataDir, name, env) {
  const f = path.join(dataDir, 'prompts', `${name}.env`);
  fs.writeFileSync(f, Object.entries(env).filter(([, v]) => v != null && !/[\r\n]/.test(String(v))).map(([k, v]) => `${k}=${v}`).join('\n'), { mode: 0o600 });
  return f;
}

module.exports = { IMAGE, status, dockerUp, imageExists, build, prepareConfig, syncBack, runArgs, kill, writeEnvFile, homeCfg: () => path.join(os.homedir(), '.claude') };
