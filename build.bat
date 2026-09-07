@echo off
title Building MRCHI Intel Lite
echo ==========================================
echo   Building MRCHI Intel Lite
echo ==========================================
echo.

echo [1/2] Installing dependencies...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to install dependencies.
    pause
    exit /b 1
)

echo.
echo [2/2] Building application...
REM Note: If your package.json uses 'dist' for electron-builder, change 'build' to 'dist'
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Build failed.
    pause
    exit /b 1
)

echo.
echo ==========================================
echo   Build completed successfully!
echo ==========================================
pause