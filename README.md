# Llamrei — Personal Command, Phone Hub & Life OS

> **Pusat Komando Personal Satu Pintu untuk Arthur Reezan:** Manajemen kerja mendalam ala ClickUp, sistem alarm tugas 2-tingkat, asisten cerdas Llamrei (Co-Commander), pusat komunikasi WhatsApp terpadu (Baileys socket & ekspor parser), kendali smartphone tanpa USB debugging (NectarLink Phone Hub), suite widget native Android (Kotlin Glance), dan jurnal trading dengan analisis korelasi tilt guard.

[![Node.js](https://img.shields.io/badge/Node.js-24%2B-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-19.0-blue.svg)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4.0-38bdf8.svg)](https://tailwindcss.com/)
[![SQLite](https://img.shields.io/badge/Database-SQLite-003B57.svg)](https://www.sqlite.org/)
[![Android SDK](https://img.shields.io/badge/Android-SDK%2034-3DDC84.svg)](https://developer.android.com/)
[![Tailscale](https://img.shields.io/badge/Network-Tailscale%20Mesh-gray.svg)](https://tailscale.com/)
[![Tests](https://img.shields.io/badge/Tests-16%2F16%20Passing-brightgreen.svg)]()

---

## 📖 Dokumen Induk & Spesifikasi Lengkap

Dokumentasi master yang menjelaskan seluruh visi, kebutuhan fungsional (FR-01 s/d FR-81), diagram arsitektur komponen, skema database, dan roadmap implementasi tersedia lengkap di:

👉 **[DOKUMEN INDUK & BLUEPRINT SISTEM (v3.0)](DOKUMEN_INDUK_LLAMREI.md)**  
👉 **[ROADMAP & IDE PENGEMBANGAN v3.1–v4.0 (Penegakan Disiplin & Ketahanan)](docs/ROADMAP_DAN_IDE_PENGEMBANGAN.md)**

---

## ⚡ Fitur Utama Sistem

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PERSONAL DASHBOARD LLAMREI                         │
├──────────────────┬───────────────────┬───────────────────┬──────────────────┤
│ 1. ClickUp Hub   │ 2. Alarm & Kalender│ 3. WhatsApp Center│ 4. Phone Hub     │
│ • Hierarki Penuh │ • Kalender Visual │ • Socket Baileys  │ • Screencast 60fps│
│ • List/Board View│ • Soft Reminder   │ • QR Code Pairing │ • Auto-DND Kerja │
│ • Docs Markdown  │ • ⏰ Hard Alarm   │ • Focused 1-Chat  │ • Continuity Cam │
│ • Recurring Task │ • Web Audio Siren │ • Klasifikasi 5-D │ • LocalSend Wi-Fi│
│ • Time Tracker   │ • Android AlarmMgr│ • Strict Evt Gate │ • Cross Timeline │
├──────────────────┴───────────────────┴───────────────────┴──────────────────┤
│ 5. Suite Widget Android Native (Kotlin Glance / AppWidgetProvider)          │
│ • All-in-One (4×3)  • Task List (3×2)  • Alarms (2×2)  • Reminders (3×2)    │
│ • Offline Cache & Outbox Queue (tetap bunyi saat laptop mati di tas)        │
├──────────────────────────────────────┬──────────────────────────────────────┤
│ 6. Life OS & Trading Intelligence    │ 7. Jaringan Multi-Jalur (Mesh)       │
│ • 10-Second Morning Check-In         │ • 🟢 Jalur 1: Local LAN mDNS (~3ms) │
│ • Trader Tilt & Overtrade Guard      │ • 🟣 Jalur 2: Tailscale (100.x.y.z)  │
│ • Jurnal Trading R-multiple & PnL    │ • 🟡 Jalur 3: Offline Reconcile      │
│ • Korelasi Emosi vs Skor Kesiapan    │ • Zero Open Port (WireGuard E2EE)    │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

---

## 🚀 Panduan Memulai Cepat (Quick Start)

### Prasyarat
- **Node.js:** Versi 24 atau lebih baru (`node -v`)
- **NPM:** Bawaan Node.js
- **Browser:** Brave / Google Chrome / Chromium (untuk desktop app window mode)
- *(Opsional)* **Android Studio / OpenJDK 17/21:** Jika ingin mengompilasi APK/AAB Android secara lokal

### 1. Instalasi Dependensi
```bash
npm install
```

### 2. Menjalankan Dashboard (Mode Pengembangan)
```bash
npm run dev
```
Dashboard akan aktif pada:
- **Frontend UI:** `http://localhost:5173`
- **Backend API & SSE Server:** `http://localhost:4321`

### 3. Menjalankan Mode Desktop Standalone
Buka antarmuka dalam jendela aplikasi ramping mandiri (tanpa tab bar / address bar):
```bash
# Di Linux (Brave/Chrome App Mode):
./start-llamrei.sh

# Di Windows:
start-llamrei.bat
```

### 4. Menjalankan Pengujian Otomatis (Test Suite)
```bash
npm test
```
*Memverifikasi 16 suite pengujian end-to-end: Baileys WA, ClickUp sync, Auto-DND, Mobile Widget reconciliation, Approval gates, Trading journal, CSV safety, dan event proposal gates.*

---

## 📱 Suite Widget Android Native & Google Play Store

Folder `android-widgets/` berisi kode sumber aplikasi Android native yang siap dikompilasi:

```bash
# Kompilasi file APK rilis lokal:
./scripts/build-apk.sh

# Kompilasi file Android App Bundle (.aab) untuk Google Play Store:
./scripts/build-android-bundle.sh
```

Aset dan dokumen kepatuhan Play Store telah disiapkan di folder `docs/`:
- 🖼️ **Aset Grafis:** `docs/playstore/icon-512.png` & `docs/playstore/feature-graphic-1024x500.png`
- 📝 **Metadata Listing:** `docs/playstore/STORE_LISTING_METADATA.md`
- 🔒 **Kebijakan Privasi:** `docs/PRIVACY_POLICY.md`
- 🛡️ **Kuesioner Keamanan Data:** `docs/GOOGLE_PLAY_DATA_SAFETY.md`
- 📋 **Checklist Pengajuan:** `docs/playstore/PLAY_STORE_SUBMISSION_CHECKLIST.md`

---

## 🔒 Privasi & Keamanan (Local-First Sovereign Architecture)

- **100% Penyimpanan Lokal:** Seluruh data tugas, catatan, riwayat WhatsApp, jurnal trading, dan alarm tersimpan secara lokal di mesin Anda menggunakan SQLite.
- **Tanpa Port Publik:** Tidak ada port yang dibuka ke internet publik. Akses remote hanya berjalan melalui tunnel WireGuard terenkripsi **Tailscale Mesh**.
- **Persetujuan Mutlak Pesan Keluar (*Approve-Then-Send*):** Agen AI dilarang mengirim pesan tanpa konfirmasi eksplisit pengguna via kartu persetujuan (*Approval Card*).
- **Proteksi Injeksi Formula:** Mesin impor/ekspor CSV memfilter seluruh karakter berbahaya (`=`, `+`, `-`, `@`).

### Akses browser melalui Tailscale Serve

Build dashboard dengan `npm run build`. Tetapkan `LLAMREI_REMOTE_ORIGIN` ke origin HTTPS persis yang ditampilkan oleh Tailscale Serve, misalnya `https://llamrei.example-tailnet.ts.net`, lalu jalankan `npm start` dengan API tetap terikat ke `127.0.0.1`. Arahkan Tailscale Serve privat ke port API, default `4321`. Proxy lokal harus meneruskan host asal serta header `X-Forwarded-Host` dan `X-Forwarded-Proto: https` dari koneksi TLS.

Buka alamat HTTPS di browser dan masuk dengan token API yang sudah dikonfigurasi melalui `LLAMREI_API_TOKEN` atau file `.api.token` di direktori vault. Sesi berlaku satu jam dan bisa diakhiri dengan tombol **Keluar dari sesi jarak jauh**. Aplikasi Android dan klien API tetap memakai header `Authorization: Bearer`. Dashboard di localhost tetap dapat dibuka langsung.

---

## 📄 Lisensi
Hak Cipta © 2026 Arthur Reezan. Seluruh hak cipta dilindungi undang-undang.
