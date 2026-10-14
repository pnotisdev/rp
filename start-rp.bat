@echo off
rem Launches the rp UI and opens it in your browser. Close this window to stop it.
rem Usage: start-rp.bat        (dev mode, always runs the latest code)
rem        start-rp.bat prod   (serves a production build on one port; builds it the first time)
setlocal
title rp
cd /d "%~dp0"
if not defined OPEN_BROWSER set "OPEN_BROWSER=1"

set "MODE=%~1"
if "%MODE%"=="" set "MODE=dev"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies ^(first run only^)...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

if /i "%MODE%"=="prod" goto prod

rem ---- Dev mode ---------------------------------------------------------------
set "URL=http://localhost:5173"
curl -s -o nul -m 2 %URL%
if not errorlevel 1 (
  echo rp is already running.
  if "%OPEN_BROWSER%"=="1" start "" %URL%
  exit /b 0
)
call :openWhenReady %URL%
echo Starting rp at %URL%. Close this window to stop it.
call npm run dev
exit /b

rem ---- Production mode ----------------------------------------------------------
:prod
set "URL=http://localhost:3001"
curl -s -o nul -m 2 %URL%/api/characters
if not errorlevel 1 (
  echo rp is already running.
  if "%OPEN_BROWSER%"=="1" start "" %URL%
  exit /b 0
)
if not exist "dist\index.html" (
  echo Building rp ^(first run only, run "npm run build" again after code changes^)...
  call npm run build
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
call :openWhenReady %URL%
echo Starting rp at %URL%. Close this window to stop it.
call npm start
exit /b

rem ---- Opens the app once it answers (up to 2 minutes) --------------------------
:openWhenReady
if not "%OPEN_BROWSER%"=="1" exit /b 0
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "for ($i = 0; $i -lt 120; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%~1' | Out-Null; Start-Process '%~1'; break } catch { Start-Sleep -Seconds 1 } }"
exit /b 0
