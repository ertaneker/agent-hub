#!/usr/bin/env bash
# Kurulum:  ./install.sh [ek_claude_ayar_klasörü ...]
# Örnek:    ./install.sh ~/.claude-is
# Varsayılan ~/.claude her zaman dahil edilir. Güncelleme için tekrar çalıştırmak güvenlidir;
# profiles.sh ve telegram.env üzerine yazılmaz.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
HUB="${AGENT_HUB:-$HOME/.agent-hub}"

for c in tmux python3 curl claude; do
  command -v "$c" >/dev/null || echo "UYARI: '$c' bulunamadı, kurman gerekiyor."
done

mkdir -p "$HUB/bin" "$HUB/tasks" "$HUB/briefs" "$HUB/skill"
cp "$SRC"/bin/agent "$SRC"/bin/brain.sh "$SRC"/bin/hub.sh "$SRC"/bin/tg_bridge.py "$HUB/bin/"
chmod +x "$HUB"/bin/*
rm -rf "$HUB/skill/orchestrator"
cp -r "$SRC/skill/orchestrator" "$HUB/skill/"

[ -f "$HUB/profiles.sh" ] || cp "$SRC/profiles.sh.example" "$HUB/profiles.sh"
if [ ! -f "$HUB/telegram.env" ]; then
  cp "$SRC/telegram.env.example" "$HUB/telegram.env.example"
fi
[ -f "$HUB/plan.md" ]    || echo "# Plan" > "$HUB/plan.md"
[ -f "$HUB/journal.md" ] || echo "# Günlük" > "$HUB/journal.md"

# Skill'i her Claude hesabının ayar klasörüne bağla
for d in "$HOME/.claude" "$@"; do
  mkdir -p "$d/skills"
  ln -sfn "$HUB/skill/orchestrator" "$d/skills/orchestrator"
  echo "skill bağlandı: $d/skills/orchestrator"
done

mkdir -p "$HOME/.local/bin"
ln -sf "$HUB/bin/agent" "$HOME/.local/bin/agent"
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) echo "NOT: ~/.local/bin PATH'te değil. ~/.bashrc veya ~/.zshrc dosyana ekle:"
     echo '  export PATH="$HOME/.local/bin:$PATH"' ;;
esac

echo
echo "Kuruldu: $HUB"
echo "Sıradaki adım: $HUB/profiles.sh dosyasını kendi hesap ayarlarına göre düzenle."
