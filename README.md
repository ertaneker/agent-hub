# Agent Hub

Terminal olmadan, tarayıcıdan yönetilen, kalıcı çalışan Claude agent'ları. Her agent kendi klasöründe, kendi Claude hesabıyla ve kendi ayarlarıyla çalışır; bilgisayar kapanıp açılsa da kaldığı yerden devam eder. Motor, Claude Code CLI'nin kendisidir (ham API ya da SDK kullanılmaz).

## Kurulum (Windows)

1. Bu depoyu indir (**Code > Download ZIP** ya da `git clone`).
2. **`kur.bat`** dosyasına çift tıkla.

Gerisini kurulum betiği yapar; hiçbir ayar dosyası düzenlemen gerekmez:

| Adım | Ne yapar |
|---|---|
| Node.js | Yoksa ya da eskiyse (22.13 altı) LTS sürümünü kurar |
| Git | Yoksa kurar (Claude Code ve yalıtılmış çalışma kopyaları için) |
| Claude CLI | Yoksa `npm i -g @anthropic-ai/claude-code` ile kurar, giriş yoksa tarayıcıda giriş ekranını açar |
| Docker Desktop | **Yalnızca sandbox özelliği için, yoksa sana sorar.** "Hayır" dersen kurulmaz; hub yine çalışır |
| Otomatik başlatma | Sorar: Windows açılınca ya da giriş (PIN) ekranı gelmeden başlasın mı |
| Hub | Başlatır ve `http://localhost:4747` adresini açar |

Betik tekrar çalıştırılabilir; kurulu olanı atlar.

Gereken tek elle adım, Claude hesabını tarayıcıda onaylamandır (Anthropic bunu başkası adına yapılamaz kılar). Claude aboneliğin yoksa ya da limit dolarsa arayüzde "Model sağlayıcıları" bölümünden Anthropic uyumlu bir API (ör. DeepSeek) ekleyebilirsin.

## Gizlilik: anahtarlar GitHub'a gitmez

- API anahtarları, Telegram token'ları, sohbet geçmişi ve ayarlar **depoda değil**, `%USERPROFILE%\.agent-hub-ui` klasöründe (`hub.db`) saklanır. Anahtarı arayüzden girersin; koda ya da dosyaya yazılmaz.
- `.gitignore` `.env`, `*.db`, `telegram.env`, `profiles.sh`, `.claude/`, `.mcp.json`, `.playwright-mcp/` ve benzerlerini dışarıda tutar.
- **Commit öncesi koruma:** `.githooks/pre-commit`, eklenecek dosyalarda anahtar/token kalıpları (Telegram, `sk-…`, GitHub, AWS, özel anahtar vb.) arar ve bulursa commit'i durdurur. `kur.bat` bunu otomatik açar; elle: `git config core.hooksPath .githooks`.
- Depoyu elle taramak için: `node scripts/check-secrets.js --all`
- Bir anahtarı yanlışlıkla paylaştıysan silmek yetmez, **iptal edip yenisini üret** (git geçmişinde kalır).

## Klasörler

- `hub-ui/`: sunucu (`server.js`, bağımlılıksız Node), arayüz (`public/`), Telegram köprüsü, sandbox imajı (`sandbox/`)
- `kur.bat`, `kur.ps1`: kurulum
- `scripts/`, `.githooks/`: gizli anahtar koruması
- `bin/`, `install.sh`, `skill/`: eski tmux/WSL tabanlı sistem (isteğe bağlı, Linux/WSL için)

Ayrıntılı kullanım: [hub-ui/README.md](hub-ui/README.md)
