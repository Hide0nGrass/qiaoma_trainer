@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto fallback
set "NODE=node"
goto run

:fallback
if exist "C:\Program Files\nodejs\node.exe" goto usefixed
echo [x] Node.js not found. Install Node.js 18+ first.
pause
exit /b 1

:usefixed
set "NODE=C:\Program Files\nodejs\node.exe"

:run
echo 敲麻训练器启动中 ...  http://127.0.0.1:8788
echo 关掉这个窗口就是停止服务。
echo.
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 1; Start-Process 'http://127.0.0.1:8788'"
"%NODE%" server.mjs
echo.
echo 服务已停止。
pause
