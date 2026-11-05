@echo off
rem Actualización de instalación existente (requiere confirmaciones). Ver DESPLIEGUE.md.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0actualizar.ps1" %*
pause
