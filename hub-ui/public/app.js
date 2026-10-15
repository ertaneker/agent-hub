'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (path, method = 'GET', body) => {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Hub': '1' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};
const fmtT = (ts) => new Date(ts).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

const S = { provs: null, provsAt: 0, rate: null, agents: [], cur: null, msgs: {}, more: {}, tab: null, stream: '', running: new Set(), hist: [], hi: -1 };
const cur = () => S.agents.find((a) => a.id === S.cur);
try { S.cur = localStorage.getItem('hub.cur'); } catch { /* */ }

// ── markdown (küçük) ──
function md(src) {
  const parts = String(src).split(/```/);
  return parts.map((p, i) => {
    if (i % 2) return `<pre>${esc(p.replace(/^[\w+-]*\n/, ''))}</pre>`;
    let h = esc(p);
    h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
    h = h.replace(/^#{1,3} (.+)$/gm, '<h3>$1</h3>');
    h = h.replace(/((?:^[-*] .+\n?)+)/gm, (m) => '<ul>' + m.trim().split('\n').map((l) => `<li>${l.replace(/^[-*] /, '')}</li>`).join('') + '</ul>');
    return h.split(/\n{2,}/).map((b) => (/^<(h3|ul|pre)/.test(b.trim()) ? b : `<p>${b.replace(/\n/g, '<br>')}</p>`)).join('');
  }).join('');
}

// ── sol liste ──
function renderSide() {
  $('#agentList').innerHTML = S.agents.map((a) => {
    const st = S.running.has(a.id) ? 'running' : a.status;
    const b = a.pending ? `<span class="badge" title="izin bekliyor">${a.pending}</span>` : a.queued ? `<span class="badge" style="background:var(--faint)">${a.queued}</span>` : '';
    const sub = { running: 'çalışıyor…', waiting: 'izin bekliyor', idle: a.role || 'hazır', error: 'hata' }[st] || a.role || '';
    return `<button class="ag ${a.id === S.cur ? 'sel' : ''}" data-id="${a.id}" title="Çift tıkla: yeniden adlandır"><span class="em">${esc(a.emoji)}</span><span class="nm"><b>${esc(a.name)}${a.tg_on ? ' <span title="Kendi Telegram botu var: @' + esc(a.tg_username) + '" style="color:var(--acc)">✈</span>' : ''}</b><small>${esc(sub)}</small></span>${b}<span class="dot ${st}"></span></button>`;
  }).join('') || '<div class="side-label" style="padding:12px">Henüz agent yok</div>';
  const n = S.running.size;
  const rt = S.rate ? ` · limit %${S.rate.five ?? '?'} (5sa) %${S.rate.week ?? '?'} (hafta)` : '';
  $('#sideFoot').textContent = `${S.agents.length} agent · ${n} çalışıyor${rt}`;
  const pend = S.agents.reduce((s, a) => s + (a.pending || 0), 0);
  document.title = `${pend ? '(' + pend + ') ' : ''}Agent Hub`;
}
$('#agentList').onclick = (e) => { const b = e.target.closest('.ag'); if (b) select(b.dataset.id); };
$('#agentList').ondblclick = async (e) => {
  const b = e.target.closest('.ag'); if (!b) return;
  const a = S.agents.find((x) => x.id === b.dataset.id); if (!a) return;
  const nn = prompt(`"${a.name}" için yeni ad (diğer agent'lara duyurulur):`, a.name);
  if (nn && nn.trim() && nn.trim() !== a.name) { try { await api(`/agents/${a.id}`, 'PATCH', { name: nn.trim() }); await refresh(); } catch (err) { alert(err.message); } }
};

async function select(id) {
  S.cur = id; S.stream = '';
  try { localStorage.setItem('hub.cur', id); } catch { /* */ }
  renderSide(); renderTop();
  await loadMsgs(id);
  renderChat(true); renderCards();
  if (S.tab) renderPanel();
  $('#input').focus();
}
function renderTop() {
  const a = cur();
  if (!a) { $('#topInfo').innerHTML = '<b>Agent Hub</b><small>Soldan bir agent seç ya da yeni oluştur</small>'; $('#btnStop').hidden = true; return; }
  const k = (n) => (n >= 1000 ? Math.round(n / 1000) + ' bin' : n);
  const ratio = a.ctx_limit ? a.ctx_tokens / a.ctx_limit : 0;
  const col = ratio > 0.85 ? 'var(--err)' : ratio > 0.6 ? 'var(--warn)' : 'var(--ok)';
  const meter = `<span title="Modelin her turda yeniden okuduğu bağlam. Sınıra gelince otomatik /compact çalışır." style="color:${col}">bağlam ${k(a.ctx_tokens)}${a.ctx_limit ? ' / ' + k(a.ctx_limit) : ''}</span> · <span style="color:${a.budget && a.budget.blocked ? 'var(--err)' : 'inherit'}" title="Tahmini maliyet (abonelikte gerçek fatura değildir)">bugün $${((a.budget && a.budget.spent) || a.cost_today || 0).toFixed(2)}${a.budget && a.budget.lim ? ' / $' + a.budget.lim.toFixed(2) : ''}</span>`;
  const prov = a.provider ? (S.provs || []).find((p) => p.id === a.provider) : null;
  const badges = [a.isolate ? '📁 kopya' : '', a.sandbox === 'docker' ? '🛡 docker' : a.sandbox === 'restricted' ? '🛡 kısıtlı' : '', a.gate_cmd ? '🚦 kapı' : '', prov ? `🔁 ${prov.name}` : '', a.held_until > Date.now() ? '⏸ limit doldu, bekliyor' : ''].filter(Boolean).map((x) => `<span class="pill">${esc(x)}</span>`).join('');
  $('#topInfo').innerHTML = `<b>${esc(a.emoji)} ${esc(a.name)}</b><small>${esc(a.cwd)} · ${esc(a.model)} · 👤 ${esc((a.account && a.account.email) || 'giriş yok')} · ${({ ask: 'Sor', balanced: 'Dengeli', free: 'Özgür' })[a.autonomy]} · ${meter} ${badges}</small>`;
  $('#btnStop').hidden = !S.running.has(a.id);
  // model seçici: Claude modelleri + bağlı (açık) model sağlayıcıları (ör. DeepSeek); ayarlara girmeden değiştirilir
  const pvs = (S.provs || []).filter((p) => p.enabled && (p.kind === 'bat' || (p.base_url && p.has_token)));
  const sm = $('#selModel');
  sm.innerHTML = ['sonnet', 'opus', 'haiku'].map((m) => `<option value="${m}">${m}</option>`).join('')
    + pvs.map((p) => `<option value="prov:${esc(p.id)}">🔁 ${esc(p.name)}${p.model ? ' · ' + esc(p.model) : ''}</option>`).join('');
  $('#selMode').value = a.perm_mode || 'auto'; sm.value = a.provider && pvs.some((p) => p.id === a.provider) ? `prov:${a.provider}` : a.model;
  $('#bgBadge').hidden = !a.bg; $('#bgBadge').textContent = `⚙ ${a.bg} arka plan görevi`;
}
$('#selMode').onchange = async (e) => { await api(`/agents/${S.cur}/mode`, 'POST', { mode: e.target.value }); refresh(true); };
$('#selModel').onchange = async (e) => {
  const v = e.target.value; const a = cur();
  try {
    if (v.startsWith('prov:')) await api(`/agents/${S.cur}/provider`, 'POST', { provider: v.slice(5) });
    else { if (a && a.provider) await api(`/agents/${S.cur}/provider`, 'POST', { provider: '' }); await api(`/agents/${S.cur}/model`, 'POST', { model: v }); }
  } catch (err) { alert(err.message); }
  refresh(true);
};

// ── sohbet ──
async function loadMsgs(id, before) {
  const r = await api(`/agents/${id}/messages?limit=200${before ? '&before=' + before : ''}`);
  S.msgs[id] = before ? [...r.messages, ...(S.msgs[id] || [])] : r.messages;
  S.more[id] = r.more;
  if (r.running) S.running.add(id); else S.running.delete(id);
}
function msgHtml(m) {
  const t = m.role;
  if (t === 'assistant') return `<div class="m assistant">${md(m.text)}</div>`;
  if (t === 'tool') return `<div class="m tool">${esc(m.text)}</div>`;
  if (t === 'tool_result') return `<div class="m tool_result ${m.meta.is_error ? 'err' : ''}">${esc(m.text)}</div>`;
  if (t === 'agent_in') return `<div class="m agent_in"><small>↘ agent mesajı · ${fmtT(m.ts)}</small>${esc(m.text)}${cur() && cur().autonomy === 'ask' ? `<br><button data-process="${m.id}">İşle</button>` : ''}</div>`;
  if (t === 'user') return `<div class="m user">${esc(m.text)}</div>`;
  return `<div class="m system ${m.meta.is_error ? 'err' : ''}">${esc(m.text)}</div>`;
}
function renderChat(bottom) {
  const el = $('#chat'); const list = S.msgs[S.cur] || [];
  if (!cur()) { el.innerHTML = '<div class="empty">Soldan bir agent seç ya da <b>+ Yeni agent</b> ile oluştur.</div>'; return; }
  const stick = bottom || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  el.innerHTML = (S.more[S.cur] ? '<button class="more" id="btnMore">Daha eski mesajlar</button>' : '') +
    (list.length ? list.map(msgHtml).join('') : `<div class="empty">${esc(cur().emoji)} <b>${esc(cur().name)}</b><br>Henüz konuşma yok. Aşağıdan yazarak başla.</div>`) +
    (S.stream ? `<div class="m assistant cursor">${md(S.stream)}</div>` : S.running.has(S.cur) ? '<div class="m system cursor">çalışıyor</div>' : '');
  if (stick) el.scrollTop = el.scrollHeight;
}
$('#chat').onclick = async (e) => {
  const t = e.target;
  if (t.id === 'btnMore') { const f = (S.msgs[S.cur] || [])[0]; if (f) { await loadMsgs(S.cur, f.id); renderChat(false); } }
  else if (t.classList.contains('tool_result')) t.classList.toggle('open');
  else if (t.dataset.process) { const m = S.msgs[S.cur].find((x) => x.id == t.dataset.process); if (m) send(m.text.replace(/^[^:]*: /, '[agent mesajı] ')); }
};

// ── gönder ──
async function send(text, decision) {
  const a = cur(); if (!a) return;
  text = text.trim(); if (!text) return;
  if (text.startsWith('/')) { if (await slash(text)) return; }
  try {
    const r = await api(`/agents/${a.id}/send`, 'POST', { text, decision });
    if (r.similar) return showSimilar(text, r.similar);
    S.hist.unshift(text); S.hi = -1;
    $('#cards .sim-card')?.remove();
  } catch (e) { alert(e.message); }
}
async function slash(t) {
  const [c, ...r] = t.split(/\s+/);
  if (c === '/durdur') { api(`/agents/${S.cur}/stop`, 'POST'); return true; }
  if (c === '/beyin') { openTab('brain'); return true; }
  if (c === '/sinir') { openTab('limits'); return true; }
  if (c === '/akis') { openTab('feed'); return true; }
  if (c === '/gonder') {
    const to = r.shift(); const text = r.join(' ');
    const tgt = S.agents.find((x) => x.id === to || x.name.toLowerCase() === (to || '').toLowerCase());
    if (!tgt || !text) { alert('Kullanım: /gonder <agent> <mesaj>'); return true; }
    await api('/ctl', 'POST', { agent: cur().id, cmd: 'send', args: [tgt.id, text] });
    return true;
  }
  return false; // bilinmeyen / komutu agent'a olduğu gibi gider
}
function showSimilar(text, sim) {
  const el = document.createElement('div'); el.className = 'card sim-card';
  el.innerHTML = `<h4>🔁 Benzer bir iş daha önce yapılmış</h4>` + sim.map((s) =>
    `<div class="sim"><b>${esc(s.agent_name)}</b> · ${fmtT(s.ts)} · benzerlik %${s.score}<br>“${esc(s.title)}” — ${esc(String(s.body).slice(0, 220))}<br><button class="btn pri" data-reuse="${s.id}">Aynısını al ve uyarla</button></div>`).join('') +
    `<div class="row"><button class="btn" data-rebuild>Yeniden inşa et</button><button class="btn" data-cancel>Vazgeç</button></div>`;
  el.onclick = async (e) => {
    const t = e.target;
    if (t.dataset.reuse) { el.remove(); send(text, { mode: 'reuse', board_id: Number(t.dataset.reuse) }); }
    else if (t.hasAttribute('data-rebuild')) { el.remove(); send(text, { mode: 'rebuild' }); }
    else if (t.hasAttribute('data-cancel')) el.remove();
  };
  $('#cards').prepend(el);
}

// ── izin kartları ──
async function renderCards() {
  const keep = [...document.querySelectorAll('#cards .sim-card')];
  $('#cards').innerHTML = ''; keep.forEach((k) => $('#cards').append(k));
  if (!S.cur) return;
  const { items } = await api(`/agents/${S.cur}/approvals`);
  for (const ap of items) $('#cards').append(approvalCard(ap));
}
function toolSummary(ap) {
  const i = ap.input || {};
  if (ap.tool === 'Bash') return `<pre>${esc(i.command || '')}</pre>${i.description ? `<small>${esc(i.description)}</small>` : ''}`;
  if (i.file_path) return `<code>${esc(i.file_path)}</code>${i.old_string !== undefined ? `<pre>- ${esc(String(i.old_string).slice(0, 600))}\n+ ${esc(String(i.new_string || '').slice(0, 600))}</pre>` : i.content ? `<pre>${esc(String(i.content).slice(0, 900))}</pre>` : ''}`;
  return `<pre>${esc(JSON.stringify(i, null, 1).slice(0, 700))}</pre>`;
}
function approvalCard(ap) {
  const el = document.createElement('div'); el.className = 'card';
  const resolve = async (body) => { const r = await api(`/approvals/${ap.id}`, 'POST', body); if (r.message && /geçerli değil/.test(r.message)) alert(r.message); refresh(); renderCards(); };
  if (ap.kind === 'question') {
    const qs = (ap.input.questions || []);
    el.innerHTML = `<h4>❓ Agent soruyor</h4>` + qs.map((qq, qi) => `<div data-qi="${qi}" style="margin:8px 0"><b>${esc(qq.header || '')}</b> ${esc(qq.question)}<br>${qq.options.map((o, oi) => `<button class="btn qopt" data-qi="${qi}" data-oi="${oi}" title="${esc(o.description || '')}">${esc(o.label)}</button>`).join('')}<input type="text" data-other="${qi}" placeholder="Başka bir cevap yaz…"></div>`).join('') +
      `<div class="row"><button class="btn pri" data-go>Cevapla</button><button class="btn" data-skip>Geç</button></div>`;
    el.onclick = (e) => {
      const t = e.target;
      if (t.classList.contains('qopt')) { const qq = qs[t.dataset.qi]; if (!qq.multiSelect) el.querySelectorAll(`.qopt[data-qi="${t.dataset.qi}"]`).forEach((x) => x.classList.remove('on')); t.classList.toggle('on'); }
      else if (t.hasAttribute('data-go')) {
        const answers = {};
        qs.forEach((qq, qi) => { const other = el.querySelector(`[data-other="${qi}"]`).value.trim(); const sel = [...el.querySelectorAll(`.qopt.on[data-qi="${qi}"]`)].map((x) => qq.options[x.dataset.oi].label); answers[qq.question] = other || sel.join(', ') || (qq.options[0] || {}).label; });
        resolve({ action: 'allow', answers });
      } else if (t.hasAttribute('data-skip')) resolve({ action: 'deny' });
    };
  } else if (ap.kind === 'plan') {
    el.innerHTML = `<h4>📋 Agent bir plan sundu</h4><div class="m assistant" style="max-width:none">${md(String(ap.input.plan || ''))}</div><input type="text" id="plMsg" placeholder="Değişiklik istiyorsan yaz (Reddet ile birlikte gider)"><div class="row"><button class="btn pri" data-a="once">Planı onayla</button><button class="btn" data-a="deny">Reddet / değiştir</button></div>`;
    el.onclick = (e) => { const a = e.target.dataset.a; if (a) resolve({ action: a, message: a === 'deny' ? ($('#plMsg').value.trim() ? `Kullanıcı planı reddetti: ${$('#plMsg').value.trim()}` : undefined) : undefined }); };
  } else {
    el.innerHTML = `<h4>🔒 İzin gerekiyor: ${esc(ap.tool)}</h4>${toolSummary(ap)}<div class="row"><button class="btn pri" data-a="once">Bir kez izin ver</button><button class="btn" data-a="always" title="Bu kural kalıcı olarak eklenir: ${esc(ap.tools.join(', '))}">Hep izin ver</button><button class="btn" data-a="deny">Reddet</button></div>`;
    el.onclick = (e) => { const a = e.target.dataset.a; if (a) resolve({ action: a }); };
  }
  return el;
}

// ── giriş kutusu ──
const inp = $('#input');
const grow = () => { inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 220) + 'px'; };
const HUB_CMDS = [['durdur', 'çalışan işi kes (Esc)'], ['beyin', 'beyin paneli'], ['sinir', 'sınırlar paneli'], ['akis', 'ortak akış'], ['gonder', 'başka agent’a mesaj: /gonder <agent> <mesaj>']];
let slashIdx = 0;
function slashMatches() {
  const v = inp.value; if (!v.startsWith('/') || /\s/.test(v)) return [];
  const w = v.slice(1).toLowerCase(); const a = cur(); if (!a) return [];
  const cli = (a.slash || []).map((x) => (typeof x === 'string' ? { n: x, d: '' } : x)).filter((x) => !HUB_CMDS.some((h) => h[0] === x.n)).map((x) => [x.n, x.d || 'Claude komutu / skill']);
  const all = [...HUB_CMDS, ...cli];
  const starts = all.filter((c) => c[0].toLowerCase().startsWith(w));
  const rest = all.filter((c) => !starts.includes(c) && (c[0].split(':').pop().toLowerCase().startsWith(w) || (w.length >= 3 && c[0].toLowerCase().includes(w))));
  return [...starts, ...rest].slice(0, 12);
}
function renderSlash() {
  const m = slashMatches(); const box = $('#slashBox');
  box.hidden = !m.length; if (slashIdx >= m.length) slashIdx = 0;
  box.innerHTML = m.map((c, i) => `<div data-cmd="${esc(c[0])}" class="${i === slashIdx ? 'on' : ''}"><b>/${esc(c[0])}</b><span>${esc(c[1])}</span></div>`).join('');
}
$('#slashBox').onclick = (e) => { const d = e.target.closest('[data-cmd]'); if (d) { inp.value = '/' + d.dataset.cmd + ' '; renderSlash(); inp.focus(); } };
inp.oninput = () => { grow(); renderSlash(); };
inp.onkeydown = (e) => {
  const sm = slashMatches();
  if (sm.length && e.key === 'Tab') { e.preventDefault(); inp.value = '/' + sm[slashIdx][0] + ' '; renderSlash(); return; }
  if (sm.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); slashIdx = (slashIdx + (e.key === 'ArrowDown' ? 1 : sm.length - 1)) % sm.length; renderSlash(); return; }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); const v = inp.value; inp.value = ''; grow(); renderSlash(); send(v); }
  else if (e.key === 'Escape') api(`/agents/${S.cur}/stop`, 'POST');
  else if (e.key === 'ArrowUp' && !inp.value) { S.hi = Math.min(S.hi + 1, S.hist.length - 1); inp.value = S.hist[S.hi] || ''; }
  else if (e.key === 'ArrowDown' && S.hi >= 0) { S.hi--; inp.value = S.hi >= 0 ? S.hist[S.hi] : ''; }
};
$('#btnSend').onclick = () => { const v = inp.value; inp.value = ''; grow(); send(v); inp.focus(); };
$('#btnStop').onclick = () => api(`/agents/${S.cur}/stop`, 'POST');

