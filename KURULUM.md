# Kalıcı orkestratör agent: kurulum ve kullanım

## Nasıl çalışır

```
 Terminal A (hangi hesapla açılmış olursa olsun) ─┐
 Terminal B ──────────────────────────────────────┼──► tmux "agent-hub"
 Telegram ─── tg_bridge.py ───────────────────────┘      ├─ brain : claude /orchestrator  (başlatıldığı profille)
                                                         └─ tg    : Telegram köprüsü
                                       hub.sh run ──► arka plan işçileri (claude -p, profil/model başına)
                                       ~/.agent-hub ─► plan.md, journal.md, tasks/, onaylar.md
```

- Agent, tmux içinde bağımsız bir süreç olarak çalışır. Ona bağlanan terminalin hangi
  hesapla açıldığının önemi yoktur; agent başlatıldığı profille devam eder.
- Hesap yalnızca sen söylediğinde değişir (`agent hesap is` ya da Telegram'dan `/hesap is`).
  Agent yeni hesapla yeniden açılır ve `plan.md` dosyasından kaldığı yerden devam eder.
- İşçiler ayrı süreçlerdir; agent yeniden başlasa da işlerini bitirir ve bitince
  agent'ı haberdar eder.

## Gereksinimler

`claude` CLI, `tmux`, `python3`, `curl`. Windows'ta her şeyi WSL içinde çalıştır
(not defteri onayı için `APPROVAL_OPEN=1` WSL'de Windows Not Defteri'ni açar).

## 1. Kur

```bash
unzip agent-hub.zip && cd agent-hub
./install.sh ~/.claude-is        # kurum hesabının ayar klasörü (aşağıya bak)
```

Kurum hesabının ayar klasörünü bulmak için `type claudeis` yaz.
Genelde `CLAUDE_CONFIG_DIR=...` şeklinde bir klasör görürsün; onu ver.

## 2. Profilleri eşle

`~/.agent-hub/profiles.sh` dosyasını aç:
- `is` profilindeki `CLAUDE_CONFIG_DIR`, `claudeis` komutunla aynı olmalı.
- `deepseek` profilindeki adres, token ve model, `deepseek` komutunla aynı olmalı.
- `kisisel` için genelde değişiklik gerekmez.

Kontrol: `bash -c 'source ~/.agent-hub/profiles.sh; profile_env is; claude -p "merhaba"'`
kurum hesabıyla cevap vermeli. Aynısını `kisisel` ve `deepseek` için de dene.

## 3. Telegram (isteğe bağlı ama önerilir)

1. Telegram'da @BotFather → `/newbot` → token'ı al.
2. `cp ~/.agent-hub/telegram.env.example ~/.agent-hub/telegram.env && chmod 600 ~/.agent-hub/telegram.env`
3. Token'ı dosyaya yaz, botuna bir mesaj gönder.
4. `python3 ~/.agent-hub/bin/tg_bridge.py --chat-id` → çıkan ID'yi dosyaya yaz.

Bot yalnızca bu ID'den gelen mesajları dinler.

## 4. İzin istekleri Telegram'a düşsün (önerilir)

Agent terminalde bir izin sorusunda takılırsa haberin olsun diye, her hesabın
`settings.json` dosyasına (`~/.claude/settings.json`, `~/.claude-is/settings.json`) ekle:

```json
{
  "hooks": {
    "Notification": [
      { "hooks": [ { "type": "command", "command": "~/.agent-hub/bin/hub.sh hook-notify" } ] }
    ]
  }
}
```

Sadece agent oturumundaki bildirimler iletilir; normal claude kullanımın etkilenmez.
Telegram'dan `/ekran` ile soruyu görür, `/tus 1` gibi cevap verirsin.

## 5. Kullanım

### Terminalden

| Komut | Ne yapar |
|---|---|
| `agent is ~/projeler/saas` | Kurum hesabıyla, o klasörde başlatır |
| `agent` | Açık agent'a bağlanır (herhangi bir terminalden) |
| `Ctrl-b` sonra `d` | Agent'tan ayrılır; agent çalışmaya devam eder |
| `agent hesap kisisel` | Agent'ı kişisel hesaba taşır |
| `agent hesap deepseek` + `agent isci deepseek` | Her şeyi DeepSeek'e taşır |
| `agent isci serbest` | İşçi seçimini tekrar agent'a bırakır |
| `agent yenile` | Aynı hesapla yeniden başlatır |
| `agent durum` | Hesap, işçi ayarı, görevler |
| `agent kapat` | Agent'ı kapatır |

Agent'a bağlandığında doğrudan yazarak görev verebilir, güncelleyebilir ya da
"bu işi bırak, şunu yap" diyebilirsin. "Kurum hesabına geç" gibi talimatları da
kendisi uygular.

### Telegram'dan

Telegram, terminalin aynasıdır: yazdığın her şey agent'a olduğu gibi gider, agent'ın
cevapları, yaptığı işler (🔧/📄) ve onay soruları buraya kendiliğinden gelir. Onay
sorusuna `1`, `2`, `3` yazarak cevap verirsin; `/ekran` yazman gerekmez.
Terminalde yazdıkların `💻` ile yansır. Agent Türkçe konuşur.

Kısayollar: `/durum`, `/ekran`, `/hesap <profil>`, `/isci <profil|serbest>`, `/sonuc <id>`,
`/dur`, `/esc`, `/enter`, `/yukari`, `/asagi`, `/tab`, `/ctrlc`, `/tus <metin>`, `/yenile`,
`/sessiz` (aktarımı kapat), `/sesli`. Listede olmayan `/komut`'lar (örn. `/compact`)
agent'a olduğu gibi iletilir.

Agent bir dosya ya da video ürettiyse ve sana terminalden gösteremiyorsa
`hub.sh sendfile <dosya> "açıklama"` ile Telegram'dan gönderir (sınır 50 MB).

### Onaylar

Ücretli işlem, silme, push, deploy, dışarıya mesaj gönderme ve ücretli/kaynağı belirsiz
MCP kurulumunda agent durup onay ister. Soru üç yere düşer: agent terminali, Telegram
ve `~/.agent-hub/onaylar.md`. İstediğin yerden cevap ver (terminalde ya da Telegram'da).

### Hesap limiti

Köprü, agent ekranında bir limit uyarısı görürse Telegram'dan haber verir. Hesabı
otomatik değiştirmez; `/hesap is` gibi sen karar verirsin.

## Bilinmesi gerekenler

- **Hesap değişince konuşma geçmişi taşınmaz.** Her hesabın oturum kayıtları kendi
  ayar klasöründedir. Süreklilik `plan.md` ve `journal.md` ile sağlanır; agent bunları
  her adımda günceller.
- **İlk açılışta** her hesap, proje klasörü için "bu klasöre güveniyor musun" diye
  sorabilir. Bir kez terminalden onayla.
- **Agent'ın kendi komutları** (hub.sh, agent) izinsiz çalışır, proje dosyalarındaki
  düzenlemeler otomatik kabul edilir. Diğer komutlar (test, build, kurulum) izin
  ister. Sık kullandıkların için projenin `.claude/settings.json` dosyasına izin
  kuralı ekleyebilirsin.
- **İşçilere** varsayılan olarak komut çalıştırma izni verilmez. Gerekirse
  `WORKER_TOOLS` ile açabilirsin (bkz. `hub.sh`).
- **Telegram mesajları ve işçi bildirimleri** agent'ın giriş satırına yazılır. O sırada
  terminalde yarım bir mesaj yazıyorsan karışabilir; yazmayı bitirip gönder.
- **Maliyet:** İşçi sonuçlarındaki maliyet alanı DeepSeek işlerinde doğru değildir;
  gerçek tutar için DeepSeek panelini kontrol et.
