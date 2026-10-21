@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "WORKBENCH_RUNTIME=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies"
if exist "%WORKBENCH_RUNTIME%\node\bin\node.exe" set "PATH=%WORKBENCH_RUNTIME%\node\bin;%WORKBENCH_RUNTIME%\bin\fallback;%PATH%"
set TZ=Asia/Shanghai
call pnpm start:lan
pause
