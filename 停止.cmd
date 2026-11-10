@echo off
set FOUND=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8788" ^| findstr "LISTENING"') do (
  taskkill /f /pid %%a >nul 2>&1
  set FOUND=1
)
if "%FOUND%"=="1" (echo Stopped server on port 8788.) else (echo Nothing listening on port 8788.)
ping -n 3 127.0.0.1 >nul