// ── sağ panel ──
function openTab(t) { S.tab = S.tab === t ? null : t; applyPanel(); }
function applyPanel() {
  $('#app').classList.toggle('panel-open', !!S.tab);
  $('#panel').hidden = !S.tab;
  document.querySelectorAll('#panelTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
  if (S.tab) renderPanel();
}
$('#panelTabs').onclick = (e) => { const t = e.target.dataset.tab; if (t) openTab(t); };
$('#panelClose').onclick = () => { S.tab = null; applyPanel(); };

async function renderPanel() {
  const a = cur(); const body = $('#panelBody');
  if (S.tab === 'feed') return renderFeed(body);
  if (!a) { body.innerHTML = '<p class="sub">Önce bir agent seç.</p>'; return; }
  if (S.tab === 'sched') return renderSched(a, body);
  if (S.tab === 'env') return renderEnv(a, body);
  if (S.tab === 'quota') return renderQuota(a, body);
  if (S.tab === 'brain') {
    const [mem, dec] = await Promise.all([api(`/agents/${a.id}/memory`), api(`/agents/${a.id}/decisions`)]);
    body.innerHTML = `<h3>🧠 Beyin</h3><p class="sub">Agent her turda bunları okur: kimliği, hedefleri, çalışma tarzı ve öğrendikleri.</p>
      <label class="fld">Kimlik ve hedefler</label><textarea id="fBrain" placeholder="Örn: Sen backend uzmanısın. Hedefim: ...">${esc(a.brain)}</textarea>
      <button class="btn pri save" id="saveBrain">Kaydet</button>
      <label class="fld">Kalıcı hafıza (agent kendi de ekler: <code>hubctl remember</code>)</label>
      <div id="memList">${mem.items.map((m) => `<div class="item"><button class="del" data-m="${m.id}" title="sil">×</button>${esc(m.text)}<br><small>${fmtT(m.ts)}</small></div>`).join('') || '<p class="sub">Henüz yok.</p>'}</div>
      <input type="text" id="newMem" placeholder="Hafızaya not ekle ve Enter"><label class="fld">Karar günlüğü</label>
      ${dec.items.map((d) => `<div class="item"><span class="tag">${esc(d.kind)}</span>${esc(d.text)}<br><small>${fmtT(d.ts)}</small></div>`).join('') || '<p class="sub">Henüz karar yok.</p>'}`;
    $('#saveBrain').onclick = async () => { await api(`/agents/${a.id}`, 'PATCH', { brain: $('#fBrain').value }); refresh(); };
    $('#newMem').onkeydown = async (e) => { if (e.key === 'Enter' && e.target.value.trim()) { await api(`/agents/${a.id}/memory`, 'POST', { text: e.target.value }); renderPanel(); } };
    $('#memList').onclick = async (e) => { if (e.target.dataset.m) { await api(`/memory/${e.target.dataset.m}`, 'DELETE'); renderPanel(); } };
  } else if (S.tab === 'limits') {
    const c = a.caps;
    body.innerHTML = `<h3>🛡 Sınırlar ve karar mekanizması</h3><p class="sub">Agent yalnızca senin verdiğin yetkiyle çalışır. Sistem bunları araç kuralı olarak zorlar.</p>
      <label class="fld">Özerklik</label><div class="seg">
        ${[['ask', 'Sor', 'Her kapsam dışı iş için izin ister. Diğer agent mesajlarını sen onaylayana kadar işlemez.'], ['balanced', 'Dengeli', 'Verilen yetkilerle serbest çalışır; kapsam dışı iş için izin kartı çıkar. Agent mesajlarını işler.'], ['free', 'Özgür', 'İzin sormadan çalışır (yasaklar yine geçerli). Dikkatli kullan.']].map(([v, n, d]) => `<label><input type="radio" name="aut" value="${v}" ${a.autonomy === v ? 'checked' : ''}> <b>${n}</b><small>${d}</small></label>`).join('')}
      </div>
      <label class="fld">Yetkiler</label>
      <div class="chk"><input type="checkbox" id="cRead" ${c.read ? 'checked' : ''}> Dosya okuma / arama</div>
      <div class="chk"><input type="checkbox" id="cEdit" ${c.edit ? 'checked' : ''}> Dosya düzenleme / oluşturma</div>
      <div class="chk">Komut çalıştırma <select id="cBash" style="width:auto"><option value="0" ${!c.bash ? 'selected' : ''}>Kapalı</option><option value="safe" ${c.bash === 'safe' ? 'selected' : ''}>Yalnızca okuma amaçlı</option><option value="full" ${c.bash === 'full' ? 'selected' : ''}>Serbest</option></select></div>
      <div class="chk"><input type="checkbox" id="cWeb" ${c.web ? 'checked' : ''}> İnternet (arama, sayfa okuma)</div>
      <div class="chk"><input type="checkbox" id="cDel" ${c.delete ? 'checked' : ''}> Silme (rm, del…)</div>
      <div class="chk"><input type="checkbox" id="cPush" ${c.push ? 'checked' : ''}> git push / paket yayınlama</div>
      <div class="chk"><input type="checkbox" id="cMcp" ${c.mcp ? 'checked' : ''}> Harici araçlar (MCP: e-posta, tarayıcı…)</div>
      <label class="fld">Etik kurallar ve sınırlar (agent'a bağlayıcı olarak verilir)</label><textarea id="fEthics" style="min-height:150px">${esc(a.ethics)}</textarea>
      <p class="sub">Not: Claude'un kendi güvenlik ilkeleri her zaman geçerlidir; buradaki kurallar agent'ı daha da kısıtlar ya da kapsamını belirler.</p>
      <label class="fld">Ek izinli araçlar (Hep izin ver dediklerin)</label>
      <textarea id="fAllow" style="min-height:60px" placeholder="Her satıra bir kural: Bash(npm test:*)">${esc(a.allow_extra.join('\n'))}</textarea>
      <label class="fld">Ek yasaklı araçlar</label><textarea id="fDeny" style="min-height:60px" placeholder="Bash(curl:*)">${esc(a.deny_extra.join('\n'))}</textarea>
      <div class="chk"><input type="checkbox" id="fKeep" ${a.keepalive ? 'checked' : ''}> Bilgisayar yeniden açılınca yarım kalan işe devam et</div>
      <div class="chk">Kendiliğinden uyanma (dk, 0 = kapalı): <input type="number" id="fLoop" min="0" value="${a.loop_min}" style="width:80px"></div>
      <button class="btn pri save" id="saveLimits">Kaydet</button>`;
    $('#saveLimits').onclick = async () => {
      const lines = (id) => $(id).value.split('\n').map((x) => x.trim()).filter(Boolean);
      await api(`/agents/${a.id}`, 'PATCH', {
        autonomy: document.querySelector('input[name=aut]:checked').value, ethics: $('#fEthics').value,
        caps: { read: +$('#cRead').checked, edit: +$('#cEdit').checked, bash: $('#cBash').value === '0' ? 0 : $('#cBash').value, web: +$('#cWeb').checked, delete: +$('#cDel').checked, push: +$('#cPush').checked, mcp: +$('#cMcp').checked },
        allow_extra: lines('#fAllow'), deny_extra: lines('#fDeny'), keepalive: +$('#fKeep').checked, loop_min: +$('#fLoop').value || 0,
      });
      refresh();
    };
  } else if (S.tab === 'settings') {
    try { S.tgInfo = await api('/telegram?fresh=1'); } catch { /* */ }
    try { S.accts = (await api('/accounts')).items; } catch { S.accts = []; }
    body.innerHTML = `<h3>⚙ Ayarlar</h3>
      <div class="g2"><div><label class="fld">Simge</label><input type="text" id="sEmoji" value="${esc(a.emoji)}"></div><div><label class="fld">Ad</label><input type="text" id="sName" value="${esc(a.name)}"></div></div>
      <label class="fld">Rol</label><input type="text" id="sRole" value="${esc(a.role)}">
      <label class="fld">Çalışma klasörü</label><input type="text" id="sCwd" value="${esc(a.cwd)}">
      <label class="fld">Ek klasörler (agent'ın okuyup yazabileceği, satır başına bir; örn. \\\\wsl.localhost\\Ubuntu\\home\\...)</label><textarea id="sDirs" style="min-height:60px">${esc(a.add_dirs.join('\n'))}</textarea>
      <label class="fld">Model</label><select id="sModel">${['sonnet', 'opus', 'haiku'].map((m) => `<option ${a.model === m ? 'selected' : ''}>${m}</option>`).join('')}</select>
      <label class="fld">Claude kullanıcısı (bu agent hangi hesapla çalışır)</label>
      <select id="sAcct">${(S.accts || []).map((x) => `<option value="${esc(x.dir)}" ${(x.dir || '') === (a.config_dir || '') ? 'selected' : ''}>${esc(x.email || '(giriş yapılmamış)')}${x.org ? ' · ' + esc(x.org) : ''}${x.dir ? '' : ' — varsayılan'}</option>`).join('')}${(S.accts || []).some((x) => (x.dir || '') === (a.config_dir || '')) ? '' : `<option value="${esc(a.config_dir)}" selected>${esc(a.config_dir)}</option>`}<option value="__custom">Başka klasör yaz…</option></select>
      <input type="text" id="sCfg" value="${esc(a.config_dir)}" placeholder="CLAUDE_CONFIG_DIR klasörü" hidden>
      <small>Şu an: <b>${esc((a.account && a.account.email) || 'giriş yapılmamış')}</b>${a.account && a.account.plan ? ' (' + esc(a.account.plan) + ')' : ''}. Hesabı değiştirirsen bu agent'ın Claude oturumu yenilenir, son konuşma özetle taşınır. Limit dolunca hesap DEĞİŞMEZ; yalnızca model sağlayıcılara geçilir.</small>
      <button class="btn pri save" id="saveSet">Kaydet</button>
      <label class="fld">Bağlam ve token tasarrufu</label>
      <div class="item">Şu an model her turda <b>${Math.round(a.ctx_tokens / 1000)} bin</b> token okuyor. Sınır aşılınca küçük bir model konuşmayı özetler, oturum sıfırlanır; sohbet geçmişi ekranda aynen kalır.<br><br>
        <label class="fld">Otomatik özetleme sınırı</label>
        <select id="sCtx">${[[30000, '30 bin (en ucuz)'], [60000, '60 bin (önerilen)'], [100000, '100 bin'], [150000, '150 bin'], [0, 'Kapalı']].map(([v, n]) => `<option value="${v}" ${a.ctx_limit === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <div class="chk"><input type="checkbox" id="sLight" ${a.light ? 'checked' : ''}> Hafif mod: kullanıcı skill'leri ve ayarları yüklenmez (her turda ~12 bin token daha az; "/" menüsünde yalnızca yerleşik komutlar kalır). Kapalıyken Claude'daki TÜM skill ve eklentilerin gelir.</div>
        <div class="chk"><input type="checkbox" id="sHooks" ${a.hooks ? 'checked' : ''}> Kişisel hook'larım da çalışsın (SessionStart vb.). Kapalıyken hook'lar agent'ı etkilemez.</div>
        <button class="btn" id="sRotate">Özetle ve oturumu sıfırla</button> <button class="btn" id="sKill" title="Süreç kapanır, arka plan görevleri de biter; oturum korunur, sonraki mesajda kaldığı yerden açılır">Süreci kapat</button>
        <br><small>Süreç: ${a.alive ? 'açık' : 'kapalı'}${a.bg ? ` · ${a.bg} arka plan görevi` : ''}. Boşta ${45} dakika kalınca kendiliğinden kapanır, mesaj gelince yeniden açılır.</small></div>
      <label class="fld">Telegram botu</label>
      <div id="tgBox" class="item">${a.tg_username ? '' : (S.tgInfo && S.tgInfo.can_manage_bots ? '<span style="color:var(--ok)">✓ Otomatik bot oluşturma hazır.</span><br><br>' : `<div class="warn" style="margin-bottom:10px">⚠ Otomatik bot oluşturma kapalı. Ana botta <b>Bot Management Mode</b> açık değil.<br>1) <a href="https://t.me/BotFather?startapp" target="_blank" rel="noopener" style="color:var(--acc)">BotFather uygulamasını aç</a><br>2) @${esc((S.tgInfo || {}).username || 'ana bot')} botunu seç<br>3) <b>Bot Management Mode</b>'u aç<br>4) <button class="btn" id="tgRecheck">Tekrar kontrol et</button></div>`)}${a.tg_username ? `<b>@${esc(a.tg_username)}</b> bağlı. Bu agent'a doğrudan o bottan yazabilirsin.<br>Telegram'da görünmüyorsa botu aç ve <b>Başlat</b>'a bas (bot sana ilk mesajı atamaz):<br><a href="https://web.telegram.org/k/#@${esc(a.tg_username)}" target="_blank" rel="noopener" style="color:var(--acc)">Telegram Web'de aç</a> · <a href="https://t.me/${esc(a.tg_username)}" target="_blank" rel="noopener" style="color:var(--acc)">uygulamada aç</a> (masaüstü uygulaman yoksa ilki)<br><br><button class="btn" id="tgRemove">Bağlantıyı kaldır</button>` : `${a.tg_pending ? '<span class="warn">Telegram onayı bekleniyor…</span><br>' : 'Bu agent\'ın kendi botu yok; ana Agent Hub botundan ulaşılır.<br>'}<br><button class="btn pri" id="tgCreate">Bot oluştur</button><br><br><input type="text" id="tgToken" placeholder="ya da BotFather token'ını yapıştır"><button class="btn" id="tgSave" style="margin-top:6px">Token ile bağla</button>`}</div>
      <label class="fld">Tehlikeli bölge</label>
      <button class="btn" id="resetSess">Claude oturumunu sıfırla (geçmiş sohbet kalır, model hafızası silinir)</button><br><br>
      <button class="danger" id="delAgent">Agent'ı ve tüm geçmişini sil</button>`;
    $('#sAcct').onchange = () => { $('#sCfg').hidden = $('#sAcct').value !== '__custom'; };
    $('#saveSet').onclick = async () => { try { await api(`/agents/${a.id}`, 'PATCH', { emoji: $('#sEmoji').value, name: $('#sName').value, role: $('#sRole').value, cwd: $('#sCwd').value, model: $('#sModel').value, config_dir: $('#sAcct').value === '__custom' ? $('#sCfg').value : $('#sAcct').value, add_dirs: $('#sDirs').value.split('\n').map((x) => x.trim()).filter(Boolean), ctx_limit: +$('#sCtx').value, light: +$('#sLight').checked, hooks: +$('#sHooks').checked }); refresh(); } catch (e) { alert(e.message); } };
    if ($('#tgCreate')) $('#tgCreate').onclick = async () => { const r = await api(`/agents/${a.id}/telegram`, 'POST', { action: 'create' }); showTgDialog(a, r); };
    if ($('#tgRecheck')) $('#tgRecheck').onclick = async () => { S.tgInfo = await api('/telegram?fresh=1'); renderPanel(); if (!S.tgInfo.can_manage_bots) alert('Hâlâ kapalı görünüyor. BotFather uygulamasında doğru botu seçtiğinden ve modu açtığından emin ol.'); };
    if ($('#tgSave')) $('#tgSave').onclick = async () => { const r = await api(`/agents/${a.id}/telegram`, 'POST', { action: 'token', token: $('#tgToken').value }); if (r.tg_error) alert(r.tg_error); else refresh(); };
    if ($('#tgRemove')) $('#tgRemove').onclick = async () => { if (confirm('Bot bağlantısı kaldırılsın mı?')) { const r = await api(`/agents/${a.id}/telegram`, 'POST', { action: 'remove' }); if (r.message) alert(r.message); refresh(); } };
    $('#sKill').onclick = async () => { await api(`/agents/${a.id}/kill`, 'POST'); refresh(true); };
    $('#sRotate').onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Özetleniyor…'; const r = await api(`/agents/${a.id}/rotate`, 'POST'); if (!r.ok) alert(r.error || 'Yapılamadı'); await refresh(); renderPanel(); };
    $('#resetSess').onclick = async () => { if (confirm('Model oturumu sıfırlansın mı?')) { await api(`/agents/${a.id}`, 'PATCH', { reset_session: 1 }); } };
    $('#delAgent').onclick = async () => { if (confirm(`"${a.name}"${a.tg_on ? ' (ve Telegram botu bağlantısı)' : ''} ve tüm geçmişi silinsin mi? Geri alınamaz.`)) { const r = await api(`/agents/${a.id}`, 'DELETE'); S.cur = null; if (r.bot) alert(r.bot); refresh(); } };
  }
}
// ── Ortam sekmesi: çalışma kopyası, doğrulama kapısı, sandbox ──
async function renderEnv(a, body) {
  const [info, gt, sb] = await Promise.all([api(`/agents/${a.id}/workspace`, 'POST', { action: 'info' }), api(`/agents/${a.id}/gates`), api('/sandbox')]);
  const radio = (v, n, d) => `<label><input type="radio" name="sbx" value="${v}" ${(a.sandbox || '') === v ? 'checked' : ''}> <b>${n}</b><small>${d}</small></label>`;
  body.innerHTML = `<h3>🧰 Çalışma ortamı</h3><p class="sub">Agent'ın nerede çalıştığı, işini nasıl doğruladığı ve ne kadar yalıtıldığı.</p>
    <label class="fld">Yalıtılmış çalışma kopyası</label>
    <div class="item">${a.isolate
    ? `<b class="ok">Açık (${esc(a.isolate)})</b>: agent ana klasörde değil kendi kopyasında çalışıyor.<br><small>Kopya: ${esc(a.work_dir)}<br>Ana klasör: ${esc(a.cwd)}</small><pre>${esc(info.status || '')}</pre>
       <button class="btn" data-ws="diff">Farkı göster</button> <button class="btn pri" data-ws="merge">${a.isolate === 'git' ? 'Ana depoya birleştir' : 'Yama oluştur'}</button>${a.isolate === 'svn' ? ' <button class="btn" data-ws="apply-patch">Yamayı ana kopyaya uygula</button>' : ''} <button class="btn" data-ws="remove">Kopyayı kaldır</button>`
    : `Kapalı: agent doğrudan <small>${esc(a.cwd)}</small> klasöründe çalışıyor (yanlışlıkla bozabilir).<br>${info.base_kind ? `Bu klasör bir <b>${esc(info.base_kind)}</b> çalışma kopyası. Agent'a ayrı kopya verebilirsin; işi bitince farkı görüp ana depoya alırsın.${info.base_kind === 'git' ? '<br><small>Not: ana depoda commit edilmemiş değişiklikler kopyaya geçmez.</small>' : '<br><small>Not: svn checkout büyük depolarda uzun sürer.</small>'}<br><button class="btn pri" data-ws="create">Yalıtılmış kopya oluştur</button>${a.ws_state === 'creating' ? ' <span class="warn">oluşturuluyor…</span>' : ''}` : '<span class="warn">Klasör git ya da svn değil; yalıtılmış kopya oluşturulamaz.</span>'}`}
      <pre id="wsOut" hidden></pre></div>
    <label class="fld">Doğrulama kapısı (derleme / test)</label>
    <div class="item"><input type="text" id="gCmd" value="${esc(a.gate_cmd)}" placeholder="örn: dotnet build   ya da   npm test">
      <div class="g2c"><div><label class="fld">Otomatik düzeltme denemesi</label><input type="number" id="gTry" min="0" max="6" value="${a.gate_try}"></div><div><label class="fld">Zaman aşımı (sn)</label><input type="number" id="gTo" min="30" value="${a.gate_timeout}"></div></div>
      <small>Agent dosya değiştirince bu komut çalışır. Başarısız olursa çıktı agent'a geri verilir, düzeltir, tekrar çalışır. Hep başarısızsa sana haber verir.</small><br>
      <button class="btn pri" id="gSave">Kaydet</button> <button class="btn" id="gRun" ${a.gate_cmd ? '' : 'disabled'}>Şimdi çalıştır</button>
      ${gt.items.length ? `<div style="margin-top:8px">${gt.items.slice(0, 5).map((g) => `<div class="item"><span class="${g.ok ? 'ok' : 'bad'}">${g.ok ? '✅ geçti' : '❌ başarısız'}</span> <small>${fmtT(g.ts)} · deneme ${g.try + 1}</small>${g.ok ? '' : `<pre>${esc(String(g.tail).slice(-500))}</pre>`}</div>`).join('')}</div>` : ''}${gt.running ? '<br><span class="warn">kapı çalışıyor…</span>' : ''}</div>
    <label class="fld">Sandbox (yalıtım)</label>
    <div class="seg">${radio('', 'Yok', 'Komutlar bilgisayarında, kullanıcı hesabınla çalışır.')}${radio('restricted', 'Kısıtlı (yerleşik)', 'Komut çalıştıran araçlar kapalı; dosya araçları yalnızca çalışma klasöründe. Kişisel skill/ayarlar yüklenmez, hubctl çalışmaz.')}${radio('docker', 'Docker konteyneri', 'Komutlar konteynerde çalışır; yalnızca proje ve defter klasörü görünür, ana bilgisayarın dosyaları ve anahtarları görünmez.')}</div>
    <div class="item" id="sbBox">Docker: ${sb.docker ? '<b class="ok">çalışıyor</b>' : '<b class="bad">kapalı</b> (Docker Desktop\'ı başlat)'} · İmaj: ${sb.image ? '<b class="ok">hazır</b>' : '<b class="bad">yok</b>'}${sb.building ? ' <span class="warn">derleniyor…</span>' : ''}<br>
      ${sb.image ? '' : '<button class="btn pri" id="sbBuild">İmajı derle (birkaç dakika)</button> '}<small id="sbLog"></small>
      <p class="sub">Konteynerde Claude hesabın için kimlik bilgisi kopyası kullanılır; konteynerdeki agent bu kopyayı okuyabilir. Ağ açıktır (API için). Kişisel eklenti skill'leri konteynerde yoktur; ~/.claude/skills klasörü okunur kipte bağlanır. .NET için: sandbox/Dockerfile.dotnet.</p></div>`;
  body.onclick = async (e) => {
    const t = e.target;
    if (t.dataset.ws) {
      const act = t.dataset.ws;
      if (act === 'remove' && !confirm('Yalıtılmış kopya silinsin mi? Birleştirilmemiş değişiklikler kaybolur.')) return;
      if (act === 'merge' && !confirm(a.isolate === 'git' ? 'Agent dalı ana depoya birleştirilsin mi? (ana depoda commit edilmemiş değişiklik varsa reddedilir)' : 'Fark yama dosyası olarak kaydedilsin mi?')) return;
      t.disabled = true;
      const r = await api(`/agents/${a.id}/workspace`, 'POST', { action: act });
      t.disabled = false;
      if (act === 'diff') { const o = $('#wsOut'); o.hidden = false; o.textContent = `${r.status || ''}\n\n${r.diff || '(fark yok)'}`; return; }
      alert(r.ok ? (r.info || 'Tamam') : (r.error || 'Yapılamadı'));
      await refresh(); renderPanel();
    } else if (t.id === 'gSave') { await api(`/agents/${a.id}`, 'PATCH', { gate_cmd: $('#gCmd').value.trim(), gate_try: +$('#gTry').value, gate_timeout: +$('#gTo').value }); await refresh(); renderPanel(); }
    else if (t.id === 'gRun') { await api(`/agents/${a.id}/gate-run`, 'POST'); }
    else if (t.id === 'sbBuild') { const r = await api('/sandbox/build', 'POST'); if (!r.ok) alert(r.error); else { t.disabled = true; t.textContent = 'Derleniyor…'; } }
  };
  body.onchange = async (e) => {
    if (e.target.name !== 'sbx') return;
    const v = e.target.value;
    if (!confirm('Sandbox değişince agent yeni bir model oturumu açar (son konuşma aktarılır). Devam?')) { renderPanel(); return; }
    await api(`/agents/${a.id}`, 'PATCH', { sandbox: v }); await refresh(); renderPanel();
  };
}

// ── Limitler sekmesi: günlük harcama + yedek modeller ──
async function renderQuota(a, body) {
  const [pv, st] = await Promise.all([api('/providers'), api('/settings')]);
  S.provs = pv.items; S.provsAt = Date.now();
  const b = a.budget || { spent: 0, lim: 0 };
  const chain = a.fallback.length ? a.fallback : pv.fallback_default;
  const cur = pv.items.find((p) => p.id === a.provider);
  body.innerHTML = `<h3>💸 Harcama ve yedek modeller</h3><p class="sub">Maliyet, Claude'un bildirdiği TAHMİNİ tutardır; abonelikte gerçek fatura değildir. Yedek sağlayıcılar (DeepSeek vb.) bütçeye yazılmaz, tutarı onların panelinde görürsün.</p>
    <label class="fld">Bu agent'ın günlük sınırı ($, 0 = sınırsız)</label><input type="number" id="qLim" step="0.5" min="0" value="${a.daily_limit}">
    <small>Bugün harcanan: <b>$${b.spent.toFixed(2)}</b>${b.lim ? ` / $${b.lim.toFixed(2)}` : ''}${b.blocked ? ' <b class="bad">· SINIR DOLDU, işler bekliyor</b>' : ''}</small><br>
    <button class="btn" data-bud="add1">+$1</button> <button class="btn" data-bud="add5">+$5</button> <button class="btn" data-bud="off">Bugün sınırsız</button>
    <label class="fld">Tüm agent'lar için günlük toplam ($, 0 = sınırsız)</label><input type="number" id="qTot" step="1" min="0" value="${st.daily_total}"><small>Bugün tüm agent'lar: $${(st.spent_all || 0).toFixed(2)}</small>
    <br><button class="btn pri save" id="qSave">Kaydet</button>
    <label class="fld">Yedek modeller (ana modelin limiti dolunca sırayla denenir)</label>
    <div class="item">${cur ? `<b class="warn">Şu an YEDEK model: ${esc(cur.name)}</b><br><button class="btn" data-prov="">Ana modele dön</button>` : 'Şu an ana model (Claude) kullanılıyor.'}${a.held_until > Date.now() ? `<br><b class="bad">Hepsi dolu; ${new Date(a.held_until).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} civarı kendiliğinden devam eder.</b>` : ''}</div>
    ${pv.items.length ? pv.items.map((p) => `<div class="chk"><input type="checkbox" data-fb="${esc(p.id)}" ${chain.includes(p.id) ? 'checked' : ''}> <b>${esc(p.name)}</b> <small>${esc(p.model || '')}${p.has_token ? '' : ' · token yok!'}${p.enabled ? '' : ' · kapalı'}</small> <button class="btn" data-prov="${esc(p.id)}" style="margin-left:auto">Şimdi buna geç</button></div>`).join('') : '<p class="sub">Henüz sağlayıcı yok.</p>'}
    <small>${a.fallback.length ? 'Bu agent için özel sıra kullanılıyor.' : 'Seçim yapılmazsa genel yedek sırası kullanılır.'}</small><br>
    <button class="btn pri save" id="qFb">Yedek sırasını kaydet</button> <button class="btn" id="qProvMgr">Sağlayıcıları yönet…</button>`;
  body.onclick = async (e) => {
    const t = e.target;
    if (t.dataset.bud) { const r = await api(`/agents/${a.id}/budget`, 'POST', { action: t.dataset.bud }); alert(r.message); await refresh(); renderPanel(); }
    else if (t.dataset.prov !== undefined && t.hasAttribute('data-prov')) { await api(`/agents/${a.id}/provider`, 'POST', { provider: t.dataset.prov }); await refresh(); renderPanel(); }
    else if (t.id === 'qSave') { await api(`/agents/${a.id}`, 'PATCH', { daily_limit: +$('#qLim').value || 0 }); await api('/settings', 'POST', { daily_total: +$('#qTot').value || 0 }); await refresh(); renderPanel(); }
    else if (t.id === 'qFb') { await api(`/agents/${a.id}`, 'PATCH', { fallback: [...body.querySelectorAll('[data-fb]:checked')].map((x) => x.dataset.fb) }); await refresh(); renderPanel(); }
    else if (t.id === 'qProvMgr') openProviders();
  };
  body.onchange = null;
}

// ── model sağlayıcıları penceresi ──
async function openProviders() {
  const m = $('#modal'); m.hidden = false;
  const pv = await api('/providers');
  let accts = []; try { accts = (await api('/accounts')).items; } catch { /* */ }
  m.innerHTML = `<div class="dlg"><h2>👤 Claude hesapları</h2><p class="sub">Her agent ayarlarından kendi Claude kullanıcısını seçer. Limit dolunca agent başka Claude hesabına GEÇMEZ; yalnızca aşağıdaki model sağlayıcılara geçer.</p>${accts.map((x) => `<div class="item"><b>${esc(x.email || '(giriş yapılmamış)')}</b> <small>${esc(x.org || '')} ${esc(x.plan || '')}</small><br><small>${esc(x.dir || 'varsayılan (~/.claude)')} · agent'lar: ${x.agents.length ? esc(x.agents.join(', ')) : '—'}</small></div>`).join('')}<h2>🔁 Model sağlayıcıları</h2><p class="sub">Ana model (Claude) limiti dolunca ya da token'ı bitince agent'lar bu sağlayıcılara geçer. Anthropic uyumlu bir adres gerekir (DeepSeek, GLM, OpenRouter…).</p>
    ${pv.items.map((p) => `<div class="item"><b>${esc(p.name)}</b> <small>${esc(p.model || '')}</small><br><small>${esc(p.base_url || p.bat_path || '')} · ${p.has_token ? 'token var' : '<b class="bad">token yok</b>'}${p.enabled ? '' : ' · kapalı'}</small><br>
      <button class="btn" data-test="${esc(p.id)}">Bağlantıyı dene</button> <button class="btn" data-en="${esc(p.id)}" data-v="${p.enabled ? 0 : 1}">${p.enabled ? 'Kapat' : 'Aç'}</button> <button class="btn" data-del="${esc(p.id)}">Sil</button> <span data-res="${esc(p.id)}" style="margin-left:6px"></span></div>`).join('') || '<p class="sub">Henüz sağlayıcı yok.</p>'}
    <label class="fld">Yeni sağlayıcı</label>
    <input type="text" id="pvName" placeholder="Ad (örn. DeepSeek)"><input type="text" id="pvUrl" placeholder="Adres (örn. https://api.deepseek.com/anthropic)" style="margin-top:6px"><input type="text" id="pvTok" placeholder="API token (saklanır, ekrana geri yazılmaz)" style="margin-top:6px"><input type="text" id="pvModel" placeholder="Model adı (örn. deepseek-chat)" style="margin-top:6px">
    <div class="row"><button class="btn" id="pvClose">Kapat</button><button class="btn pri" id="pvAdd">Ekle</button></div></div>`;
  m.onclick = async (e) => {
    const t = e.target;
    if (t.id === 'pvClose' || t === m) { m.hidden = true; m.onclick = null; refresh(true); }
    else if (t.id === 'pvAdd') { try { await api('/providers', 'POST', { name: $('#pvName').value.trim(), base_url: $('#pvUrl').value.trim(), token: $('#pvTok').value.trim(), model: $('#pvModel').value.trim() }); S.provsAt = 0; openProviders(); } catch (er) { alert(er.message); } }
    else if (t.dataset.test) { const el = m.querySelector(`[data-res="${t.dataset.test}"]`); el.textContent = 'deneniyor…'; const r = await api(`/providers/${t.dataset.test}/test`, 'POST'); el.innerHTML = r.ok ? `<b class="ok">✓ çalışıyor</b> <small>“${esc(r.reply || '')}”</small>` : `<b class="bad">✗ ${esc(r.error || 'hata')}</b>`; }
    else if (t.dataset.en) { await api(`/providers/${t.dataset.en}`, 'PATCH', { enabled: +t.dataset.v }); S.provsAt = 0; openProviders(); }
    else if (t.dataset.del && confirm('Sağlayıcı silinsin mi?')) { await api(`/providers/${t.dataset.del}`, 'DELETE'); S.provsAt = 0; openProviders(); }
  };
}
$('#btnProv').onclick = openProviders;

const DAYN = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
async function renderSched(a, body) {
  const { items } = await api(`/agents/${a.id}/schedules`);
  body.innerHTML = `<h3>⏰ Zamanlama</h3><p class="sub">Bilgisayar açıkken belirlenen saatte çalışır. O saatte kapalıysa 90 dakikaya kadar geç de olsa çalıştırır.</p>
    ${items.map((s) => `<div class="item"><button class="del" data-del="${s.id}" title="sil">×</button><span class="tag">${s.kind === 'command' ? 'komut' : 'agent görevi'}</span><b>${esc(s.label)}</b><br>
      <small>${s.days.length === 7 ? 'her gün' : s.days.map((d) => DAYN[d - 1]).join(' ')} · ${s.times.join(', ')}</small><br>
      <label class="chk"><input type="checkbox" data-en="${s.id}" ${s.enabled ? 'checked' : ''}> açık</label>
      ${s.kind === 'prompt' ? `<label class="chk" title="Her çalışmada eski konuşmayı yeniden okumaz; plan.md ve özetle çalışır"><input type="checkbox" data-fresh="${s.id}" ${s.fresh ? 'checked' : ''}> temiz oturum (token tasarrufu)</label>` : ''}
      <button class="btn" data-run="${s.id}">Şimdi çalıştır</button></div>`).join('') || '<p class="sub">Henüz zamanlama yok.</p>'}
    <label class="fld">Yeni zamanlama</label><input type="text" id="scLabel" placeholder="Ad (örn. Günlük video)">
    <label class="fld">Tür</label><select id="scKind"><option value="prompt">Agent'a görev yaz</option><option value="command">Komut çalıştır (sonucu Telegram'a yazar)</option></select>
    <label class="fld">Günler</label><div>${DAYN.map((d, i) => `<label class="chk" style="display:inline-flex;margin-right:8px"><input type="checkbox" class="scDay" value="${i + 1}" checked> ${d}</label>`).join('')}</div>
    <label class="fld">Saatler (virgülle: 10:00, 14:00)</label><input type="text" id="scTimes" placeholder="10:00, 14:00">
    <label class="fld">İçerik (görev metni ya da komut)</label><textarea id="scPayload"></textarea>
    <button class="btn pri save" id="scAdd">Ekle</button>`;
  body.onclick = async (e) => {
    const t = e.target;
    if (t.dataset.del && confirm('Silinsin mi?')) { await api(`/schedules/${t.dataset.del}`, 'DELETE'); renderSched(a, body); }
    if (t.dataset.run) { await api(`/schedules/${t.dataset.run}/run`, 'POST'); }
  };
  body.onchange = async (e) => {
    if (e.target.dataset.en) await api(`/schedules/${e.target.dataset.en}`, 'PATCH', { enabled: e.target.checked });
    if (e.target.dataset.fresh) await api(`/schedules/${e.target.dataset.fresh}`, 'PATCH', { fresh: e.target.checked });
  };
  $('#scAdd').onclick = async () => {
    const times = $('#scTimes').value.split(',').map((x) => x.trim()).filter((x) => /^\d{1,2}:\d{2}$/.test(x)).map((x) => x.padStart(5, '0'));
    const days = [...document.querySelectorAll('.scDay:checked')].map((x) => +x.value);
    try { await api(`/agents/${a.id}/schedules`, 'POST', { label: $('#scLabel').value, kind: $('#scKind').value, days, times, payload: $('#scPayload').value }); renderSched(a, body); } catch (err) { alert(err.message); }
  };
}
async function renderFeed(body) {
  const { items } = await api('/board');
  body.innerHTML = `<h3>📡 Ortak akış</h3><p class="sub">Agent'ların yaptığı genel işler. Diğer agent'lar bir sonraki turlarında bunlardan haberdar olur.</p>` +
    (items.map((b) => `<div class="item"><button class="del" data-b="${b.id}" title="sil">×</button><span class="tag">${esc(b.agent_emoji || '')} ${esc(b.agent_name || b.agent_id)}</span><b>${esc(b.title)}</b><br>${esc(String(b.body).slice(0, 300))}<br><small>${fmtT(b.ts)}${b.files ? ' · ' + esc(String(b.files).slice(0, 120)) : ''}</small></div>`).join('') || '<p class="sub">Henüz kayıt yok.</p>');
  body.onclick = async (e) => { if (e.target.dataset.b) { await api(`/board/${e.target.dataset.b}`, 'DELETE'); renderFeed(body); } };
}

// ── yeni agent ──
const TEMPLATES = {
  'Genel geliştirici': { role: 'geliştirici', brain: 'Sen dikkatli bir yazılım geliştiricisin. Önce mevcut kodu oku, küçük ve geri alınabilir adımlarla ilerle, değişikliği kısaca raporla.' },
  'Araştırmacı': { role: 'araştırma', brain: 'Sen titiz bir araştırmacısın. Kaynakları karşılaştır, belirsizliği açıkça söyle, bulguları özetle.' },
  'Boş': { role: '', brain: '' },
};
$('#btnNew').onclick = () => {
  const m = $('#modal'); m.hidden = false;
  m.innerHTML = `<div class="dlg"><h2>Yeni agent</h2>
    <div class="g2"><div><label class="fld">Simge</label><input type="text" id="nEmoji" value="🤖"></div><div><label class="fld">Ad</label><input type="text" id="nName" placeholder="backend"></div></div>
    <label class="fld">Şablon</label><select id="nTpl">${Object.keys(TEMPLATES).map((k) => `<option>${k}</option>`).join('')}</select>
    <label class="fld">Rol</label><input type="text" id="nRole" value="${TEMPLATES['Genel geliştirici'].role}">
    <label class="fld">Çalışma klasörü (tam yol)</label><input type="text" id="nCwd" placeholder="D:\\projeler\\api">
    <label class="fld">Model</label><select id="nModel"><option>sonnet</option><option>opus</option><option>haiku</option></select>
    <label class="fld">Beyin (kimlik ve hedefler)</label><textarea id="nBrain">${esc(TEMPLATES['Genel geliştirici'].brain)}</textarea>
    <label class="fld">Özerklik</label><select id="nAut"><option value="balanced">Dengeli</option><option value="ask">Sor (en güvenli)</option><option value="free">Özgür</option></select>
    <div class="chk"><input type="checkbox" id="nTg" checked> Bu agent için ayrı Telegram botu aç (Telegram'da bir kez onaylarsın)</div>
    <p class="sub">Yetkiler başlangıçta güvenli gelir (okuma, düzenleme, salt-okunur komutlar, internet). Silme, push ve serbest komut kapalıdır; sonra "Sınırlar"dan açarsın.</p>
    <div class="row"><button class="btn" id="nCancel">Vazgeç</button><button class="btn pri" id="nOk">Oluştur</button></div></div>`;
  $('#nTpl').onchange = (e) => { const t = TEMPLATES[e.target.value]; $('#nRole').value = t.role; $('#nBrain').value = t.brain; };
  $('#nCancel').onclick = () => { m.hidden = true; };
  $('#nOk').onclick = async () => {
    try {
      const r = await api('/agents', 'POST', { name: $('#nName').value.trim(), emoji: $('#nEmoji').value, role: $('#nRole').value, cwd: $('#nCwd').value.trim(), model: $('#nModel').value, brain: $('#nBrain').value, autonomy: $('#nAut').value, telegram: $('#nTg').checked });
      m.hidden = true; await refresh(); select(r.agent.id);
      if (r.tg_link || r.tg_error) showTgDialog(r.agent, r);
    } catch (e) { alert(e.message); }
  };
  $('#nName').focus();
};

function showTgDialog(agent, res) {
  const m = $('#modal'); m.hidden = false;
  const close = '<div class="row"><button class="btn" id="tgClose">Kapat</button></div>';
  if (res.tg_error) {
    m.innerHTML = `<div class="dlg"><h2>⚠ ${esc(agent.name)}: Telegram botu açılamadı</h2><p>${esc(res.tg_error)}</p>
      <p><a class="btn" href="https://t.me/BotFather?startapp" target="_blank" rel="noopener" style="display:inline-block;text-decoration:none">BotFather uygulamasını aç</a>
      <button class="btn" id="tgRetry">Modu açtım, tekrar dene</button> <button class="btn" id="tgForce" title="Bayrak güncellenmemiş olabilir; bağlantıyı yine de üretir">Yine de bağlantı üret</button></p>
      <label class="fld">Ya da BotFather'dan kendin bot açtıysan token'ı buraya yapıştır</label><input type="text" id="tgTok" placeholder="123456:ABC...">
      <div class="row"><button class="btn" id="tgClose">Sonra</button><button class="btn pri" id="tgGo">Token ile bağla</button></div></div>`;
    $('#tgRetry').onclick = async () => showTgDialog(agent, await api(`/agents/${agent.id}/telegram`, 'POST', { action: 'create' }));
    $('#tgForce').onclick = async () => showTgDialog(agent, await api(`/agents/${agent.id}/telegram`, 'POST', { action: 'create', force: true }));
    $('#tgGo').onclick = async () => { const r = await api(`/agents/${agent.id}/telegram`, 'POST', { action: 'token', token: $('#tgTok').value }); if (r.tg_error) alert(r.tg_error); else { m.hidden = true; refresh(); } };
  } else {
    m.innerHTML = `<div class="dlg" id="tgDlg"><h2>✈ ${esc(agent.name)} için Telegram botu</h2>
      <p>1) Aşağıdaki bağlantıya tıkla, Telegram'da <b>Oluştur</b>'u onayla.<br>2) Yeni bota gidip <b>Başlat</b>'a bas.<br>Gerisini Agent Hub kendisi yapar: token'ı alır, botu bu agent'a bağlar.</p>
      <p><a class="btn pri" href="${esc(res.tg_link)}" target="_blank" rel="noopener" style="display:inline-block;text-decoration:none">Telegram'da botu oluştur</a>
        <a class="btn" href="https://web.telegram.org/k/#?tgaddr=${encodeURIComponent('tg://newbot?' + res.tg_link.split('/newbot/')[1].replace('/', '/'))}" target="_blank" rel="noopener" style="display:inline-block;text-decoration:none" title="Masaüstü Telegram uygulaman yoksa dene">Web'de aç (dene)</a></p>
      <p class="sub">"tg:// ... registered handler" hatası alırsan bilgisayarında Telegram uygulaması yok demektir; web bağlantısını ya da telefonunu kullan.</p>
      <p class="sub">Önerilen kullanıcı adı: @${esc(res.tg_username)} (onay ekranında değiştirebilirsin). Onay bekleniyor…</p>${close}</div>`;
  }
  $('#tgClose').onclick = () => { m.hidden = true; };
}

// ── canlı olaylar ──
function connect() {
  const es = new EventSource('/api/events');
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'msg') {
      (S.msgs[ev.agent] ||= []).push(ev.msg);
      if (ev.agent === S.cur) { if (ev.msg.role === 'assistant') S.stream = ''; renderChat(false); }
    } else if (ev.type === 'delta') {
      if (ev.agent === S.cur) { S.stream += ev.text; renderChat(false); }
    } else if (ev.type === 'delta_end') { if (ev.agent === S.cur) { S.stream = ''; } }
    else if (ev.type === 'run_start') { S.running.add(ev.agent); if (ev.agent === S.cur) { renderTop(); renderChat(false); } refresh(true); }
    else if (ev.type === 'run_end') { S.running.delete(ev.agent); if (ev.agent === S.cur) { S.stream = ''; renderTop(); renderChat(false); renderCards(); } refresh(true); }
    else if (['status', 'agents', 'queue', 'approval'].includes(ev.type)) { refresh(true); if (ev.type === 'approval' && ev.agent === S.cur) renderCards(); }
    else if (ev.type === 'tgbot') { const d = $('#tgDlg'); if (d) d.innerHTML = `<h2>✅ Bot hazır</h2><p>@${esc(ev.username)} bu agent'a bağlandı. Telegram'da ona yazabilirsin.</p><div class="row"><button class="btn pri" id="tgClose2">Tamam</button></div>`; if (d) $('#tgClose2').onclick = () => { $('#modal').hidden = true; }; }
    else if (ev.type === 'gate' && S.tab === 'env' && ev.agent === S.cur) renderPanel();
    else if (ev.type === 'sandbox_log') { const el = $('#sbLog'); if (el) el.textContent = ev.line; }
    else if (ev.type === 'sandbox_done') { if (S.tab === 'env') renderPanel(); }
    else if (ev.type === 'rate') { S.rate = ev.rate; renderSide(); }
    else if (ev.type === 'board' && S.tab === 'feed') renderPanel();
    else if ((ev.type === 'memory' || ev.type === 'decision') && S.tab === 'brain' && ev.agent === S.cur) renderPanel();
  };
  es.onerror = () => { /* otomatik yeniden bağlanır */ };
}
async function refresh(soft) {
  if (!S.provs || Date.now() - S.provsAt > 60000) { try { S.provs = (await api('/providers')).items; S.provsAt = Date.now(); } catch { /* */ } }
  const r = await api('/agents');
  S.agents = r.agents; S.rate = r.rate || S.rate; S.running = new Set(r.running);
  if (S.cur && !cur()) S.cur = null;
  if (!S.cur && S.agents[0]) { return select(S.agents[0].id); }
  renderSide(); renderTop();
  if (!soft) { renderChat(false); renderCards(); if (S.tab) renderPanel(); }
}
connect();
refresh().then(() => { if (S.cur) select(S.cur); });
