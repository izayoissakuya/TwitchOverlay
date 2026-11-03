@echo off
setlocal
cd /d "%~dp0"
title Eika Army Crowd Overlay + Twitch
 echo ==============================================
echo     Eika Army Crowd Overlay - Single Window
echo ==============================================
echo.
if not exist "index.html" (
  echo ERROR: index.html was not found.
  echo Put this launcher and its files in your existing overlay folder, alongside index.html and assets.
  pause
  exit /b 1
)
if not exist "config.json" (
  echo ERROR: config.json was not found.
  echo Keep your existing config.json or copy config.example.json to config.json and add your Twitch token.
  pause
  exit /b 1
)
if not exist "node_modules\ws" (
  echo Installing required dependency for first run...
  call npm install
  if errorlevel 1 (echo npm install failed. Make sure Node.js and npm are installed.& pause & exit /b 1)
)
echo Starting overlay server and Twitch bridge in this same window...
echo OBS:   http://127.0.0.1:8081/?stream=1
echo Demo:  http://127.0.0.1:8081/?demo=1
echo Health http://127.0.0.1:8081/health
echo.
call npm start
echo.
echo Overlay stopped. Press any key to close.
pause >nul
