# Windows oturumu açılınca başlatır (Başlangıç klasörüne gizli başlatıcılar koyar):
#  1) Agent Hub UI sunucusu (çökerse yeniden açılır)
# (WSL artık gerekmez; eski araçlar yalnızca çağrıldığında WSL'i kendiliğinden uyandırır.)
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$startup = [Environment]::GetFolderPath('Startup')
New-Item -ItemType Directory -Force "$env:USERPROFILE\.agent-hub-ui" | Out-Null

$vbs = Join-Path $startup 'AgentHubUI.vbs'
$cmd = Join-Path $dir 'start-hub.cmd'
$q = [string][char]34
Set-Content -Path $vbs -Encoding ASCII -Value ("CreateObject(${q}WScript.Shell${q}).Run ${q}cmd /c ${q}${q}$cmd${q}${q}${q}, 0, False")
Write-Host "Kuruldu: $vbs"
