#!/usr/bin/env bash
# Orkestratörü verilen profille çalıştırır (tmux içinde 'agent' tarafından çağrılır).
HUB="${AGENT_HUB:-$HOME/.agent-hub}"
# shellcheck source=/dev/null
source "$HUB/profiles.sh"
profile_env "${1:?profil gerekli}" || { echo "Profil yüklenemedi."; exec "${SHELL:-bash}"; }
export AGENT_HUB="$HUB" AGENT_PROFILE="$1"

echo "Agent '$1' profiliyle başlıyor..."
# Agent'ın kendi yardımcı komutları ve durum klasörü için izin sormaması:
ALLOW="Bash($HUB/bin/hub.sh:*),Bash($HUB/bin/agent:*),Bash(~/.agent-hub/bin/hub.sh:*),Bash(~/.agent-hub/bin/agent:*),Bash(claude mcp list),Bash(claude mcp get:*)"
TR="ZORUNLU DİL KURALLARI: (1) Kullanıcıyla her iletişimin (cevap, açıklama, soru, rapor, plan özeti) sade, günlük Türkçe olsun; terminalde de Telegram'da da. İngilizce cümle kurma; teknik terimi gerekirse parantezle kısaca açıkla. Kod, komut, dosya adı ve hata mesajları olduğu gibi kalır. (2) Her Bash çağrısının description alanını Türkçe ve anlaşılır yaz: ne yapıyor ve neden (örn. 'Bozuk videoyu silip yeniden üretiyor'). Kullanıcı bu satırı Telegram'dan okuyup onay veriyor. (3) Kullanıcıdan onay isteyeceğin riskli ya da izin gerektiren bir işten önce tek-iki cümleyle ne yapacağını ve neden yapacağını Türkçe yaz. (4) Kullanıcıya soru sorarken önce soruyu Türkçe yaz, altına numaralı Türkçe seçenekler koy (1) Evet, devam et 2) Hayır, vazgeç ...). Soruyu ve seçenekleri asla İngilizce bırakma. (5) Kullanıcıya bir dosya ya da video üretirsen ve onu terminalde gösteremiyorsan hub.sh sendfile ile Telegram'dan gönder."
claude "/orchestrator" \
  --append-system-prompt "$TR" \
  --permission-mode acceptEdits \
  --add-dir "$HUB" \
  --allowedTools "$ALLOW"

echo
echo "Agent durdu. Yeniden başlatmak için: agent yenile"
exec "${SHELL:-bash}"
