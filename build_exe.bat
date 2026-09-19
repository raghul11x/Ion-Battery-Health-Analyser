@echo off
title Building Ion+ Standalone Executable
cd /d "%~dp0"

echo ========================================================
echo Compiling Ion+ into Standalone .exe...
echo ========================================================
echo.

REM Verify virtual environment
if not exist ".venv\Scripts\pyinstaller.exe" (
    echo [ERROR] PyInstaller not found in .venv. Installing...
    .\.venv\Scripts\python.exe -m pip install pyinstaller
)

echo [BUILD] Running PyInstaller with phone_battery_analyzer.spec...
.\.venv\Scripts\pyinstaller.exe phone_battery_analyzer.spec --noconfirm --clean

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Build failed with exit code %ERRORLEVEL%.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ========================================================
echo [SUCCESS] Build Complete!
echo Standalone Executable: dist\Ion+.exe
echo ========================================================
echo.
pause
