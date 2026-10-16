@echo off
cd /d "%~dp0"
where npm >nul 2>nul || (echo Spindle needs Node.js. Get the LTS installer from https://nodejs.org then run this again. & pause & exit /b 1)
if not exist node_modules\electron-builder call npm install
call npm run dist
echo.
echo Done. Your Spindle .exe is in the dist folder.
explorer dist
pause
