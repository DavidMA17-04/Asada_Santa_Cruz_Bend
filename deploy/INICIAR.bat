@echo off
rem Arranca la API (sirve el frontend compilado).
set "BACKEND=%~dp0.."
cd /d "%BACKEND%"
if not exist node_modules (
  echo Ejecute primero deploy\INSTALAR.bat
  pause
  exit /b 1
)
if not exist "%BACKEND%..\frontend\dist\index.html" (
  echo Falta frontend\dist. Ejecute deploy\INSTALAR.bat
  pause
  exit /b 1
)
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 4; Start-Process 'http://localhost:3000/'"
echo Sistema ASADA en http://localhost:3000/  (cierre esta ventana para detenerlo)
npm start
pause
