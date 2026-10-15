'use strict';
// Telegram köprüsü (tmux/WSL gerektirmez).
//  - connect(): tek bir bota bağlanır (gönder, dosya gönder, mesaj dinle). Hub botu ve agent botları bunu kullanır.
//  - createTelegram(): ana "Agent Hub" botu + yönetici bot (managed bots) işlevleri.
// Ayar: <veri klasörü>/telegram.env  →  TELEGRAM_BOT_TOKEN=...  TELEGRAM_CHAT_ID=...
// Yalnızca TELEGRAM_CHAT_ID'den gelen mesajlar dinlenir.
const fs = require('node:fs');
const path = require('node:path');

function connect({ token, chat, offsetFile, onText, onUpdate, onCallback }) {
  let stopped = false; let ctl = null; let offset = 0;
  try { offset = JSON.parse(fs.readFileSync(offsetFile, 'utf8')).offset || 0; } catch { /* ilk açılış */ }
  const saveOffset = () => { try { fs.writeFileSync(offsetFile, JSON.stringify({ offset })); } catch { /* */ } };
  const call = (m, body, timeout = 20000, signal) => fetch(`https://api.telegram.org/bot${token}/${m}`, { method: 'POST', body, signal: signal || AbortSignal.timeout(timeout) }).then((r) => r.json());
  const form = (o) => new URLSearchParams(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])));

  async function send(text, opts) {
    if (!text) return;
    for (let i = 0; i < text.length; i += 3900) {
      const last = i + 3900 >= text.length;
      const body = { chat_id: chat, text: text.slice(i, i + 3900) };
      if (last && opts && opts.buttons) body.reply_markup = JSON.stringify({ inline_keyboard: opts.buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) });
      try { await call('sendMessage', form(body)); } catch { /* ağ yok */ }
    }
  }
  async function sendFile(file, caption) {
    const sz = fs.statSync(file).size; if (sz > 50 * 1024 * 1024) throw new Error('dosya 50 MB üstü');
    const ext = path.extname(file).toLowerCase();
    const [method, field] = /\.(mp4|mov|webm)$/.test(ext) ? ['sendVideo', 'video'] : /\.(jpg|jpeg|png|webp)$/.test(ext) ? ['sendPhoto', 'photo'] : /\.(mp3|ogg|wav|m4a)$/.test(ext) ? ['sendAudio', 'audio'] : ['sendDocument', 'document'];
    const fd = new FormData(); fd.append('chat_id', chat); if (caption) fd.append('caption', String(caption).slice(0, 1000));
    fd.append(field, new Blob([fs.readFileSync(file)]), path.basename(file));
    const r = await call(method, fd, 120000);
    if (!r.ok) throw new Error(r.description || 'gönderilemedi');
  }
  async function poll() {
    while (!stopped) {
      try {
        ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 35000);
        const r = await call('getUpdates', form({ offset, timeout: 25 }), 0, ctl.signal); clearTimeout(t);
        if (!r.ok) { await new Promise((res) => setTimeout(res, 8000)); continue; }
        for (const u of r.result || []) {
          offset = u.update_id + 1; saveOffset();
          if (onUpdate) { try { await onUpdate(u); } catch { /* */ } }
          const cq = u.callback_query;
          if (cq && onCallback && String(cq.from && cq.from.id) === String(chat)) {
            let ans = '';
            try { ans = await onCallback(cq.data); } catch (e) { ans = 'Hata: ' + e.message; }
            try { await call('answerCallbackQuery', form({ callback_query_id: cq.id, text: String(ans || 'Tamam').slice(0, 180) })); } catch { /* */ }
            try { if (cq.message) await call('editMessageReplyMarkup', form({ chat_id: chat, message_id: cq.message.message_id, reply_markup: JSON.stringify({ inline_keyboard: [] }) })); } catch { /* */ }
            continue;
          }
          const msg = u.message;
          if (msg && String(msg.chat.id) === String(chat) && msg.text && onText) { try { await onText(msg.text); } catch { /* */ } }
        }
      } catch { if (!stopped) await new Promise((res) => setTimeout(res, 5000)); }
    }
  }
  poll();
  return {
    send, sendFile, enabled: true,
    call: (m, o) => call(m, form(o || {})),
    stop() { stopped = true; try { ctl && ctl.abort(); } catch { /* */ } },
  };
}

