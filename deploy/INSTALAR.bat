@echo off
rem Instalación NUEVA (falla si ASADA ya existe). Ver INSTALAR.md y DESPLIEGUE.md.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1" %*
if errorlevel 1 pause
