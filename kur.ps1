# Agent Hub kurulumu: gerekli her şeyi denetler, eksik olanı kurar. Yeniden çalıştırmak güvenlidir.
# Kurulan/denetlenen: Node.js (22.13+), Git, Claude CLI (+ giriş), Docker Desktop (İSTEĞE BAĞLI, sorar), otomatik başlatma, hub.
# Hiçbir API anahtarı sorulmaz ya da depoya yazılmaz; anahtarlar hub arayüzünden girilir ve ~/.agent-hub-ui içinde kalır.
$ErrorActionPreference = 'Continue'  # PS 5.1'de yerel komutların stderr çıktısı hata sayılmasın; kritik adımlar açıkça throw eder
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$hub = Join-Path $root 'hub-ui'
$port = 4747

function Say($m) { Write-Host "[Agent Hub] $m" -ForegroundColor Cyan }
function Ok($m) { Write-Host "  + $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  ! $m" -ForegroundColor Yellow }
function Has($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function Refresh-Path {
  $m = [Environment]::GetEnvironmentVariable('Path', 'Machine'); $u = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$m;$u;$env:APPDATA\npm"
}
function Ask($q) { do { $a = Read-Host "$q (E/H)" } while ($a -notmatch '^[EeHhYyNn]'); return ($a -match '^[EeYy]') }
function Winget-Install($id) {
  if (-not (Has winget)) { throw "winget bulunamadı. Microsoft Store'dan 'Uygulama Yükleyicisi' (App Installer) kur, sonra kur.bat'i tekrar çalıştır." }
  winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements
  Refresh-Path
}
function Node-Ok {
  if (-not (Has node)) { return $false }
  $v = [version](((node -v) -replace '^v', '') -replace '-.*$', '')
  return ($v -ge [version]'22.13.0')
}
function Claude-LoggedIn {
  try { return [bool]((claude auth status 2>$null | Out-String | ConvertFrom-Json).loggedIn) } catch { return $false }
}

Refresh-Path
Say 'Kurulum başlıyor (internet gerekir).'

# 1) Node.js
if (Node-Ok) { Ok "Node.js $(node -v)" }
else {
  Say 'Node.js (LTS) kuruluyor...'
  Winget-Install 'OpenJS.NodeJS.LTS'
  if (-not (Node-Ok)) { throw 'Node.js kuruldu ama bu pencerede görünmüyor. Pencereyi kapatıp kur.bat dosyasını yeniden çalıştır.' }
  Ok "Node.js $(node -v)"
}

# 2) Git (Claude Code Windows'ta Git Bash ister; agent'ların yalıtılmış çalışma kopyaları da git kullanır)
if (Has git) { Ok (git --version) }
else {
  Say 'Git kuruluyor...'
  Winget-Install 'Git.Git'
  if (-not (Has git)) { throw 'Git kuruldu ama görünmüyor. Pencereyi kapatıp kur.bat dosyasını yeniden çalıştır.' }
  Ok (git --version)
}

# 3) Claude CLI
if (Has claude) { Ok "Claude CLI $(claude --version)" }
else {
  Say 'Claude CLI kuruluyor...'
  npm install -g '@anthropic-ai/claude-code'
  Refresh-Path
  if (-not (Has claude)) { throw 'Claude CLI kurulamadı. npm install -g @anthropic-ai/claude-code komutunu elle dene.' }
  Ok "Claude CLI $(claude --version)"
}
# giriş: tarayıcıda hesabını onaylamak gerekir (bunu başkası yapamaz)
if (Claude-LoggedIn) { Ok 'Claude hesabında oturum açık.' }
else {
  Say 'Claude hesabına giriş gerekiyor; tarayıcı açılacak, hesabını onayla.'
  claude auth login
  if (Claude-LoggedIn) { Ok 'Giriş yapıldı.' } else { Warn 'Giriş doğrulanamadı. Hub açıldıktan sonra terminalde "claude auth login" ile giriş yapabilirsin.' }
}

# 4) Docker (isteğe bağlı: yalnızca agent komutlarını yalıtılmış konteynerde çalıştırmak için). Kullanıcıya sorulur.
$dockerReady = $false
if (Has docker) {
  Ok (docker --version)
  & docker info *> $null
  if ($LASTEXITCODE -eq 0) { $dockerReady = $true } else { Warn "Docker kurulu ama çalışmıyor. Sandbox için Docker Desktop'ı aç." }
}
else {
  Write-Host ''
  Write-Host 'Docker Desktop kurulu değil. Yalnızca "sandbox" özelliği için gerekir (agent komutları ana bilgisayarından yalıtılmış çalışır).'
  Write-Host 'Kurmasan da hub çalışır; sandbox''sız ya da "kısıtlı" modda agent kullanabilirsin. Kurulum yönetici izni ve sanallaştırma ister, bilgisayar yeniden başlayabilir.'
  if (Ask 'Docker Desktop kurulsun mu?') {
    Say 'Docker Desktop kuruluyor (birkaç dakika sürebilir)...'
    try {
      Winget-Install 'Docker.DockerDesktop'
      Ok "Docker Desktop kuruldu. Bilgisayarı yeniden başlatman ve Docker Desktop'ı bir kez açman gerekebilir; sonra kur.bat'ı tekrar çalıştır (sandbox imajı o zaman derlenir)."
    }
    catch { Warn "Docker kurulamadı: $($_.Exception.Message)" }
  }
  else { Say 'Docker atlandı.' }
}
if ($dockerReady) {
  & docker image inspect agent-hub-sandbox:1 *> $null
  if ($LASTEXITCODE -ne 0) {
    Say 'Sandbox imajı derleniyor (ilk seferde birkaç dakika sürer)...'
    Push-Location (Join-Path $hub 'sandbox')
    try { docker build -t agent-hub-sandbox:1 . } finally { Pop-Location }
    if ($LASTEXITCODE -eq 0) { Ok 'Sandbox imajı hazır.' } else { Warn 'Sandbox imajı derlenemedi; hub arayüzünde Ayarlar > Ortam > "İmajı derle" ile tekrar deneyebilirsin.' }
  }
  else { Ok 'Sandbox imajı hazır.' }
}

# 5) Git ayarı: gizli anahtar taraması commit'ten önce çalışsın (depo klonlandıysa)
if ((Test-Path (Join-Path $root '.git')) -and (Has git)) {
  git -C $root config core.hooksPath .githooks | Out-Null
  Ok 'Gizli anahtar koruması (pre-commit) açık.'
}

# 6) Otomatik başlatma
Write-Host ''
if (Ask 'Windows açılınca Agent Hub otomatik başlasın mı?') {
  if (Ask 'Windows giriş (PIN) ekranı gelmeden, bilgisayar açılır açılmaz başlasın mı? (yönetici izni ister)') {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $hub 'install-boot-task.ps1')
  }
  else {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $hub 'install-autostart.ps1')
  }
}

# 7) Hub'ı başlat
function Hub-Up { try { (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/api/settings" -TimeoutSec 3).StatusCode -eq 200 } catch { $false } }
if (Hub-Up) { Ok 'Agent Hub zaten çalışıyor.' }
else {
  Say 'Agent Hub başlatılıyor...'
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "`"$(Join-Path $hub 'start-hub.cmd')`"" -WindowStyle Hidden
  for ($i = 0; $i -lt 30 -and -not (Hub-Up); $i++) { Start-Sleep -Seconds 1 }
  if (-not (Hub-Up)) { throw "Hub açılmadı. Günlük: $env:USERPROFILE\.agent-hub-ui\server.log" }
  Ok 'Agent Hub çalışıyor.'
}
Start-Process "http://localhost:$port"
Write-Host ''
Say "Hazır! Arayüz: http://localhost:$port"
Write-Host '  Yedek model (ör. DeepSeek) eklemek için arayüzde "Model sağlayıcıları" bölümünü kullan; anahtarın yalnızca bu bilgisayarda saklanır.'
