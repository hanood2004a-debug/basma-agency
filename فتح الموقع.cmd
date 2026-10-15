@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to preview this website.
  pause
  exit /b 1
)
start "" http://127.0.0.1:8000/
node .preview-server.cjs

