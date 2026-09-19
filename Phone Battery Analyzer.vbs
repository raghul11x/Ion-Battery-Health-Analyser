' Phone Battery Health Analyzer - 100% Silent Native App Launcher
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Set working directory to project root
projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = projectDir

exePath = projectDir & "\dist\Phone Battery Analyzer.exe"
pythonwPath = projectDir & "\.venv\Scripts\pythonw.exe"

If fso.FileExists(exePath) Then
    ' Launch compiled standalone .exe directly
    WshShell.Run """" & exePath & """", 0, False
ElseIf fso.FileExists(pythonwPath) Then
    ' Fallback to pythonw.exe
    WshShell.Run """" & pythonwPath & """ desktop.py", 0, False
Else
    MsgBox "Setting up environment. Please run run.bat once to initialize.", vbInformation, "Phone Battery Health Analyzer"
    WshShell.Run "cmd.exe /c """ & projectDir & "\run.bat""", 1, True
End If
