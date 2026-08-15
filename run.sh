#!/usr/bin/env bash
# ==============================================================================
# Memoir - Voice-Driven Connected Thought Vault Launcher
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT=5432

echo "============================================================"
echo " 🧠 Starting Memoir - Voice Connected Thought Vault"
echo " 📂 Vault Path: $SCRIPT_DIR/vault"
echo " 🌐 Web UI:     http://localhost:$PORT"
echo "============================================================"

# Check if browser is available to auto-open
OPEN_CMD=""
if command -v xdg-open >/dev/null 2>&1; then
    OPEN_CMD="xdg-open"
elif command -v chromium-browser >/dev/null 2>&1; then
    OPEN_CMD="chromium-browser"
elif command -v firefox >/dev/null 2>&1; then
    OPEN_CMD="firefox"
fi

# Launch browser in background after 1 second delay
if [ -n "$OPEN_CMD" ] && [ -n "$DISPLAY" ]; then
    (sleep 1 && $OPEN_CMD "http://localhost:$PORT" >/dev/null 2>&1 &)
fi

# Start Python server
exec python3 "$SCRIPT_DIR/app.py" "$PORT"
