#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ANDROID_DIR="${PROJECT_DIR}/android-widgets"
DOWNLOAD_DIR="${PROJECT_DIR}/public/download"
SDK_DIR="${HOME}/.android-sdk"

mkdir -p "${DOWNLOAD_DIR}"

echo "==============================================="
echo "   Llamrei Android Widget APK Auto-Builder    "
echo "==============================================="

# 1. Check / Install Java JDK
if ! command -v javac >/dev/null 2>&1; then
  echo "📦 Memasang OpenJDK 21 & dependencies via apt..."
  sudo apt-get update -y
  sudo apt-get install -y openjdk-21-jdk-headless unzip wget curl
fi

export JAVA_HOME="/usr/lib/jvm/java-21-openjdk-amd64"
export PATH="${JAVA_HOME}/bin:${PATH}"

# 2. Check / Setup Android SDK CLI
export ANDROID_HOME="${SDK_DIR}"
export PATH="${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${PATH}"

if [ ! -d "${SDK_DIR}/cmdline-tools/latest" ]; then
  echo "📥 Mengunduh Android Command Line Tools resmi Google..."
  mkdir -p "${SDK_DIR}/cmdline-tools"
  TMP_ZIP="/tmp/cmdline-tools.zip"
  # Official Android command-line tools for Linux (v11076708)
  curl -fsSL "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip" -o "${TMP_ZIP}"
  unzip -q "${TMP_ZIP}" -d "/tmp/cmdline-tools-extracted"
  rm -rf "${SDK_DIR}/cmdline-tools/latest"
  mv "/tmp/cmdline-tools-extracted/cmdline-tools" "${SDK_DIR}/cmdline-tools/latest"
  rm -f "${TMP_ZIP}" rm -rf "/tmp/cmdline-tools-extracted"
fi

echo "⚙️ Menyetujui lisensi Android SDK & mengunduh build-tools 35..."
mkdir -p "${SDK_DIR}/licenses"
# Accept licenses non-interactively
yes | sdkmanager --licenses >/dev/null 2>&1 || true
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" >/dev/null 2>&1 || true

# 3. Setup Gradle Wrapper in android-widgets if absent
cd "${ANDROID_DIR}"
if [ ! -f "gradlew" ]; then
  echo "🔧 Menyiapkan Gradle Wrapper 8.9..."
  # Download gradle binary distribution to run gradle wrapper
  GRADLE_VER="8.9"
  GRADLE_ZIP="/tmp/gradle-${GRADLE_VER}-bin.zip"
  if [ ! -d "/tmp/gradle-${GRADLE_VER}" ]; then
    curl -fsSL "https://services.gradle.org/distributions/gradle-${GRADLE_VER}-bin.zip" -o "${GRADLE_ZIP}"
    unzip -q "${GRADLE_ZIP}" -d "/tmp"
    rm -f "${GRADLE_ZIP}"
  fi
  /tmp/gradle-${GRADLE_VER}/bin/gradle wrapper --gradle-version "${GRADLE_VER}"
fi

chmod +x gradlew

# 4. Compile APK Debug
echo "🔨 Memulai proses kompilasi APK Llamrei Widgets..."
./gradlew assembleDebug --no-daemon

# 5. Copy output APK to public download directory
OUTPUT_APK="${ANDROID_DIR}/app/build/outputs/apk/debug/app-debug.apk"
if [ -f "${OUTPUT_APK}" ]; then
  cp "${OUTPUT_APK}" "${DOWNLOAD_DIR}/llamrei-widgets.apk"
  echo ""
  echo "=========================================================="
  echo "  ✅ BERHASIL! File APK sudah siap di-download di HP Anda!  "
  echo "=========================================================="
  echo "Ukuran: $(du -h "${DOWNLOAD_DIR}/llamrei-widgets.apk" | cut -f1)"
  echo ""
  echo "Buka tautan ini di browser HP Infinix Anda untuk download:"
  echo "👉 http://100.114.87.2:5173/download/llamrei-widgets.apk"
  echo "=========================================================="
else
  echo "❌ Gagal menemukan file APK hasil kompilasi."
  exit 1
fi
