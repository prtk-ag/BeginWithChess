#!/usr/bin/env bash
# run.sh — start the chess server (builds the engine first if needed)
set -e

cd "$(dirname "$0")"

# Build engine if missing
if [ ! -x "./chess_engine" ]; then
    echo "[run] chess_engine not found — building it now"
    ./compile.sh
fi

# Make sure Python websockets package is available
if ! python3 -c "import websockets" >/dev/null 2>&1; then
    echo "[run] Installing 'websockets' Python package"
    python3 -m pip install --user websockets || \
    python3 -m pip install websockets
fi

echo "[run] Starting server. Open http://localhost:8000/ in your browser."
echo "[run] Press Ctrl+C to stop."
echo ""
exec python3 server/chess_server.py "$@"
