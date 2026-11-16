@echo off
setlocal EnableExtensions
title RemedacareHMS Lab Bridge - remove
cd /d "%~dp0"
for /f "usebackq delims=" %%v in (`node -p "require('./config.json').installFolder || 'Bridge'" 2^>nul`) do set "FOLDER=%%v"
if "%FOLDER%"=="" for %%I in ("%~dp0.") do set "FOLDER=%%~nxI"
echo.
echo   This stops the lab bridge for "%FOLDER%" and stops it starting with Windows.
echo   Results already waiting in its queue folder are kept.
echo.
choice /m "  Remove it now"
if errorlevel 2 exit /b 0
taskkill /fi "WINDOWTITLE eq RemedacareHMS Lab Bridge - %FOLDER%*" /t /f >nul 2>nul
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\RemedacareHMS Lab Bridge - %FOLDER%.bat" >nul 2>nul
del "%USERPROFILE%\Desktop\Lab bridge log - %FOLDER%.bat" >nul 2>nul
echo.
echo   Removed. The files are still in %LOCALAPPDATA%\RemedacareLabBridge\%FOLDER%
echo   (delete that folder too if nothing is waiting in its "queue" folder).
pause
