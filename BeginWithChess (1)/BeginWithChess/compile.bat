@echo off
REM ============================================================
REM  compile.bat  -  BeginWithChess  (Windows)
REM
REM  Builds only the C++ chess engine. The GUI is now a web app.
REM  Run run.bat afterwards to launch the server and open in browser.
REM ============================================================

echo ===========================================
echo  BeginWithChess - Build Script (Windows)
echo ===========================================

echo.
echo Compiling C++ chess engine...
g++ -std=c++17 -O2 -Wall ^
    main.cpp ^
    engine\board.cpp ^
    engine\movegen.cpp ^
    engine\evaluation.cpp ^
    engine\minimax.cpp ^
    -o chess_engine.exe

if errorlevel 1 (
    echo Build failed.
    exit /b 1
)

echo    OK - chess_engine.exe built

echo.
echo ===========================================
echo  Build complete!
echo ===========================================
echo.
echo  To play:  run.bat
echo  Then open http://localhost:8000/ in your browser.
echo.
