'use strict';
// Agent başına yalıtılmış çalışma kopyası: git worktree ya da svn checkout.
// Agent ana klasörünüzde değil, kendi kopyasında çalışır; sonucu fark olarak görüp isteğinizle ana depoya alırsınız.
const { spawn, spawnSync, execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const run = (cmd, args, cwd, timeout = 120000) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim(), code: r.status };
};

// klasörün hangi sürüm kontrol sistemine ait olduğunu bul
function detect(dir) {
  const g = run('git', ['rev-parse', '--show-toplevel'], dir);
  if (g.ok) return { kind: 'git', root: path.resolve(g.out.split(/\r?\n/)[0]) };
  const s = run('svn', ['info', '--show-item', 'wc-root'], dir);
  if (s.ok) return { kind: 'svn', root: path.resolve(s.out.split(/\r?\n/)[0]) };
  return { kind: '', root: '' };
}

// git: ana depodan ayrı bir dal + ayrı klasör (git worktree). Henüz commit edilmemiş değişiklikler kopyaya geçmez.
function createGit(agentId, srcDir, destRoot) {
  const d = detect(srcDir); if (d.kind !== 'git') return { ok: false, error: 'Bu klasör bir git deposu değil.' };
  const rel = path.relative(d.root, srcDir);
  const branch = `agent/${agentId}`;
  fs.mkdirSync(path.dirname(destRoot), { recursive: true });
  const exists = run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], d.root).ok;
  const r = exists ? run('git', ['worktree', 'add', destRoot, branch], d.root) : run('git', ['worktree', 'add', '-b', branch, destRoot, 'HEAD'], d.root);
  if (!r.ok) return { ok: false, error: r.out.slice(0, 600) };
  const dirty = run('git', ['status', '--porcelain'], d.root).out.trim();
  return { ok: true, kind: 'git', work: path.join(destRoot, rel), info: `dal ${branch}${dirty ? ' (ana depodaki commit edilmemiş değişiklikler kopyaya GEÇMEDİ)' : ''}` };
}

// svn: aynı adresin temiz bir checkout'u. Büyük depolarda uzun sürer; ilerleme onLog ile bildirilir.
function createSvn(srcDir, destRoot, onLog) {
  const d = detect(srcDir); if (d.kind !== 'svn') return Promise.resolve({ ok: false, error: 'Bu klasör bir svn çalışma kopyası değil.' });
  const url = run('svn', ['info', '--show-item', 'url'], srcDir).out.split(/\r?\n/)[0];
  const rel = path.relative(d.root, srcDir);
  const rootUrl = run('svn', ['info', '--show-item', 'url'], d.root).out.split(/\r?\n/)[0];
  fs.mkdirSync(path.dirname(destRoot), { recursive: true });
  return new Promise((resolve) => {
    const c = spawn('svn', ['checkout', '--quiet', rootUrl || url, destRoot], { windowsHide: true });
    let err = ''; let n = 0;
    const t = setInterval(() => onLog && onLog(`svn checkout sürüyor (${Math.round(++n * 10)} sn)…`), 10000);
    c.stderr.on('data', (x) => { err += x; });
    c.on('close', (code) => { clearInterval(t); resolve(code === 0 ? { ok: true, kind: 'svn', work: path.join(destRoot, rel), info: `checkout: ${rootUrl || url}` } : { ok: false, error: err.slice(0, 600) }); });
    c.on('error', (e) => { clearInterval(t); resolve({ ok: false, error: String(e) }); });
  });
}

function status(kind, work) {
  if (kind === 'git') {
    const st = run('git', ['status', '--short'], work).out;
    const stat = run('git', ['diff', 'HEAD', '--stat'], work).out;
    const ahead = run('git', ['log', '--oneline', '--max-count=20', 'HEAD', '--not', '--remotes'], work).out;
    return { text: [st && 'Değişen dosyalar:\n' + st, stat && 'Özet:\n' + stat, ahead && 'Agent dalındaki commitler:\n' + ahead].filter(Boolean).join('\n\n') || 'Değişiklik yok.' };
  }
  if (kind === 'svn') {
    const st = run('svn', ['status'], work).out;
    return { text: st ? 'Değişen dosyalar:\n' + st : 'Değişiklik yok.' };
  }
  return { text: '' };
}
function diff(kind, work, maxChars = 60000) {
  const out = kind === 'git' ? run('git', ['diff', 'HEAD'], work, 60000).out : kind === 'svn' ? run('svn', ['diff'], work, 60000).out : '';
  return out.length > maxChars ? out.slice(0, maxChars) + '\n… (kısaltıldı)' : out;
}

