@echo off
title Stop Server
echo ===================================================
echo   Stopping Server on Port 3000...
echo ===================================================

:: ค้นหา Process ID (PID) ที่ใช้ Port 3000 แล้วสั่งปิด (Kill)
for /f "tokens=5" %%a in ('netstat -aon ^| find ":3000" ^| find "LISTENING"') do (
    echo Found Process ID: %%a
    taskkill /f /pid %%a
    echo Server Stopped Successfully.
)

echo.
echo Done.
timeout /t 3 >nul