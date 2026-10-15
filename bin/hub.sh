#!/usr/bin/env bash
# İşçi yöneticisi ve iletişim yardımcısı
#
#   hub.sh run <işçi> <klasör> <görev_dosyası>
#       işçi: deepseek | opus | sonnet | haiku | <profil>:<model>   (örn. is:opus)
#       Sadece model yazılırsa agent'ın şu anki işçi hesabı kullanılır.
#   hub.sh status | result <id> | log <id> | kill <id>
#   hub.sh notify "mesaj"    Telegram'a bilgi gönder
#   hub.sh ask "soru"        Onay iste: Telegram + ~/.agent-hub/onaylar.md
set -uo pipefail
HUB="${AGENT_HUB:-$HOME/.agent-hub}"
BIN="$HUB/bin"
TASKS="$HUB/tasks"
SESSION="agent-hub"
mkdir -p "$TASKS"

# İşçilerin araçları. Komut çalıştırma izni vermek için örn:
#   export WORKER_TOOLS="Read,Write,Edit,Glob,Grep,Bash(npm *),Bash(flutter *)"
WORKER_TOOLS="${WORKER_TOOLS:-Read,Write,Edit,Glob,Grep,WebFetch,WebSearch}"
WORKER_MAX_TURNS="${WORKER_MAX_TURNS:-40}"

state_get() { grep "^$1=" "$HUB/state" 2>/dev/null | tail -1 | cut -d= -f2-; }
meta_get()  { grep "^$2=" "$1/meta" 2>/dev/null | head -1 | cut -d= -f2-; }

tg_send() {
  [ -f "$HUB/telegram.env" ] || return 0
  (
    set -a; source "$HUB/telegram.env"; set +a
    curl -s -m 15 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=${1:0:4000}" > /dev/null
  ) || true
}

# Agent'ın terminaline mesaj yazar (agent'ı uyandırır)
tell_brain() {
  tmux has-session -t "$SESSION" 2>/dev/null || return 0
  tmux send-keys -t "$SESSION:brain" -l "$1"
  sleep 0.3
  tmux send-keys -t "$SESSION:brain" Enter
}

# "<profil>|<model>" döndürür
resolve() {
  local spec="$1" prof="" model="" force
  case "$spec" in
    *:*)                       prof="${spec%%:*}"; model="${spec#*:}" ;;
    opus|sonnet|haiku|claude-*) model="$spec" ;;
    *)                         prof="$spec" ;;
  esac
  force="$(state_get WORKER_FORCE)"
  [ -n "$force" ] && prof="$force"
  [ -z "$prof" ] && prof="$(state_get WORKER_ACCOUNT)"
  [ -z "$prof" ] && prof="kisisel"
  if [ "$prof" = deepseek ]; then model=""; else model="${model:-sonnet}"; fi
  echo "$prof|$model"
}

