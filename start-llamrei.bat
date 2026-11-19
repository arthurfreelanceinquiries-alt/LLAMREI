@echo off
title LLAMREI AI - Personal Command Desk
echo ==================================================
echo   LLAMREI AI - Arthur Reezan Personal Command Desk
echo ==================================================
echo.

cd /d "%~dp0"

echo [1/2] Memeriksa dependensi Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js tidak ditemukan di PATH! Silakan install Node.js terlebih dahulu.
    pause
    exit /b 1
)

echo [2/2] Memulai Server LLAMREI (Vite + Core Backend)...
start "Llamrei Server" cmd /c "npm run dev"

echo Menunggu server siap...
timeout /t 3 >nul

echo Membuka antarmuka LLAMREI di browser...
start http://localhost:5173

echo.
echo ==================================================
echo   Llamrei berjalan di: http://localhost:5173
echo   Tekan sembarang tombol untuk menutup jendela ini...
echo ==================================================
pause
