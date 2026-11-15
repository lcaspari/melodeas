#!/bin/bash
# Double-click to run Melodeas on http://localhost (needed for the microphone in Safari and Firefox).
cd "$(dirname "$0")"
PORT=8123
( sleep 1; open "http://localhost:$PORT/index.html" ) &
python3 -m http.server "$PORT"
