@echo off
setlocal EnableExtensions
title RemedacareHMS Lab Bridge - setup
cd /d "%~dp0"
echo.
echo   RemedacareHMS Lab Bridge - setup
echo   ================================
echo.
if exist "config.json" goto have_config
echo   config.json is missing. Download the lab bridge again from RemedacareHMS
echo   (Laboratory - Analyzers - Download lab bridge) and unzip the whole file.
pause
exit /b 1
:have_config

rem ---- 1. Node.js -------------------------------------------------------------
where node >nul 2>nul && goto node_ok
echo [1/4] Installing Node.js (needs internet, takes a few minutes)...
winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
set "PATH=%PATH%;%ProgramFiles%\nodejs"
where node >nul 2>nul && goto node_ok
echo.
echo   Node.js could not be installed automatically.
echo   The download page will open now: install the "LTS" version,
echo   then double-click INSTALL again.
start "" "https://nodejs.org/en/download"
pause
exit /b 1
:node_ok
echo [1/4] Node.js is ready.

rem ---- 2. Copy to a permanent folder (so deleting Downloads does not break it) --
for /f "usebackq delims=" %%v in (`node -p "require('./config.json').installFolder || 'Bridge'"`) do set "FOLDER=%%v"
set "DEST=%LOCALAPPDATA%\RemedacareLabBridge\%FOLDER%"
echo [2/4] Copying the bridge to %DEST%
if not exist "%DEST%" mkdir "%DEST%"
if /i "%~dp0"=="%DEST%\" goto copied
xcopy "%~dp0*" "%DEST%\" /e /i /y /q >nul
:copied
cd /d "%DEST%"

findstr /c:"\"serial\"" config.json >nul 2>nul || goto serial_done
echo        Installing the serial-cable support...
call npm install --no-audit --no-fund --silent serialport
:serial_done

rem ---- 3. Start automatically when this PC is logged in --------------------------
echo [3/4] Setting the bridge to start automatically when this PC is logged in...
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
> "%STARTUP%\RemedacareHMS Lab Bridge - %FOLDER%.bat" echo @start "" "%DEST%\START.bat"
> "%USERPROFILE%\Desktop\Lab bridge log - %FOLDER%.bat" echo @start "" notepad "%DEST%\bridge.log"

rem ---- 4. Start now -----------------------------------------------------------------
echo [4/4] Starting the bridge...
start "" "%DEST%\START.bat"

echo.
echo   Done. The bridge runs in a small window on the taskbar - do not close it.
echo   A "Lab bridge log" shortcut is on the Desktop if you need to check it.
echo.
node -e "for (const a of require('./config.json').analysers) { if (a.transport === 'tcp-server') console.log('  On the analyser, set the LIS / host address to this PC and the port to ' + a.port + '.'); if (a.transport === 'serial') console.log('  The analyser cable must be on ' + a.path + ' at ' + (a.baudRate || 9600) + ' baud.'); if (a.transport === 'folder') console.log('  Set the analyser software to export results to ' + a.folder); }"
echo.
echo   This PC's network address:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo     %%a
echo.
echo   If Windows Firewall asks about Node.js, click "Allow access".
echo.
pause