// git: agent dalını ana depoya birleştir (ana depo temizse). svn: yama dosyası üretir (commit sizin işiniz).
function merge(kind, mainDir, work, agentId, message) {
  if (kind === 'git') {
    const d = detect(mainDir);
    run('git', ['add', '-A'], work);
    const hasChanges = run('git', ['status', '--porcelain'], work).out.trim();
    if (hasChanges) { const c = run('git', ['-c', 'user.name=Agent Hub', '-c', 'user.email=agent-hub@local', 'commit', '-m', message || `agent/${agentId}: çalışma`], work); if (!c.ok) return { ok: false, error: c.out.slice(0, 500) }; }
    if (run('git', ['status', '--porcelain'], d.root).out.trim()) return { ok: false, error: 'Ana depoda commit edilmemiş değişiklikler var. Önce onları commit et ya da sakla (stash), sonra birleştir.' };
    const m = run('git', ['merge', '--no-ff', '-m', `Birleştir: agent/${agentId}`, `agent/${agentId}`], d.root);
    if (!m.ok) { run('git', ['merge', '--abort'], d.root); return { ok: false, error: 'Birleştirme çakıştı, geri alındı:\n' + m.out.slice(0, 600) }; }
    return { ok: true, info: m.out.slice(0, 400) };
  }
  if (kind === 'svn') {
    const patch = path.join(path.dirname(work), `${agentId}.patch`);
    const d = run('svn', ['diff'], work, 120000);
    fs.writeFileSync(patch, d.out);
    return { ok: true, info: `Yama dosyası: ${patch}\nUygulamak için ana kopyada: svn patch "${patch}"`, patch };
  }
  return { ok: false, error: 'Çalışma kopyası yok.' };
}
function applySvnPatch(mainDir, patch) { const r = run('svn', ['patch', patch], mainDir, 120000); return { ok: r.ok, info: r.out.slice(0, 800) }; }

function remove(kind, mainDir, work, destRoot, agentId) {
  if (kind === 'git') {
    const d = detect(mainDir);
    const r = run('git', ['worktree', 'remove', '--force', destRoot], d.root);
    run('git', ['worktree', 'prune'], d.root);
    return { ok: r.ok || !fs.existsSync(destRoot), info: `dal agent/${agentId} ana depoda duruyor (silmek için: git branch -D agent/${agentId})` };
  }
  try { fs.rmSync(destRoot, { recursive: true, force: true }); return { ok: true, info: 'Kopya silindi.' }; } catch (e) { return { ok: false, error: String(e) }; }
}

// çalışma klasöründeki değişikliğin parmak izi (git/svn). Agent dosyayı hangi yolla yazarsa yazsın değişim yakalanır.
const kindCache = new Map();
const execText = (cmd, args, cwd) => new Promise((res) => execFile(cmd, args, { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 60000 }, (e, so) => res(String(so || ''))));
async function fingerprint(dir) {
  if (!kindCache.has(dir)) kindCache.set(dir, detect(dir).kind);
  const kind = kindCache.get(dir); if (!kind) return '';
  const h = crypto.createHash('sha1');
  let untracked = [];
  if (kind === 'git') {
    h.update(await execText('git', ['status', '--porcelain', '-uall'], dir));
    h.update((await execText('git', ['diff', 'HEAD'], dir)).slice(0, 4e6));
    untracked = (await execText('git', ['ls-files', '-o', '--exclude-standard'], dir)).split(/\r?\n/).filter(Boolean);
  } else {
    const st = await execText('svn', ['status'], dir);
    h.update(st); h.update((await execText('svn', ['diff'], dir)).slice(0, 4e6));
    untracked = st.split(/\r?\n/).filter((l) => l.startsWith('?')).map((l) => l.slice(1).trim());
  }
  // takip edilmeyen dosyaların içeriği diff'te görünmez: boyut + son değişiklik zamanı parmak izine girer
  for (const f of untracked.slice(0, 3000)) { try { const stt = fs.statSync(path.join(dir, f)); h.update(`${f}:${stt.size}:${Math.round(stt.mtimeMs)}`); } catch { /* silinmiş */ } }
  return h.digest('hex');
}

module.exports = { fingerprint, detect, createGit, createSvn, status, diff, merge, applySvnPatch, remove, run };
