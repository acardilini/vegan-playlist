@echo off
setlocal
echo Stopping The Vegan Playlist...

REM Close the launcher log windows (and their child processes) by title
taskkill /F /T /FI "WINDOWTITLE eq Vegan Playlist - Backend*" >nul 2>&1
taskkill /F /T /FI "WINDOWTITLE eq Vegan Playlist - Frontend*" >nul 2>&1

REM Kill anything still listening on the app ports (covers manually started servers)
call :killport 5000 Backend
call :killport 5173 Frontend

echo.
echo Done. This window closes in 5 seconds.
timeout /t 5 >nul
exit /b

:killport
set "FOUND="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /C:":%1 " ^| findstr LISTENING') do (
    set "FOUND=1"
    echo   Stopping %2 ^(PID %%p on port %1^)...
    taskkill /F /T /PID %%p >nul 2>&1
)
if not defined FOUND echo   %2 was not running on port %1.
exit /b