cmd="${1:-status}"; shift || true
case "$cmd" in
  run)
    [ $# -eq 3 ] || { echo "kullanım: hub.sh run <işçi> <klasör> <görev_dosyası>"; exit 1; }
    [ -f "$3" ] || { echo "görev dosyası yok: $3"; exit 1; }
    dir="$(cd "$2" && pwd)" || exit 1
    r="$(resolve "$1")"; prof="${r%%|*}"; model="${r#*|}"
    # shellcheck source=/dev/null
    ( source "$HUB/profiles.sh"; profile_env "$prof" ) > /dev/null || exit 1
    id="$(date +%m%d-%H%M%S)-$RANDOM"
    t="$TASKS/$id"; mkdir -p "$t"
    cp "$3" "$t/task.md"
    printf 'profile=%s\nmodel=%s\ndir=%s\nstarted=%s\n' "$prof" "$model" "$dir" "$(date '+%F %T')" > "$t/meta"
    echo queued > "$t/status"
    nohup "$BIN/hub.sh" _work "$id" > /dev/null 2>&1 &
    echo $! > "$t/pid"
    echo "$id"
    echo "(işçi: $prof${model:+ / $model})" >&2
    ;;

  _work)  # arka planda çalışan işçi
    t="$TASKS/$1"
    prof="$(meta_get "$t" profile)"; model="$(meta_get "$t" model)"; dir="$(meta_get "$t" dir)"
    # shellcheck source=/dev/null
    source "$HUB/profiles.sh"
    if ! profile_env "$prof" 2> "$t/stderr.log" || ! cd "$dir"; then
      echo failed > "$t/status"; exit 1
    fi
    echo running > "$t/status"
    args=(-p "$(cat "$t/task.md")" --output-format json --permission-mode acceptEdits
          --allowedTools "$WORKER_TOOLS" --max-turns "$WORKER_MAX_TURNS"
          --append-system-prompt "Kullanıcıya yazdığın tüm özet, rapor ve açıklamalar Türkçe olmalı. Kod, komut, dosya adı ve hata mesajları olduğu gibi kalır.")
    [ -n "$model" ] && args+=(--model "$model")
    if claude "${args[@]}" > "$t/result.json" 2>> "$t/stderr.log"; then st=done; else st=failed; fi
    [ "$(cat "$t/status")" = killed ] && exit 0
    echo "$st" > "$t/status"
    date '+%F %T' > "$t/finished_at"
    tell_brain "[hub] Görev $1 ($prof${model:+/$model}) sonucu: $st. Bakmak için: hub.sh result $1"
    ;;

  status)
    printf '%-20s %-9s %-18s %s\n' "GÖREV" "DURUM" "İŞÇİ" "KLASÖR"
    for t in "$TASKS"/*/; do
      [ -d "$t" ] || continue
      w="$(meta_get "$t" profile)"; m="$(meta_get "$t" model)"
      printf '%-20s %-9s %-18s %s\n' "$(basename "$t")" "$(cat "$t/status" 2>/dev/null)" \
        "$w${m:+/$m}" "$(meta_get "$t" dir)"
    done
    ;;

  result)
    t="$TASKS/${1:?id gerekli}"
    echo "durum: $(cat "$t/status" 2>/dev/null)"
    if [ -s "$t/result.json" ]; then
      python3 - "$t/result.json" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    print(open(sys.argv[1]).read()); sys.exit()
print(f"tur sayısı: {d.get('num_turns')}")
print("---")
print(d.get("result") or "(sonuç metni yok)")
PY
    fi
    ;;

  log)  cat "$TASKS/${1:?id gerekli}/stderr.log" 2>/dev/null ;;

  kill)
    t="$TASKS/${1:?id gerekli}"
    echo killed > "$t/status"
    pid="$(cat "$t/pid" 2>/dev/null)"
    [ -n "$pid" ] && { pkill -P "$pid" 2>/dev/null; kill "$pid" 2>/dev/null; }
    echo "durduruldu"
    ;;

  notify)
    tg_send "$*"
    echo "bildirildi"
    ;;

  ask)
    q="$*"
    printf '\n## %s\n%s\n\nCevap: agent terminalinde ya da Telegram'"'"'da yaz.\n' "$(date '+%F %T')" "$q" >> "$HUB/onaylar.md"
    tg_send "$(printf '⚠️ Agent onayını bekliyor\n\n%s\n\nCevabını buraya yazabilirsin.' "$q")"
    if [ "${APPROVAL_OPEN:-0}" = 1 ]; then
      f="$HUB/onaylar.md"
      if command -v notepad.exe >/dev/null; then notepad.exe "$(wslpath -w "$f")" >/dev/null 2>&1 &
      elif command -v open >/dev/null; then open -e "$f"
      elif command -v xdg-open >/dev/null; then xdg-open "$f" >/dev/null 2>&1 &
      fi
    fi
    echo "Onay istendi (terminal, Telegram, onaylar.md). Kullanıcının cevabını bekle."
    ;;

  sendfile)  # hub.sh sendfile <dosya> ["açıklama"]  -> Telegram'a dosya/video/fotoğraf yollar
    f="${1:?kullanım: hub.sh sendfile <dosya> [açıklama]}"; cap="${2:-}"
    [ -f "$f" ] || { echo "dosya yok: $f"; exit 1; }
    [ -f "$HUB/telegram.env" ] || { echo "telegram.env yok"; exit 1; }
    case "${f,,}" in
      *.mp4|*.mov|*.mkv|*.webm|*.avi) method=sendVideo;    field=video ;;
      *.jpg|*.jpeg|*.png|*.webp)      method=sendPhoto;    field=photo ;;
      *.gif)                          method=sendAnimation; field=animation ;;
      *.mp3|*.ogg|*.wav|*.m4a)        method=sendAudio;    field=audio ;;
      *)                              method=sendDocument; field=document ;;
    esac
    size=$(stat -c %s "$f")
    if [ "$size" -gt 49000000 ]; then
      echo "dosya 50 MB sınırını aşıyor ($size bayt); Telegram botu yollayamaz. Küçült ya da yolunu yaz."
      exit 1
    fi
    out="$(
      set -a; source "$HUB/telegram.env"; set +a
      curl -s -m 300 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/$method" \
        -F "chat_id=${TELEGRAM_CHAT_ID}" -F "$field=@$f" -F "caption=${cap:0:1000}"
    )"
    case "$out" in
      *'"ok":true'*) echo "gönderildi: $f" ;;
      *) # fotoğraf/video biçimi reddedilirse belge olarak dene
         if [ "$method" != sendDocument ]; then
           out="$(set -a; source "$HUB/telegram.env"; set +a
             curl -s -m 300 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument" \
               -F "chat_id=${TELEGRAM_CHAT_ID}" -F "document=@$f" -F "caption=${cap:0:1000}")"
           case "$out" in *'"ok":true'*) echo "belge olarak gönderildi: $f"; exit 0 ;; esac
         fi
         echo "gönderilemedi: $out"; exit 1 ;;
    esac
    ;;

  hook-notify)  # Claude Code Notification hook'u: sadece agent oturumunda Telegram'a iletir
    [ -n "${TMUX_PANE:-}" ] || exit 0
    [ "$(tmux display-message -p -t "$TMUX_PANE" '#S' 2>/dev/null)" = "$SESSION" ] || exit 0
    msg="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("message",""))' 2>/dev/null)"
    # İzin pencereleri köprü tarafından ekranla birlikte zaten iletiliyor
    case "$msg" in *ermission*) exit 0 ;; esac
    case "$msg" in
      *"waiting for your input"*) msg="Agent senin yeni talimatını bekliyor." ;;
      "") msg="Agent senden bir cevap bekliyor." ;;
    esac
    tg_send "Agent girdi bekliyor: $msg"
    ;;

  *) echo "komutlar: run | status | result | log | kill | notify | ask | sendfile" ;;
esac
