#!/usr/bin/env python3
"""
chess_server.py

Bridges a browser (WebSocket) to the BeginWithChess C++ engine (stdin/stdout).
Each WebSocket connection spawns its own engine subprocess.

Usage:
    python3 chess_server.py [--engine PATH] [--host HOST] [--port PORT]
                            [--web-root DIR] [--http-port HTTP_PORT]

The script also serves the web/ folder over HTTP so you can just open
http://localhost:8000/ once the server is running.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import subprocess
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    import websockets
except ImportError:
    print(
        "ERROR: 'websockets' package required.\n"
        "Install with:  pip install websockets",
        file=sys.stderr,
    )
    sys.exit(1)


log = logging.getLogger("chess_server")


class EngineSession:
    """One chess_engine subprocess for one WebSocket client."""

    def __init__(self, engine_path: str):
        self.engine_path = engine_path
        self.proc: "subprocess.Popen | None" = None

    async def start(self):
        log.info("Starting engine: %s", self.engine_path)
        self.proc = await asyncio.create_subprocess_exec(
            self.engine_path,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=os.path.dirname(os.path.abspath(self.engine_path)) or ".",
        )
        # Drain stderr asynchronously so it never fills the pipe buffer.
        # The engine prints search info there, which is useful in --debug mode.
        async def drain_stderr():
            assert self.proc and self.proc.stderr
            while True:
                line = await self.proc.stderr.readline()
                if not line:
                    break
                log.debug("[engine stderr] %s",
                          line.decode("utf-8", errors="replace").rstrip())
        self._stderr_task = asyncio.create_task(drain_stderr())

    async def send(self, command: str):
        if not self.proc or not self.proc.stdin:
            raise RuntimeError("Engine not started")
        line = (command.strip() + "\n").encode("utf-8")
        self.proc.stdin.write(line)
        await self.proc.stdin.drain()

    async def read_line(self):
        if not self.proc or not self.proc.stdout:
            return None
        raw = await self.proc.stdout.readline()
        if not raw:
            return None
        return raw.decode("utf-8", errors="replace").rstrip("\r\n")

    async def close(self):
        if self.proc is None:
            return
        try:
            await self.send("QUIT")
        except Exception:
            pass
        try:
            await asyncio.wait_for(self.proc.wait(), timeout=2.0)
        except asyncio.TimeoutError:
            self.proc.kill()
            await self.proc.wait()
        if hasattr(self, "_stderr_task"):
            self._stderr_task.cancel()
        self.proc = None


async def handle_ws(websocket, engine_path: str):
    peer = getattr(websocket, "remote_address", "?")
    log.info("WebSocket connected: %s", peer)
    session = EngineSession(engine_path)
    try:
        await session.start()
    except FileNotFoundError:
        await websocket.send(json.dumps({
            "type": "error",
            "msg": f"Engine binary not found: {engine_path}"
        }))
        await websocket.close()
        return
    except Exception as e:
        await websocket.send(json.dumps({"type": "error", "msg": f"Engine failed: {e}"}))
        await websocket.close()
        return

    async def reader_task():
        try:
            while True:
                line = await session.read_line()
                if line is None:
                    break
                await websocket.send(json.dumps({"type": "engine", "line": line}))
        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception:
            log.exception("reader_task error")

    reader = asyncio.create_task(reader_task())

    try:
        async for raw in websocket:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                msg = {"type": "cmd", "cmd": raw}
            if msg.get("type") == "cmd":
                cmd = (msg.get("cmd") or "").strip()
                if not cmd:
                    continue
                log.debug("-> engine: %s", cmd)
                await session.send(cmd)
            elif msg.get("type") == "ping":
                await websocket.send(json.dumps({"type": "pong"}))
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        reader.cancel()
        await session.close()
        log.info("WebSocket disconnected: %s", peer)


class _Handler(SimpleHTTPRequestHandler):
    web_root: str = "."
    ws_port: int = 8765

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=self.__class__.web_root, **kwargs)

    def do_GET(self):
        if self.path == "/config.json":
            body = json.dumps({"ws_port": self.__class__.ws_port}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def log_message(self, fmt, *args):
        log.debug("[http] " + fmt, *args)


def start_http_server(web_root: str, port: int, ws_port: int):
    _Handler.web_root = web_root
    _Handler.ws_port = ws_port
    httpd = ThreadingHTTPServer(("0.0.0.0", port), _Handler)
    t = threading.Thread(target=httpd.serve_forever, name="http", daemon=True)
    t.start()
    return httpd


def find_engine_path(explicit):
    """Find the engine binary."""
    here = Path(__file__).resolve().parent
    project = here.parent
    candidates = []
    if explicit:
        candidates.append(Path(explicit))
    if sys.platform.startswith("win"):
        candidates += [
            project / "chess_engine.exe",
            here / "chess_engine.exe",
        ]
    else:
        candidates += [
            project / "chess_engine",
            here / "chess_engine",
        ]
    for c in candidates:
        if c.is_file() and os.access(str(c), os.X_OK):
            return str(c)
    # If nothing found, return the first candidate so we can produce a clear error
    return str(candidates[0]) if candidates else "chess_engine"


async def main_async(args):
    engine_path = find_engine_path(args.engine)
    log.info("Engine path: %s", engine_path)
    if not Path(engine_path).is_file():
        log.warning("Engine binary not found yet at %s", engine_path)
        log.warning("Build it first with `./compile.sh` (Linux/macOS) or `compile.bat` (Windows)")

    web_root = args.web_root or str(Path(__file__).resolve().parent.parent / "web")
    log.info("HTTP root: %s", web_root)
    log.info("HTTP server: http://%s:%d/", args.host, args.http_port)
    start_http_server(web_root, args.http_port, args.port)

    log.info("WebSocket server: ws://%s:%d/", args.host, args.port)
    log.info("")
    log.info("Open  http://localhost:%d/  in your browser to play.", args.http_port)
    log.info("")

    async def ws_entry(ws):
        await handle_ws(ws, engine_path)

    async with websockets.serve(ws_entry, args.host, args.port,
                                ping_interval=20, ping_timeout=20):
        await asyncio.Future()  # run forever


def main():
    parser = argparse.ArgumentParser(description="BeginWithChess web server")
    parser.add_argument("--engine", default=None,
                        help="Path to chess_engine binary (auto-detected if omitted)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765, help="WebSocket port")
    parser.add_argument("--http-port", type=int, default=8000, help="HTTP port for static files")
    parser.add_argument("--web-root", default=None, help="Folder to serve over HTTP")
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.debug else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        log.info("Shutting down.")


if __name__ == "__main__":
    main()
