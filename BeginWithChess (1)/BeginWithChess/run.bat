@echo off
REM run.bat — start the chess server on Windows.

cd /d "%~dp0"

if not exist "chess_engine.exe" (
    echo [run] chess_engine.exe not found -- building it now
    call compile.bat
    if errorlevel 1 goto :error
)

REM Make sure Python websockets is installed
python -c "import websockets" >nul 2>&1
if errorlevel 1 (
    echo [run] Installing 'websockets' Python package
    python -m pip install websockets
    if errorlevel 1 goto :pyerr
)

echo.
echo [run] Starting server. Open http://localhost:8000/ in your browser.
echo [run] Press Ctrl+C to stop.
echo.
python server\chess_server.py %*
goto :eof

:error
echo [run] Engine build failed.
exit /b 1

:pyerr
echo [run] Could not install websockets. Make sure Python 3 and pip are available.
exit /b 1
