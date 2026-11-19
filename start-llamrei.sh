#!/usr/bin/env bash
set -e

# ==============================================================================
# LLAMREI AI - Arthur Reezan Personal Command Desk Launcher
# Opens as standalone native desktop app window via Brave or default browser
# ==============================================================================

APP_DIR="/home/arthurreezan/Desktop/AI/Proyek/LLAMREI"
LOG_FILE="$HOME/.llamrei-server.log"
PORT_FRONTEND="5173"
PORT_BACKEND="4321"

export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# 1. Check if server is already running
is_server_ready() {
  curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT_FRONTEND}/" 2>/dev/null | grep -qE "200|304"
}

if ! is_server_ready; then
  cd "$APP_DIR"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [launcher] Starting Llamrei dev server..." >> "$LOG_FILE"
  nohup npm run dev >> "$LOG_FILE" 2>&1 &
  
  # Wait up to 12 seconds for Vite & Backend to accept requests
  for _ in $(seq 1 24); do
    if is_server_ready; then
      break
    fi
    sleep 0.5
  done
fi

# 2. Open as dedicated App Window
APP_URL="http://localhost:${PORT_FRONTEND}/"

if command -v brave-browser >/dev/null 2>&1; then
  # Standalone app mode: sleek native frame, no address/tab bars
  exec brave-browser --app="${APP_URL}" --name="Llamrei" --class="Llamrei" "$@"
elif command -v google-chrome >/dev/null 2>&1; then
  exec google-chrome --app="${APP_URL}" --name="Llamrei" --class="Llamrei" "$@"
elif command -v chromium >/dev/null 2>&1; then
  exec chromium --app="${APP_URL}" --name="Llamrei" --class="Llamrei" "$@"
else
  exec xdg-open "${APP_URL}"
fi
