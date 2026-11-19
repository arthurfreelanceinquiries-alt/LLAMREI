#!/usr/bin/env bash
set -euo pipefail

PORT="${LLAMREI_PORT:-5173}"

echo "=== Llamrei Tailscale Mesh Setup ==="
if ! command -v tailscale >/dev/null 2>&1; then
  echo "Tailscale belum terpasang. Memasang via skrip resmi Tailscale..."
  curl -fsSL https://tailscale.com/install.sh | sh
fi

if ! tailscale status >/dev/null 2>&1; then
  echo "Menjalankan tailscale up (silakan selesaikan login di browser jika diminta)..."
  sudo tailscale up
fi

echo "Mengaktifkan Tailscale Serve HTTPS privat untuk port ${PORT}..."
sudo tailscale serve --bg "${PORT}"

echo "Status Tailscale Serve:"
tailscale serve status || true
echo "Selesai! Buka URL HTTPS .ts.net di atas dari HP Android Anda (yang memakai akun Tailscale yang sama)."
