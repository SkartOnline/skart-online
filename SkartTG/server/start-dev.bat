@echo off
setlocal
set PATH=C:\Program Files\nodejs;%PATH%
cd /d "%~dp0"

echo [Skart Server] Starting dev server...

set PORT=3000
call :free_port
if errorlevel 1 (
	echo [ERROR] Could not free port %PORT% after multiple attempts.
	echo Close the process manually and run again.
	pause
	exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
	echo [ERROR] Node.js is not available on PATH.
	echo Install Node.js LTS from https://nodejs.org and try again.
	pause
	exit /b 1
)

if not exist "node_modules" (
	echo [Skart Server] node_modules missing, installing dependencies...
	call npm.cmd install
	if errorlevel 1 (
		echo [ERROR] npm install failed.
		pause
		exit /b 1
	)
)

call npm.cmd run dev
set EXIT_CODE=%ERRORLEVEL%
if not "%EXIT_CODE%"=="0" (
	echo.
	echo [ERROR] Dev server exited with code %EXIT_CODE%.
	echo Read the error above, fix it, then run start-dev.bat again.
	pause
)

exit /b %EXIT_CODE%

:free_port
setlocal EnableDelayedExpansion
set /a attempt=0

:retry_free_port
set /a attempt+=1
set FOUND=0

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
	set FOUND=1
	echo [Skart Server] Port %PORT% is already in use by PID %%P. Stopping old process...
	taskkill /PID %%P /F >nul 2>nul
)

if "!FOUND!"=="1" (
	timeout /t 1 /nobreak >nul
)

netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul
if errorlevel 1 (
	endlocal & exit /b 0
)

if !attempt! GEQ 5 (
	endlocal & exit /b 1
)

echo [Skart Server] Port %PORT% still in use, retrying...
goto :retry_free_port
