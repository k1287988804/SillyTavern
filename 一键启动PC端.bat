pushd %~dp0
start cmd /c "npm run start" & start cmd /c "cd slaude & npm run start"
pause
popd