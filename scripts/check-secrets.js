#!/usr/bin/env node
// Gizli anahtar tarayıcı. Git'e eklenecek (staged) dosyalarda anahtar/token arar; bulursa commit'i durdurur.
// Kullanım: node scripts/check-secrets.js          (staged dosyalar)
//           node scripts/check-secrets.js --all    (git'in izlediği tüm dosyalar)
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RULES = [
  ['Telegram bot token', /\b\d{8,10}:[A-Za-z0-9_-]{34,}\b/],
  ['Anthropic/OpenAI/DeepSeek tarzı anahtar (sk-...)', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['GitHub token', /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/],
  ['AWS erişim anahtarı', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API anahtarı', /\bAIza[0-9A-Za-z_-]{30,}/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Özel anahtar bloğu', /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['Atanmış token/anahtar değeri', /\b(ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|API_KEY|SECRET|TOKEN|PASSWORD)\s*[=:]\s*["']?(?!\$|<|BURAYA|YOUR|xxx|\.\.\.|["']?\s*$)(?=[A-Za-z0-9_\-./+=]*\d)[A-Za-z0-9_\-./+=]{16,}/i],
];
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.woff', '.woff2']);
const ALLOW_FILE = /(^|\/)scripts\/check-secrets\.js$/; // kuralların kendisi

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 });
const all = process.argv.includes('--all');
const files = (all ? git('ls-files') : git('diff', '--cached', '--name-only', '--diff-filter=ACMR')).split(/\r?\n/).filter(Boolean);

let bad = 0;
for (const f of files) {
  if (ALLOW_FILE.test(f) || SKIP_EXT.has(path.extname(f).toLowerCase())) continue;
  let text;
  try { text = all ? fs.readFileSync(f, 'utf8') : git('show', `:${f}`); } catch { continue; }
  if (text.includes('\0')) continue;
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [name, rx] of RULES) {
      if (rx.test(line)) { bad++; console.error(`✗ ${f}:${i + 1}  ${name}`); break; }
    }
  });
}
if (bad) {
  console.error(`\n${bad} olası gizli bilgi bulundu. Commit DURDURULDU. Anahtarı koddan çıkar (hub arayüzünden gir; ~/.agent-hub-ui içinde saklanır).`);
  process.exit(1);
}
if (all) console.log('Temiz: gizli bilgi bulunamadı.');
