@echo off
rem Starts the RemedacareHMS lab bridge in a minimised window and restarts it if it ever stops.
for %%I in ("%~dp0.") do set "FOLDER=%%~nxI"
if not "%~1"=="min" goto relaunch
title RemedacareHMS Lab Bridge - %FOLDER%
cd /d "%~dp0"
:loop
node bridge.mjs config.json
echo The bridge stopped. Restarting in 15 seconds...
timeout /t 15 /nobreak >nul
goto loop
:relaunch
start "RemedacareHMS Lab Bridge - %FOLDER%" /min cmd /c ""%~f0" min"
