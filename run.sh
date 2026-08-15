#!/usr/bin/env bash
# ==============================================================================
# Memoir - Voice-Driven Connected Thought Vault Launcher (Standalone App Mode)
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT=5432
URL="http://localhost:$PORT"

echo "============================================================"
echo " 🧠 Starting Memoir - Voice Connected Thought Vault"
echo " 📂 Vault Path: $SCRIPT_DIR/vault"
echo " 🌐 Web UI:     $URL (Standalone App Window Mode)"
echo "============================================================"

# Determine browser command for Standalone App Window (No address bar, no tabs)
BROWSER_LAUNCH=""
if command -v chromium >/dev/null 2>&1; then
    BROWSER_LAUNCH="chromium --app=$URL --class=Memoir --name=Memoir --user-data-dir=$HOME/.config/memoir-chromium"
elif command -v chromium-browser >/dev/null 2>&1; then
    BROWSER_LAUNCH="chromium-browser --app=$URL --class=Memoir --name=Memoir --user-data-dir=$HOME/.config/memoir-chromium"
elif command -v google-chrome >/dev/null 2>&1; then
    BROWSER_LAUNCH="google-chrome --app=$URL --class=Memoir --name=Memoir"
elif command -v firefox >/dev/null 2>&1; then
    BROWSER_LAUNCH="firefox --kiosk $URL"
elif command -v xdg-open >/dev/null 2>&1; then
    BROWSER_LAUNCH="xdg-open $URL"
fi

# If server is already running, just launch the window and exit
if curl -s "$URL/api/status" >/dev/null 2>&1; then
    echo "✓ Memoir server already active on port $PORT. Launching window..."
    if [ -n "$BROWSER_LAUNCH" ] && [ -n "$DISPLAY" ]; then
        exec $BROWSER_LAUNCH
    fi
    exit 0
fi

# Launch standalone window in background once server comes online
if [ -n "$BROWSER_LAUNCH" ] && [ -n "$DISPLAY" ]; then
    (
        for i in {1..30}; do
            if curl -s "$URL/api/status" >/dev/null 2>&1; then
                break
            fi
            sleep 0.2
        done
        $BROWSER_LAUNCH >/dev/null 2>&1 &
    ) &
fi

# Start Python server
exec /usr/bin/python3 "$SCRIPT_DIR/app.py" "$PORT"
