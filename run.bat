@echo off
title Running MRCHI Intel Lite
echo ==========================================
echo   Starting MRCHI Intel Lite
echo ==========================================
echo.

REM Check if node_modules exists, if not, run install automatically
if not exist "node_modules\" (
    echo Dependencies not found. Running npm install first...
    call npm install
    echo.
)

echo Starting application...
call npm start
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Failed to start the app.
    echo Make sure your package.json has a valid "start" script.
    pause
    exit /b 1
)