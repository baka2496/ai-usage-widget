' Runs push-agy-usage.ps1 with a hidden window (no console flash every 15 minutes)
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & dir & "\push-agy-usage.ps1""", 0, True
