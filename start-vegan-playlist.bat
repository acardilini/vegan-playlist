@echo off
setlocal
set "ROOT=%~dp0"
echo Starting The Vegan Playlist...

REM --- Backend (port 5000) ---
netstat -ano | findstr /C:":5000 " | findstr LISTENING >nul
if not errorlevel 1 (
    echo   Backend already running on port 5000 - skipping ^(run stop-vegan-playlist.bat for a fresh start^).
) else (
    echo   Starting backend on http://localhost:5000 ...
    start "Vegan Playlist - Backend" /d "%ROOT%backend" cmd /k "npm run dev"
)

REM --- Frontend (port 5173) ---
netstat -ano | findstr /C:":5173 " | findstr LISTENING >nul
if not errorlevel 1 (
    echo   Frontend already running on port 5173 - skipping ^(run stop-vegan-playlist.bat for a fresh start^).
) else (
    echo   Starting frontend on http://localhost:5173 ...
    start "Vegan Playlist - Frontend" /d "%ROOT%frontend" cmd /k "npm run dev"
)

echo   Waiting for servers to start...
timeout /t 6 /nobreak >nul
start "" http://localhost:5173
echo.
echo Done. Two log windows are open. Use stop-vegan-playlist.bat to stop everything.
timeout /t 5 >nul
