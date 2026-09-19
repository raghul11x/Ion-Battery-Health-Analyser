@echo off
title Ion+ (Debug Console)
cd /d "%~dp0"

echo ========================================================
echo Starting Ion+ Battery Health Analyzer in Debug Mode...
echo ========================================================

REM Check if virtual environment exists
if not exist ".venv\Scripts\python.exe" (
    echo [SETUP] Virtual environment not found. Setting up .venv...
    py -3.11 -m venv .venv || python -m venv .venv
    echo [SETUP] Installing dependencies...
    .\.venv\Scripts\python.exe -m pip install -r requirements.txt
)

REM Run Desktop App with visible console
.\.venv\Scripts\python.exe desktop.py %*

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Application exited with error code %ERRORLEVEL%.
    pause
)
