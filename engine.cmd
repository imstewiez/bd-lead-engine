@echo off
setlocal
cd /d %~dp0

REM The engine-control script launches the managed background workers itself.
REM Keep the web server from also starting a second continuous super scan.
if "%AUTO_START_SOURCING%"=="" set AUTO_START_SOURCING=false
if "%ENGINE_BACKGROUND_PROFILE%"=="" set ENGINE_BACKGROUND_PROFILE=balanced

node src\engine-control.js
endlocal
