# BeginWithChess — Web Edition
./compile.sh         # builds the C++ engine
./run.sh             # starts the server (auto-installs `websockets` if needed)
```

Then open **http://localhost:8000/** in your browser.

### Windows

```cmd
compile.bat
run.bat
```

Open **http://localhost:8000/** in your browser.

### Requirements

- C++17 compiler (`g++`, `clang`, MSVC + MinGW, etc.)
- Python 3.8+
- A modern browser with WebGL2 (Chrome, Firefox, Edge, Safari 15+)
- The `websockets` Python package (the launcher installs it for you the first
  time if it's missing)

## Project layout

```
BeginWithChess_Web/
├── engine/              C++ engine (board, move-gen, eval, minimax)
├── main.cpp             Engine CLI entry point — speaks the line protocol
├── server/
│   └── chess_server.py  WebSocket bridge + static HTTP server
├── web/                 Browser frontend
│   ├── index.html       UI shell
│   ├── style.css        Styling (chess-club editorial theme)
│   ├── js/
│   │   ├── main.js      Three.js scene, board, camera, picking, animation
│   │   ├── pieces.js    Procedural piece geometries (lathe + custom knight)
│   │   ├── engine.js    WebSocket client wrapping the engine protocol
│   │   └── game.js      Board model + FEN parser
│   └── vendor/three/    Bundled Three.js (no internet needed at runtime)
├── compile.sh / .bat    Build the C++ engine
├── run.sh / .bat        Launch the server
└── Makefile             Alternative build via `make` / `make run`
```

## How the pieces are made

Each piece (except the knight) is a **body of revolution**: a 2D silhouette
profile is spun around the Y axis using `THREE.LatheGeometry`, producing a
smooth turned-on-a-lathe shape — exactly how real wooden chess pieces are
manufactured. Profiles are tuned to evoke the classic Staunton design:

- **Pawn** — base, narrow stem, collar, and a spherical head
- **Rook** — taper, tower, top platform, with four cube battlements added on top
- **Bishop** — egg-shaped mitre with a stem-and-ball finial; a thin dark slit
  is inset to suggest the priest's mitre cut
- **Queen** — flowing body with a pearled crown of eight balls plus a center
- **King** — wider hips than the queen with a 3D cross on top

The **knight** is built from primitive boxes, cones, and spheres rotated and
nested to form a horse silhouette in profile, with separate eyes, nostrils,
ears, and a darker mane slab.

The board is a stack of slightly-elevated tiles on a thicker dark frame.
A canvas-generated noise texture is used as a bump map on the squares for
procedural wood grain. File and rank labels are rendered as canvas textures
in the same Cormorant Garamond italic that drives the rest of the UI.

## Server options

```
python3 server/chess_server.py [options]

  --engine PATH        Path to the chess_engine binary (auto-detected)
  --host HOST          Bind address (default: 127.0.0.1)
  --port PORT          WebSocket port (default: 8765)
