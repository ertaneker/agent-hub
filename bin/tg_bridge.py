#!/usr/bin/env python3
"""Telegram <-> agent köprüsü (terminal yansıtmalı).

Sadece telegram.env içindeki TELEGRAM_CHAT_ID'den gelen mesajları kabul eder.
Yazılan her şey agent'ın terminaline olduğu gibi yazılır; agent'ın çıktısı
(konuşma kaydı) ve onay pencereleri Telegram'a kendiliğinden aktarılır.

Chat ID öğrenmek için: python3 tg_bridge.py --chat-id
"""
import glob
import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from collections import deque

HUB = os.environ.get("AGENT_HUB", os.path.expanduser("~/.agent-hub"))
BIN = os.path.join(HUB, "bin")
AGENT = os.path.join(BIN, "agent")
HUBSH = os.path.join(BIN, "hub.sh")
STATE = os.path.join(HUB, "state")
PANE = "agent-hub:brain"


def load_env():
    env = {}
    with open(os.path.join(HUB, "telegram.env")) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


ENV = load_env()
API = f"https://api.telegram.org/bot{ENV['TELEGRAM_BOT_TOKEN']}/"
CHAT = None


def api(method, **params):
    data = urllib.parse.urlencode(params).encode()
    with urllib.request.urlopen(API + method, data=data, timeout=70) as r:
        return json.load(r)


def send(text):
    text = text or "(boş)"
    for i in range(0, len(text), 4000):
        try:
            api("sendMessage", chat_id=CHAT, text=text[i:i + 4000])
        except Exception as e:  # noqa: BLE001
            print("gönderme hatası:", e, file=sys.stderr)


