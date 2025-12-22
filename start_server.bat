@echo off
title Case-Calendar-Server
echo ===================================================
echo   Starting Legal Case & Calendar Sync System...
echo ===================================================

:: ย้าย Directory มาที่ตำแหน่งปัจจุบันของไฟล์ bat
cd /d "%~dp0"

:: เปิด Browser รอไว้เลย (รอ 3 วินาทีให้ Server เตรียมตัว)
timeout /t 3 >nul
start http://localhost:3000

:: รัน Server
node app.js

:: ถ้า Server หยุดทำงาน ให้หยุดหน้าจอรอดู Error
pause