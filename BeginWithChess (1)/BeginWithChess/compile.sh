#!/bin/bash
# ============================================================
#  compile.sh  –  BeginWithChess  (Linux / macOS)
#
#  Builds only the C++ chess engine. The GUI is now a web app
#  (in web/) — no Java compilation needed. Run ./run.sh to
#  launch the engine + server + open in your browser.
# ============================================================

set -e

echo "==========================================="
echo " BeginWithChess - Build Script (Linux/Mac)"
echo "==========================================="

# ── Compile C++ engine ──────────────────────────────────────
echo ""
echo "Compiling C++ chess engine..."
g++ -std=c++17 -O2 -Wall \
    main.cpp \
    engine/board.cpp \
    engine/movegen.cpp \
    engine/evaluation.cpp \
    engine/minimax.cpp \
    -o chess_engine

chmod +x chess_engine
echo "   OK - ./chess_engine built"

echo ""
echo "==========================================="
echo " Build complete!"
echo "==========================================="
echo ""
echo " To play:  ./run.sh"
echo " Then open http://localhost:8000/ in your browser."
echo ""
