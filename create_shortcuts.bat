@echo off
title Create Ion+ Shortcuts
cd /d "%~dp0"

echo ========================================================
echo Creating Ion+ App Shortcuts...
echo ========================================================

powershell -NoProfile -ExecutionPolicy Bypass -Command "$WshShell = New-Object -ComObject WScript.Shell; $ProjectDir = (Get-Location).Path; $DesktopPath = [Environment]::GetFolderPath('Desktop'); $ExePath = \"$ProjectDir\dist\Ion+.exe\"; $Target = if (Test-Path $ExePath) { $ExePath } else { \"$ProjectDir\.venv\Scripts\pythonw.exe\" }; $Args = if (Test-Path $ExePath) { '' } else { 'desktop.py' }; $s1 = $WshShell.CreateShortcut(\"$ProjectDir\Ion+.lnk\"); $s1.TargetPath = $Target; $s1.Arguments = $Args; $s1.WorkingDirectory = \"$ProjectDir\"; $s1.IconLocation = \"$ProjectDir\frontend\static\assets\favicon.ico,0\"; $s1.Description = \"Ion+ Battery Health Analyzer\"; $s1.Save(); $s2 = $WshShell.CreateShortcut(\"$DesktopPath\Ion+.lnk\"); $s2.TargetPath = $Target; $s2.Arguments = $Args; $s2.WorkingDirectory = \"$ProjectDir\"; $s2.IconLocation = \"$ProjectDir\frontend\static\assets\favicon.ico,0\"; $s2.Description = \"Ion+ Battery Health Analyzer\"; $s2.Save(); Write-Host '[SUCCESS] Ion+ shortcuts created on your Desktop and in the project folder!'"

echo.
pause
