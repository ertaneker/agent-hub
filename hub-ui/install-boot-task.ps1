# Bilgisayar AÇILINCA (Windows giriş/PIN ekranı gelmeden) Agent Hub'ı başlatan zamanlanmış görev kurar.
# Parola/PIN saklanmaz: görev "S4U" ile (kullanıcı oturum açmasa da) bu kullanıcı olarak çalışır.
# Yönetici izni ister (UAC penceresi çıkar, bir kez onayla). Kaldırmak için: install-boot-task.ps1 -Remove
param([switch]$Remove, [string]$UserName)
$ErrorActionPreference = 'Stop'
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$admin = ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-UserName', "`"$($id.Name)`"")
  if ($Remove) { $a += '-Remove' }
  Start-Process powershell -Verb RunAs -ArgumentList $a -Wait
  exit
}
$user = if ($UserName) { $UserName } else { $id.Name }
$name = 'AgentHubBoot'
if ($Remove) { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue; Write-Host "Görev kaldırıldı: $name"; Read-Host 'Kapatmak için Enter'; exit }

$dir = Split-Path -Parent $PSCommandPath
$cmd = Join-Path $dir 'start-hub.cmd'
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$cmd`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT30S'  # ağ ve sürücüler otursun
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

# Aynı sunucuyu oturum açılışında ikinci kez başlatmasın diye eski Başlangıç klasörü başlatıcısını kaldır
$vbs = Join-Path ([Environment]::GetFolderPath('Startup')) 'AgentHubUI.vbs'
if (Test-Path $vbs) { Remove-Item $vbs -Force }
Write-Host "Kuruldu: $name ($user, açılışta, 30 sn gecikmeli, giriş gerekmez)"
Read-Host 'Kapatmak için Enter'
