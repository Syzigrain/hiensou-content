@echo off
cd /d "%~dp0"

:: Kill old server on port 3456
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3456 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
    timeout /t 1 /nobreak >nul
)

echo Starting Hiensou Article Manager...
echo Open http://localhost:3456 in your browser
echo Press Ctrl+C to stop

start "" http://localhost:3456
node manager\server.mjs
pause
