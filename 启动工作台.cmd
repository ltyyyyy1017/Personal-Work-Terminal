@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "WORKBENCH_RUNTIME=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies"
if exist "%WORKBENCH_RUNTIME%\node\bin\node.exe" set "PATH=%WORKBENCH_RUNTIME%\node\bin;%WORKBENCH_RUNTIME%\bin\fallback;%PATH%"
where pnpm >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 24 与 pnpm，再启动工作台。
  pause
  exit /b 1
)
set TZ=Asia/Shanghai
if not exist ".next\BUILD_ID" (
  call pnpm build
  if errorlevel 1 ( pause & exit /b 1 )
)
echo 工作台地址：http://127.0.0.1:3939
call pnpm start
pause
