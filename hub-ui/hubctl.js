#!/usr/bin/env node
// Agent'ların hub ile konuştuğu küçük komut satırı aracı.
// Kullanım: node hubctl.js <agents|done|send|search|board|remember|mcp> ...
// AGENT_ID ve HUB_URL ortam değişkenlerini sunucu ayarlar.
'use strict';
const [cmd, ...rest] = process.argv.slice(2);
const agent = process.env.AGENT_ID;
const base = process.env.HUB_URL || 'http://127.0.0.1:4747';
if (!agent || !cmd) { console.error('kullanım: hubctl.js <agents|done|send|search|board|remember|mcp> ...'); process.exit(2); }
let args = rest;
if (cmd === 'done') {
  const i = args.indexOf('--tags');
  const tags = i >= 0 ? args[i + 1] || '' : '';
  if (i >= 0) args = args.slice(0, i);
  args = [args[0], args.slice(1).join(' '), tags];
}
fetch(`${base}/api/ctl`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Hub': '1' },
  body: JSON.stringify({ agent, cmd, args }),
}).then((r) => r.json()).then((r) => {
  if (r.error) { console.error(r.error); process.exit(1); }
  console.log(r.text);
}).catch((e) => { console.error('hub erişilemiyor:', e.message); process.exit(1); });
