@echo off
rem Agent Hub UI sunucusunu başlatır (kapanırsa 5 sn sonra yeniden açar).
cd /d "%~dp0"
rem Oturum açılmadan (görev zamanlayıcı S4U) çalışırken bazı ortam değişkenleri eksik olabilir
if not defined APPDATA set "APPDATA=%USERPROFILE%\AppData\Roaming"
if not defined LOCALAPPDATA set "LOCALAPPDATA=%USERPROFILE%\AppData\Local"
if not exist "%USERPROFILE%\.agent-hub-ui" mkdir "%USERPROFILE%\.agent-hub-ui"
:loop
node server.js >> "%USERPROFILE%\.agent-hub-ui\server.log" 2>&1
ping -n 6 127.0.0.1 >nul
goto loop