def sh(*cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    return (r.stdout + r.stderr).strip()


def screen(lines=40):
    return sh("tmux", "capture-pane", "-p", "-t", PANE, "-S", f"-{lines}")


def type_into_brain(text):
    text = " ".join(text.splitlines())
    sh("tmux", "send-keys", "-t", PANE, "-l", text)
    time.sleep(0.3)
    sh("tmux", "send-keys", "-t", PANE, "Enter")


def profiles():
    out = sh("bash", "-c", f"source '{HUB}/profiles.sh'; echo $PROFILES")
    return out or "kisisel is deepseek"


HELP = """Telegram, agent'ın terminali gibi çalışır: yazdığın her şey olduğu gibi agent'a gider.
Agent'ın cevapları, yaptığı işler ve onay soruları buraya kendiliğinden gelir.

Onay sorusuna 1, 2, 3 yazarak cevap verirsin.

Kısayollar
/durum — hesap, işçi ayarı ve görevler
/ekran — terminal ekranının anlık görüntüsü (normalde gerekmez)
/hesap <profil> — agent'ı başka hesaba/modele taşı
/isci <profil|serbest> — işçileri tek profile kilitle
/sonuc <id> — bir görevin sonucu
/dur — agent'ın o anki işini kes (Esc)
/esc /enter /yukari /asagi /tab /ctrlc — tuş gönder
/tus <metin> — metni Enter göndermeden yaz
/yenile — agent'ı aynı hesapla yeniden başlat
/sessiz — otomatik aktarımı kapat, /sesli — aç

Listede olmayan bir "/komut" yazarsan (örn. /compact, /clear) agent'a olduğu gibi iletilir."""

KEYS = {"/esc": "Escape", "/enter": "Enter", "/yukari": "Up", "/asagi": "Down",
        "/tab": "Tab", "/ctrlc": "C-c"}
MUTED = False
SENT_BY_TG = deque(maxlen=50)  # Telegram'dan yazılanlar; terminal yankısında tekrar gösterilmez


def handle(text):
    global MUTED
    cmd, _, arg = text.strip().partition(" ")
    cmd = cmd.lower().split("@")[0]
    arg = arg.strip()
    if cmd in ("/start", "/yardim", "/help"):
        return HELP + f"\n\nProfiller: {profiles()}"
    if cmd == "/durum":
        return sh(AGENT, "durum")
    if cmd == "/ekran":
        return screen() or "(ekran boş ya da agent kapalı)"
    if cmd == "/hesap":
        return sh(AGENT, "hesap", arg) if arg else f"kullanım: /hesap <{profiles()}>"
    if cmd == "/isci":
        return sh(AGENT, "isci", arg) if arg else "kullanım: /isci <profil|serbest>"
    if cmd == "/sonuc":
        return sh(HUBSH, "result", arg) if arg else "kullanım: /sonuc <görev id>"
    if cmd == "/yenile":
        return sh(AGENT, "yenile")
    if cmd == "/dur":
        sh("tmux", "send-keys", "-t", PANE, "Escape")
        return "Durdurma sinyali gönderildi. Yeni talimatını yazabilirsin."
    if cmd in KEYS:
        sh("tmux", "send-keys", "-t", PANE, KEYS[cmd])
        return ""
    if cmd == "/tus":
        if not arg:
            return "kullanım: /tus <metin>"
        sh("tmux", "send-keys", "-t", PANE, "-l", arg)
        return "Yazıldı (Enter gönderilmedi)."
    if cmd == "/sessiz":
        MUTED = True
        return "Otomatik aktarım kapalı. Açmak için /sesli"
    if cmd == "/sesli":
        MUTED = False
        return "Otomatik aktarım açık."
    SENT_BY_TG.append(" ".join(text.split()))
    type_into_brain(text)  # "/compact" gibi komutlar dahil, terminaldeki gibi olduğu gibi
    return ""


# ---------------------------------------------------------------- terminal yansıtma
_cfg_cache = {}


def state_get(key):
    try:
        with open(STATE, encoding="utf-8") as f:
            vals = [l.rstrip("\n").split("=", 1)[1] for l in f if l.startswith(key + "=")]
        return vals[-1] if vals else ""
    except OSError:
        return ""


def config_dir(profile):
    if profile not in _cfg_cache:
        _cfg_cache[profile] = sh(
            "bash", "-c",
            f"source '{HUB}/profiles.sh'; profile_env {profile} >/dev/null 2>&1; "
            'echo "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"') or os.path.expanduser("~/.claude")
    return _cfg_cache[profile]


def tool_line(name, inp):
    if name == "Bash":
        c = (inp.get("command") or "").strip()
        if "hub.sh notify" in c or "hub.sh ask" in c:
            return None  # zaten Telegram'a gidiyor
        return "🔧 " + (c.splitlines()[0][:200] if c else "Bash")
    if name in ("Edit", "Write", "Read", "NotebookEdit", "MultiEdit"):
        return f"📄 {name}: {inp.get('file_path') or inp.get('notebook_path') or ''}"
    return f"🔧 {name}"


def user_text(content):
    if isinstance(content, str):
        parts = [content]
    else:
        parts = [b.get("text", "") for b in content if b.get("type") == "text"]
    t = " ".join(p.strip() for p in parts).strip()
    if not t or t.startswith(("<command-", "<local-command", "<system-reminder", "[hub]", "Caveat:")):
        return ""
    return t


class Mirror:
    """Agent'ın konuşma kaydını (transcript) izler ve yeni içeriği döndürür."""

    def __init__(self):
        self.path = None
        self.off = 0

    def current_file(self):
        prof, d = state_get("BRAIN_PROFILE"), state_get("PROJECT_DIR")
        if not prof or not d:
            return None
        base = os.path.join(config_dir(prof), "projects", re.sub(r"[^A-Za-z0-9]", "-", d))
        files = glob.glob(os.path.join(base, "*.jsonl"))
        return max(files, key=os.path.getmtime) if files else None

    def poll(self):
        f = self.current_file()
        if not f:
            return []
        if f != self.path:
            fresh = self.path is not None and time.time() - os.path.getmtime(f) < 30
            self.path = f
            self.off = 0 if fresh else os.path.getsize(f)
        size = os.path.getsize(f)
        if size < self.off:
            self.off = 0
        if size == self.off:
            return []
        with open(f, "rb") as fh:
            fh.seek(self.off)
            data = fh.read(size - self.off)
        cut = data.rfind(b"\n")
        if cut < 0:
            return []
        self.off += cut + 1
        out = []
        for line in data[:cut].decode("utf-8", "replace").splitlines():
            try:
                d = json.loads(line)
            except ValueError:
                continue
            if d.get("isSidechain"):
                continue
            content = (d.get("message") or {}).get("content")
            if d.get("type") == "assistant" and isinstance(content, list):
                for b in content:
                    if b.get("type") == "text" and b.get("text", "").strip():
                        out.append(b["text"].strip())
                    elif b.get("type") == "tool_use":
                        tl = tool_line(b.get("name", ""), b.get("input") or {})
                        if tl:
                            out.append(tl)
            elif d.get("type") == "user" and content:
                t = user_text(content)
                if t and " ".join(t.split()) not in SENT_BY_TG:
                    out.append("💻 " + t)
        return out


PROMPT_RE = re.compile(r"(Do you want to|Esc to cancel|\(y/n\)|❯ ?\d\.|Enter to confirm)")


def prompt_text():
    lines = screen(30).splitlines()
    if not any(PROMPT_RE.search(l) for l in lines):
        return ""
    keep = [l.rstrip() for l in lines if l.strip() and not set(l.strip()) <= set("─╌━│ ")]
    return "\n".join(keep[-22:])


QUESTIONS = [
    (r"Do you want to proceed\?", "Devam edilsin mi?"),
    (r"Do you want to make this edit to (.+?)\?", r"\1 dosyasında bu değişiklik yapılsın mı?"),
    (r"Do you want to create (.+?)\?", r"\1 dosyası oluşturulsun mu?"),
    (r"Do you want to overwrite (.+?)\?", r"\1 dosyasının üzerine yazılsın mı?"),
    (r"Do you want to (.+?)\?", r"Şunu yapmak istiyor musun: \1?"),
]
NOTES = [
    (r"A variable in this command can't be checked before it runs",
     "Komuttaki bir değişken çalışmadan önce denetlenemiyor"),
    (r"Command contains .*", "Komut riskli olabilecek bir yapı içeriyor"),
]
OPTIONS = [
    (r"Yes, and switch to auto mode.*", "Evet, ve otomatik moda geç (bundan sonra sormadan yapsın)"),
    (r"Yes, and don't ask again for (.+)", r"Evet, bir daha sorma: \1"),
    (r"Yes, allow all edits during this session.*", "Evet, bu oturumda tüm düzenlemelere izin ver"),
    (r"Yes, during this session.*", "Evet, bu oturum boyunca"),
    (r"Yes, proceed", "Evet, devam et"),
    (r"Yes", "Evet"),
    (r"No, and tell Claude what to do differently.*", "Hayır, farklı yapmasını söyleyeceğim"),
    (r"No, keep planning.*", "Hayır, planlamaya devam etsin"),
    (r"No", "Hayır"),
]
OPT_RE = re.compile(r"^[\s❯>]*(\d)\.\s+(.*?)\s*$")
NOISE_RE = re.compile(r"(Esc to cancel|Tab to amend|Tip:|auto mode handles|Waiting…|^\s*⎿|Enter to confirm)")


def _tr(text, table):
    for pat, rep in table:
        if re.fullmatch(pat, text.strip()):
            return re.sub(pat, rep, text.strip())
    return None


def friendly_prompt(raw):
    """Claude Code onay ekranını Türkçe, sade bir Telegram mesajına çevirir."""
    question, notes, opts, cmd, desc, kind = "", [], [], [], [], ""
    for l in raw.splitlines():
        s = l.strip()
        m = OPT_RE.match(l)
        if m:
            label = m.group(2).split(" · ")[0]
            opts.append((m.group(1), _tr(label, OPTIONS) or label))
        elif not s or NOISE_RE.search(s):
            continue
        elif _tr(s, QUESTIONS) and s.endswith("?"):
            question = _tr(s, QUESTIONS)
        elif _tr(s, NOTES):
            notes.append(_tr(s, NOTES))
        elif s.startswith("Bash command"):
            kind = "komut"
        elif s.startswith("│"):
            cmd.append(s.lstrip("│ ").rstrip())
        else:
            desc.append(s)
    if len(cmd) > 6:
        cmd = cmd[:3] + ["…"] + cmd[-2:]
    out = ["⚠️ Agent onayını bekliyor"]
    if desc:
        out.append("Ne yapmak istiyor:\n" + "\n".join(desc)[:600])
    if cmd:
        out.append("Çalıştıracağı komut:\n" + "\n".join(cmd)[:900])
    if notes:
        out.append("Not: " + "; ".join(notes))
    out.append(question or "Devam edilsin mi?")
    if opts:
        out.append("\n".join(f"{n}) {t}" for n, t in opts))
        out.append("Cevap için sadece numarayı yaz (örn. 1). Vazgeçmek için /esc")
    else:
        out.append("Cevabını yaz ya da vazgeçmek için /esc")
    return "\n\n".join(out)


def mirror_loop():
    m = Mirror()
    last_prompt, pending = "", ""
    while True:
        time.sleep(2)
        try:
            items = m.poll()
            if items and not MUTED:
                send("\n\n".join(items))
            p = prompt_text()
            if p and p == pending and p != last_prompt and not MUTED:
                last_prompt = p
                send(friendly_prompt(p))
            if not p:
                last_prompt = ""
            pending = p
        except Exception as e:  # noqa: BLE001
            print("yansıtma hatası:", e, file=sys.stderr)


LIMIT_RE = re.compile(
    r"(usage limit|limit reached|limit will reset|resets at|out of (extra )?usage|credit balance)", re.I)
_last_alert = ""


def check_limit():
    """Agent ekranında hesap limiti uyarısı görürse bir kez haber verir."""
    global _last_alert
    hits = [l.strip() for l in screen(8).splitlines() if LIMIT_RE.search(l)]
    if not hits:
        return
    key = hashlib.md5(hits[-1].encode()).hexdigest()
    if key != _last_alert:
        _last_alert = key
        send(f"Agent hesabının kullanım limiti dolmuş olabilir (ekrandaki uyarı, İngilizce):\n{hits[-1]}\n\n"
             f"Başka hesaba geçmek için /hesap <{profiles()}>")


def print_chat_ids():
    res = api("getUpdates", timeout=0)
    seen = {}
    for u in res.get("result", []):
        chat = (u.get("message") or {}).get("chat") or {}
        if chat:
            seen[chat["id"]] = chat.get("first_name") or chat.get("title") or ""
    if not seen:
        print("Mesaj bulunamadı. Önce Telegram'da botuna bir mesaj yaz, sonra tekrar çalıştır.")
    for cid, name in seen.items():
        print(f"TELEGRAM_CHAT_ID={cid}   ({name})")


def main():
    global CHAT
    if "--chat-id" in sys.argv:
        print_chat_ids()
        return
    CHAT = int(ENV["TELEGRAM_CHAT_ID"])
    offset = None
    last_check = 0.0
    send("Agent köprüsü açık. Terminaldeki gibi yaz; agent'ın cevapları buraya otomatik gelir. Kısayollar: /yardim")
    threading.Thread(target=mirror_loop, daemon=True).start()
    while True:
        try:
            params = {"timeout": 50}
            if offset is not None:
                params["offset"] = offset
            for u in api("getUpdates", **params).get("result", []):
                offset = u["update_id"] + 1
                msg = u.get("message") or {}
                if (msg.get("chat") or {}).get("id") != CHAT:
                    continue  # başkalarından gelen mesajları yok say
                text = msg.get("text")
                reply = handle(text) if text else "Şimdilik sadece yazılı mesaj kabul ediyorum."
                if reply:
                    send(reply)
        except Exception as e:  # noqa: BLE001
            print("hata:", e, file=sys.stderr)
            time.sleep(5)
        if time.time() - last_check > 60:
            last_check = time.time()
            try:
                check_limit()
            except Exception as e:  # noqa: BLE001
                print("limit kontrolü:", e, file=sys.stderr)


if __name__ == "__main__":
    main()
