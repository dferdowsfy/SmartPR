#!/bin/bash
# Boot the virtual display, VNC exporter, then the agent API.
set -euo pipefail

rm -f /tmp/.X99-lock
Xvfb :99 -screen 0 1280x800x24 >/tmp/xvfb.log 2>&1 &
sleep 1

# Localhost-only: the only way in is the token-gated /vnc/websock bridge.
x11vnc -display :99 -localhost -forever -shared -rfbport 5900 \
  -bg -o /tmp/x11vnc.log

exec uvicorn app:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers
