@echo off
reg add HKEY_CURRENT_USER\Console /v QuickEdit /t REG_DWORD /d 00000000 /f
pushd %~dp0
start cmd /c "npm run start" & start cmd /c "cd slaude & npm run start"
pause
popd