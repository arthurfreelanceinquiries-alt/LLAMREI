#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ANDROID_DIR="${PROJECT_DIR}/android-widgets"

echo "=== Llamrei Android App Bundle (.aab) Builder ==="

if ! command -v java >/dev/null 2>&1; then
  echo "⚠️ Java JDK belum terpasang di sistem ini."
  echo "Untuk mengompilasi file .aab langsung dari terminal Linux, silakan pasang OpenJDK 17:"
  echo "  sudo apt update && sudo apt install -y openjdk-17-jdk"
  echo ""
  echo "Atau buka folder berikut langsung di Android Studio:"
  echo "  ${ANDROID_DIR}"
  echo "Lalu pilih menu: Build -> Generate Signed Bundle / APK -> Android App Bundle."
  exit 1
fi

cd "${ANDROID_DIR}"

if [ ! -f "gradlew" ]; then
  if command -v gradle >/dev/null 2>&1; then
    gradle wrapper
  fi
fi

if [ -f "gradlew" ]; then
  echo "Memulai kompilasi Android App Bundle (.aab) rilis..."
  ./gradlew bundleRelease
  echo ""
  echo "✅ Selesai! File .aab siap diunggah ke Google Play Console:"
  find app/build/outputs/bundle -name "*.aab" 2>/dev/null || true
else
  echo "Gunakan Android Studio untuk membuka folder: ${ANDROID_DIR}"
fi
