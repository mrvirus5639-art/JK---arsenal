@echo off
cd /d "%~dp0"
where npm >nul 2>nul || (echo Spindle needs Node.js. Get the LTS installer from https://nodejs.org then run this again. & pause & exit /b 1)
if not exist node_modules\electron (
  echo First run: downloading Electron, this takes a minute...
  call npm install || (pause & exit /b 1)
)
call npm start
