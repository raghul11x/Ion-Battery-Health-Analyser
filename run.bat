@echo off
cd /d "%~dp0"

REM 1. If standalone .exe is compiled, launch it directly
if exist "dist\Ion+.exe" (
    start "" "dist\Ion+.exe" %*
    exit
)

REM 2. Otherwise verify virtual environment
if not exist ".venv\Scripts\pythonw.exe" (
    echo ========================================================
    echo Initializing Ion+ Battery Health Analyzer...
    echo ========================================================
    py -3.11 -m venv .venv || python -m venv .venv
    .\.venv\Scripts\python.exe -m pip install -r requirements.txt
)

REM 3. Launch native desktop window via pythonw and close console immediately
start "" ".\.venv\Scripts\pythonw.exe" desktop.py %*
exit
