@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0verificar.ps1" %*
pause
