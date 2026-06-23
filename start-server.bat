@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

echo Starting Paper Trade Planner server...
echo.
echo This window must stay open while you use the app.
echo.
echo Open this on this computer:
echo   http://localhost:4173
echo.
echo On your phone on the same Wi-Fi:
echo   http://YOUR-COMPUTER-IP:4173
echo.

"%NODE_EXE%" server.js

echo.
echo The server stopped or failed to start.
echo If you see "EADDRINUSE", the app is already running in another window.
echo If you see a firewall prompt, allow access on Private networks.
echo.
pause
