@echo off
rem Agent Hub kurulum baslaticisi: cift tikla, gerisini kur.ps1 yapar.
chcp 65001 >nul
title Agent Hub Kurulum
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kur.ps1"
if errorlevel 1 (
  echo.
  echo Kurulum tamamlanamadi. Yukaridaki mesaji oku, sorunu giderip kur.bat'i tekrar calistir.
)
echo.
pause