function createTelegram({ dir, h }) {
  const envFile = path.join(dir, 'telegram.env');
  const stFile = path.join(dir, 'telegram-state.json');
  const cfg = {};
  try {
    for (const l of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m) cfg[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
  } catch { /* ayar yok */ }
  const token = cfg.TELEGRAM_BOT_TOKEN; const chat = String(cfg.TELEGRAM_CHAT_ID || '');
  const enabled = !!(token && chat);
  const none = { enabled: false, chat: '', send: async () => {}, sendFile: async () => { throw new Error('Telegram ayarlı değil'); }, mirror() {}, current: () => '', call: async () => ({}), info: async () => ({ enabled: false }), newBotLink: () => '' };
  if (!enabled) return none;

  let st = { current: '', muted: false };
  try { st = { ...st, ...JSON.parse(fs.readFileSync(stFile, 'utf8')) }; } catch { /* ilk açılış */ }
  const save = () => { try { fs.writeFileSync(stFile, JSON.stringify(st)); } catch { /* */ } };
  const cur = () => h.resolve(st.current) || h.list()[0];

  async function handle(text) {
    const t = text.trim(); let m;
    if (t === '/liste' || t === '/start' || t === '/yardim') {
      return bot.send(`Agent'lar:\n${h.list().map((a) => `${a.id === (cur() || {}).id ? '▶' : '•'} ${a.emoji} ${a.name} (${a.status})${a.tg_username ? ' → @' + a.tg_username : ''}`).join('\n')}\n\nKomutlar:\n/agent <ad> : bu bottan konuşulan agent'ı seç\n/durdur : seçili agent'ın işini kes\n/durum : ne yapıyor\n/gorev <ad> <metin> : başka agent'a görev ver (seçimi değiştirmeden)\n/mod plan|normal|duzenle|serbest|otomatik, /model <ad>, /limit\n/sessiz /sesli : cevap aktarımı\nİzin kartlarında düğmeler var. Düz yazı seçili agent'a gider; /compact, /context gibi Claude komutları doğrudan iletilir. Kendi botu olan agent'a doğrudan onun botundan yazabilirsin.`);
    }
    if (t === '/sessiz' || t === '/sesli') { st.muted = t === '/sessiz'; save(); return bot.send(st.muted ? 'Cevaplar artık aktarılmıyor.' : 'Cevaplar aktarılıyor.'); }
    if ((m = t.match(/^\/agent\s+(.+)$/i))) { const a = h.resolve(m[1]); if (!a) return bot.send('Böyle bir agent yok. /liste'); st.current = a.id; save(); return bot.send(`Artık "${a.name}" ile konuşuyorsun.`); }
    if (t === '/durdur') { const a = cur(); if (a) return bot.send(h.stop(a.id) ? `${a.name} kesildi.` : `${a.name}: çalışan iş yok.`); return undefined; }
    if (/^\/(butce|saglayici|kapi|kopya)\b/i.test(t)) { const a = cur(); if (!a) return undefined; const rr = await h.agentCmd(a.id, t); return bot.send(rr || 'Anlaşılmadı.'); }
    if (t === '/durum') { const a = cur(); return bot.send(a ? h.status(a.id) : 'Henüz agent yok.'); }
    if (t === '/limit') { const r = h.rate(); return bot.send(r ? `Hesap limiti: 5 saatlik %${r.five ?? '?'}, haftalık %${r.week ?? '?'}` : 'Limit bilgisi henüz yok (bir iş çalışınca görünür).'); }
    if ((m = t.match(/^\/gorev\s+(.+?)\s*:\s*([\s\S]+)$/i)) || (m = t.match(/^\/gorev\s+(\S+)\s+([\s\S]+)$/i))) { const a = h.task(m[1].trim(), m[2].trim()); return bot.send(a ? `Görev "${a.name}" agent'ına verildi.` : 'Böyle bir agent yok. /liste'); }
    if ((m = t.match(/^\/mod\s+(\S+)$/i))) { const a = cur(); const md = { plan: 'plan', normal: 'default', duzenle: 'acceptEdits', serbest: 'bypassPermissions', otomatik: 'auto' }[m[1].toLowerCase()]; if (!a || !md) return bot.send('Modlar: plan, normal, duzenle, serbest, otomatik'); await h.mode(a.id, md); return bot.send(`${a.name}: mod ${md}`); }
    if ((m = t.match(/^\/model\s+(\S+)$/i))) { const a = cur(); if (a) { await h.model(a.id, m[1]); return bot.send(`${a.name}: model ${m[1]}`); } return undefined; }
    if ((m = t.match(/^(\d+)\s+(bir|hep|red)$/i))) return bot.send(h.approve(Number(m[1]), { bir: 'once', hep: 'always', red: 'deny' }[m[2].toLowerCase()]));
    const a = cur(); if (!a) return bot.send('Henüz agent yok.');
    h.userText(a.id, t);
    return undefined;
  }
  const offFile = path.join(dir, 'telegram-offset.json');
  if (!fs.existsSync(offFile) && st.offset) { try { fs.writeFileSync(offFile, JSON.stringify({ offset: st.offset })); } catch { /* */ } }
  const bot = connect({ token, chat, offsetFile: offFile, onText: handle, onCallback: (d) => h.callback(d), onUpdate: (u) => (u.managed_bot ? h.managedBot(u.managed_bot) : undefined) });

  let infoCache = null; let infoAt = 0;
  const info = async (fresh) => {
    if (!fresh && infoCache && Date.now() - infoAt < 30000) return infoCache;
    try { const r = await bot.call('getMe'); infoCache = { enabled: true, id: r.result && r.result.id, username: r.result && r.result.username, can_manage_bots: !!(r.result && r.result.can_manage_bots) }; infoAt = Date.now(); } catch { infoCache = { enabled: true, username: '', can_manage_bots: false }; }
    return infoCache;
  };
  return {
    enabled, chat, token, send: bot.send, sendFile: bot.sendFile, call: bot.call, info,
    mirror: (text) => { if (!st.muted) bot.send(text); },
    current: () => (cur() || {}).id,
    newBotLink: (manager, username, name) => `https://t.me/newbot/${manager}/${username}?name=${encodeURIComponent(name)}`,
  };
}

module.exports = createTelegram;
module.exports.connect = connect;
