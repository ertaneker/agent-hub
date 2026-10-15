# Agent Hub UI

Terminal dışında, tarayıcıdan yönetilen çok agent'lı arayüz. Adres: http://localhost:4747

## Çalıştırma
- Elle: `node server.js` (Node 22+, bağımlılık yok)
- Windows açılışında otomatik: `powershell -File install-autostart.ps1` (Başlangıç klasörüne gizli başlatıcı koyar; çökerse 5 sn sonra yeniden açar)

## Motor: agent başına kalıcı Claude süreci
Her agent için tek bir `claude -p --input-format stream-json --permission-prompt-tool stdio` süreci yaşar (Claude Code'un kendisi). Terminal gerekmez.
- **Canlı izin:** Claude izin isteyince iş durur, arayüzde ve Telegram'da düğmeli kart çıkar; cevabın gelince AYNI turda devam eder (yeniden çalıştırma yok). "Hep izin ver" kuralı kalıcı kaydedilir.
- **Claude'un soruları:** `AskUserQuestion` seçenekli soru kartı olarak gelir; plan modunda `ExitPlanMode` plan kartı olarak gelir (onayla/reddet/değişiklik iste).
- **Kes (Esc / Telegram /durdur):** işi keser, süreç ve oturum yaşar. Çalışırken yazdığın mesaj sıraya girer, tur bitince işlenir.
- **Mod ve model:** başlıktaki seçicilerle çalışırken değişir (normal, düzenlemeyi kabul, plan, serbest; sonnet/opus/haiku).
- **Yerel komutlar:** `/compact`, `/context`, `/cost` gibi Claude Code komutları aynen çalışır; `/` yazınca liste çıkar. Bağlam sınırı aşılınca `/compact` kendiliğinden çalışır.
- **Arka plan görevleri:** agent arka planda iş başlatırsa süreç açık kalır; iş bitince agent kendiliğinden uyanır (başlıkta "⚙ arka plan görevi").
- **Boşta kapanma:** 45 dk boşta kalan süreç kapanır (oturum diskte), yeni mesajda `--resume` ile kaldığı yerden açılır. Sunucu/bilgisayar yeniden başlarsa yarım iş kurtarılır.
- **Hafif mod:** açıkken kullanıcı düzeyi ayar/skill/hook yüklenmez (az token); kapalıyken tüm kişisel Claude CLI ayarların yüklenir.
- **Telegram:** adım adım ilerleme (15 sn'de bir), `/durum`, `/limit`, `/mod`, `/model`, `/gorev <agent> <metin>`; izin ve soru kartları düğmelidir.

## Nasıl çalışır
- Her agent kendi klasörü, modeli, beyni, sınırları ve Claude oturumuyla ayrıdır (`claude -p --resume`).
- Her şey `~/.agent-hub-ui/hub.db` içinde saklanır: sohbet geçmişi, pano, hafıza, kararlar, kuyruk.
- Bilgisayar/sunucu yeniden başlarsa yarım kalan işler "kurtarma" olarak kaldığı yerden devam eder (agent ayarı: keepalive).
- **Ortak akış:** agent'lar `hubctl done` ile panoya yazar; diğerleri sonraki turda bunu system prompt'ta görür.
- **Benzer iş sorusu:** yeni isteğin başka agent'ın pano kaydıyla benzerliği yüksekse "Aynısını al / Yeniden inşa et / Vazgeç" sorulur.
- **Agent'lar arası mesaj:** `hubctl send <agent> "mesaj"`. Zincir en fazla 3 adım. "Sor" modundaki agent mesajı senin onayınla işler.
- **Sınırlar:** yetki kutuları, etik kurallar ve özerklik seviyesi araç kurallarına (`--allowedTools/--disallowedTools`) çevrilir. Kapsam dışı istek izin kartı olarak sana gelir.

## WSL gerekli mi?
Hayır. Eski sistem (`agent`, tmux, bash zamanlayıcıları, tg_bridge.py) WSL'e bağlıydı; arayüz bunların yerini Windows'ta yerel olarak alır:
- tmux oturumu yerine kalıcı sunucu + SQLite (açılışta kaldığı yerden devam)
- `gunluk.sh` / `kalimo_ig.sh` yerine **Zamanlama** sekmesi (agent görevi ya da komut)
- `tg_bridge.py` yerine yerleşik Telegram köprüsü (`~/.agent-hub-ui/telegram.env`)
- `hub.sh notify/sendfile` yerine `hubctl notify/sendfile`
WSL yalnızca **Linux'a özel araçlar** için kalır (yt-kanal içindeki Linux Python ortamı, espeak, yt-dlp). Agent bunları `wsl.exe -d Ubuntu -- bash -lc "..."` ile çağırır; WSL o anda kendiliğinden açılır, açık tutmak gerekmez.
Taşıma: eski sistemden aktarım betiği kişisel olduğu için depoya dahil değildir.

## Adlandırma
Agent'lar birbirine **adıyla** mesaj atar (`hubctl send "Kalimo Instagram" "..."`). Kenar çubuğunda çift tıklayarak ya da Ayarlar'dan adı değiştirirsin; değişiklik tüm agent'lara sohbetlerine, ortak panoya ve Telegram'a duyurulur, eski ad takma ad olarak geçerli kalır.

## Agent başına Telegram botu
Her agent'ın kendi Telegram botu olabilir; ona yazdığın her şey yalnızca o agent'a gider, cevapları ve izin kartları o bottan gelir.
- Bir kerelik kurulum: BotFather uygulamasında (https://t.me/BotFather?startapp) ana Agent Hub botunu seçip **Bot Management Mode**'u aç.
- Yeni agent penceresindeki "ayrı Telegram botu aç" kutusu (ya da Ayarlar > Telegram botu > Bot oluştur) bir bağlantı üretir. Telegram'da **bir kez onaylarsın**; token'ı Agent Hub API'den kendisi alır ve botu bağlar.
- Mod kapalıysa ya da botu elle açtıysan token'ı yapıştırarak bağlayabilirsin.
- Agent'ı silince bot bağlantısı kesilir; yönetilen botun token'ı iptal edilir (bot çalışmaz olur). Telegram API bot silmeye izin vermez, tamamen silmek için BotFather'da `/deletebot`.
- Botu olan agent'a ana bottan da `/agent <ad>` ile ulaşabilirsin; ama onun cevapları kendi botuna gider.

## Bağlam şişmesi ve token tasarrufu
Model her turda konuşmanın tamamını yeniden okur; geçmiş büyüdükçe her mesaj pahalanır. Önlemler:
- **Otomatik özetleme:** bağlam sınırı (varsayılan 60 bin token) aşılınca küçük bir model (haiku) konuşmayı özetler, model oturumu sıfırlanır, özet bir sonraki oturuma verilir. Arayüzdeki sohbet geçmişi eksiksiz kalır. Elle: Ayarlar > "Şimdi özetle ve yenile".
- **Kalıcı kurallar bozulmaz:** plan.md'nin başındaki `## Kalıcı kurallar` bölümü özetten bağımsız olarak her turda prompt'a konur; özetle çelişirse plan.md geçerlidir.
- **Zamanlanmış görevler temiz oturumda** çalışır (eski konuşmayı okumaz, yenisini biriktirmez); süreklilik plan.md/journal.md'dendir.
- **Hafif mod** (varsayılan açık): skill listesi ve kullanıcı ayarları yüklenmez; her turda ~15 bin token daha az.
- Başlıkta "bağlam X / sınır" ve "bugün $" göstergesi bulunur.

## Güvenlik, doğrulama ve limit özellikleri
- **Yalıtılmış çalışma kopyası (Ortam sekmesi):** agent ana klasöründe değil kendi kopyasında çalışır. git için `git worktree` (dal `agent/<id>`), svn için ayrı `checkout`. İş bitince "Farkı göster", sonra git'te "Ana depoya birleştir" (ana depo temizse; çakışırsa geri alır), svn'de yama dosyası üretip "svn patch" ile uygulama. Ana depodaki commit edilmemiş değişiklikler kopyaya geçmez.
- **Doğrulama kapısı:** `dotnet build`, `npm test` gibi komut. Agent dosya değiştirince (dosya araçlarıyla ya da Bash ile; git/svn değişimi izlenir) hub çalıştırır; başarısızsa çıktı agent'a geri verilir, düzeltir, kapı yeniden çalışır (en çok N deneme); hâlâ geçmezse sana haber verir. Telegram: `/kapi`.
- **Sandbox:** *Kısıtlı* = Claude'un yerleşik `--restricted` modu (komut çalıştıran araçlar yok, dosya araçları çalışma klasörüne kilitli, kişisel skill/ayar yüklenmez). *Docker* = komutlar `agent-hub-sandbox:1` konteynerinde çalışır (root değil, tüm yetkiler düşürülmüş, 4 GB / 4 CPU), yalnızca proje ve defter klasörü bağlıdır. Ayarlar > Ortam > "İmajı derle" (bir kez). Docker Desktop açık olmalı. .NET için `sandbox/Dockerfile.dotnet`.
  Sınırlar: konteynerde Claude hesabının kimlik dosyası kopyası bulunur (agent okuyabilir), ağ açıktır, eklenti (plugin) skill'leri konteynere taşınmaz (kullanıcı skill'leri salt-okunur bağlanır).
- **Günlük harcama sınırı:** agent başına ve toplam. Dolunca işler sırada bekler; arayüzden ya da Telegram düğmesinden (+$1, +$5, bugün sınırsız) artırılır. `--max-budget-usd` ile tek tur da kesilir. Tutar Claude'un bildirdiği TAHMİNİ maliyettir (abonelikte gerçek fatura değildir). Telegram: `/butce`.
- **Tüm Claude skill'leri:** yeni agent'lar varsayılan olarak kullanıcı skill'lerini ve eklentilerini yükler; `/` menüsü hepsini açıklamalarıyla listeler. Kişisel hook'lar varsayılan kapalıdır (Ayarlar'dan açılır). Bedeli: her turda ~12 bin token bağlam (Hafif mod bunu kapatır).
- **Limit dolunca yedek model:** ana model (Claude) limit/kota hatası verirse agent otomatik yedek sağlayıcıya (DeepSeek vb., `SinceraFlash.bat` dosyasından okunur, token kopyalanmaz) geçer, yarım kalan işi son konuşmanın ham özetiyle orada sürdürür. Ana modelin sıfırlanma zamanı gelince bir sonraki mesajda geri döner. Hepsi doluysa iş sırada bekler ve sıfırlanınca devam eder. Sağlayıcılar: sol alttaki "Model sağlayıcıları"; sıra: agent > Limitler. Telegram: `/saglayici`.
  Yedek model Claude kadar yetenekli olmayabilir; yedekte yapılan işi incele.

## Güvenlik notları
- Sunucu yalnızca 127.0.0.1'e bağlanır, Host ve `X-Hub` başlığı kontrol edilir.
- "Özgür" mod `bypassPermissions` kullanır; yasaklı araç listesi yine geçerlidir.
