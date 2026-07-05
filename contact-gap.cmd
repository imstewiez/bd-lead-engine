@echo off
setlocal
cd /d %~dp0
node src\contact-gap-worker.js
endlocal
