@echo off
setlocal
cd /d "%~dp0"

if not exist "dist\main\main\main.js" (
    echo Bake Alley POS has not been built yet.
    echo Run the build once with: npm run build
    pause
    exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
    echo Electron is not installed in node_modules.
    echo Run npm install once, then run npm run build.
    pause
    exit /b 1
)

start "Bake Alley POS" /D "%~dp0" "node_modules\electron\dist\electron.exe" "%~dp0"
endlocal
