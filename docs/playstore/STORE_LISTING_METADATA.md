# Metadata Listing Google Play Store — Llamrei

Dokumen ini berisi seluruh teks, kategori, dan jawaban kepatuhan yang siap disalin (*copy-paste*) ke dalam **Google Play Console** saat mendaftarkan aplikasi Llamrei.

---

## 1. Detail Utama Aplikasi (App Details)

* **Nama Aplikasi (App Name):** `Llamrei: Task, Alarm & Widget` *(29 / 30 karakter)*
* **Deskripsi Singkat (Short Description):**
  ```text
  Local-first ClickUp workspace, task alarms, calendar & Android widgets.
  ```
  *(71 / 80 karakter)*
* **Deskripsi Lengkap (Full Description):**
  ```markdown
  Llamrei adalah dasbor produktivitas komando pribadi berbasis local-first yang menghubungkan manajemen tugas bergaya ClickUp, kalender terpadu, sistem alarm 2-tingkat, dan suite widget layar depan Android (All-in-One, Tasks, Alarms, Reminders).

  FITUR UTAMA:
  1. SUITE WIDGET HOME SCREEN ANDROID:
     • Widget All-in-One (4x2 / 4x3): Tampilkan tugas hari ini, countdown alarm berikutnya, dan agenda terdekat sekaligus.
     • Widget Tasks (3x2): Centang tugas selesai langsung dari layar depan tanpa membuka aplikasi.
     • Widget Alarms & Quick Toggle (2x2): Sakelar cepat dan pemantau hitung mundur alarm tugas.
     • Widget Reminders (3x2): Ringkasan jadwal kalender terdekat.

  2. SISTEM ALARM 2-TINGKAT (SOFT REMINDER + HARD ALARM):
     • Menggunakan eksekusi tepat waktu sistem Android (AlarmManager.setAlarmClock) sehingga alarm tugas tetap berbunyi kencang meskipun layar terkunci (Doze Mode).
     • Layar penuh di atas lock-screen dengan opsi Dismiss, Snooze (+5m / +10m / +15m), atau Dismiss & Start Timer.

  3. KONEKTIVITAS LOKAL & MESH TAILSCALE:
     • Sinkronisasi otomatis data tugas dan alarm antara laptop Linux dan HP Android melalui jaringan Wi-Fi LAN lokal maupun tunnel VPN terenkripsi Tailscale Mesh.
     • Offline-First: Saat laptop mati, widget HP tetap menampilkan data dari cache lokal dan membunyikan alarm tepat waktu, lalu menyinkronkan perubahan begitu online kembali.

  4. PRIVASI LOCAL-FIRST TOTAL:
     • Seluruh data tersimpan lokal pada perangkat Anda sendiri (SQLite).
     • Tidak ada pengumpulan data analitik pihak ketiga atau pelacak telemetri.
  ```

---

## 2. Pengelompokan Kategori (Categorization)

* **Jenis Aplikasi:** `Aplikasi (App)`
* **Kategori:** `Produktivitas (Productivity)`
* **Tag:** `Manajemen Tugas`, `Kalender`, `Pengingat & Alarm`, `Widget`
* **Detail Kontak Toko:**
  * Email Dukungan: `arthurfreelanceinquiries@gmail.com`
  * URL Kebijakan Privasi: `https://raw.githubusercontent.com/arthurreezan/Llamrei/main/docs/PRIVACY_POLICY.md` *(atau URL hosting lokal Anda)*

---

## 3. Formulir Deklarasi Izin Kritis (Permission Declarations)

### A. Izin `USE_EXACT_ALARM` & `SCHEDULE_EXACT_ALARM`
* **Kategori Kegunaan yang Dipilih di Konsol:** `Alarm clock or Calendar app`
* **Alasan Penggunaan (Justification for Google Reviewer):**
  ```text
  Aplikasi ini berfungsi sebagai pengingat waktu dan jam weker tugas (Task Alarm Engine). Pengguna menyetel waktu spesifik untuk tugas-tugas penting yang memerlukan eksekusi tepat waktu di atas layar kunci (Exact Alarm). Fitur inti ini tidak dapat digantikan oleh notifikasi standar karena keterlambatan beberapa menit dalam Doze Mode akan menyebabkan pengguna melewatkan tenggat dan alarm tugas penting mereka.
  ```

### B. Izin `POST_NOTIFICATIONS`
* Digunakan untuk menampilkan notifikasi hitung mundur alarm, soft reminder H-15 menit, dan status sinkronisasi widget.

### C. Kuesioner Keamanan Data (Data Safety Form)
* **Apakah aplikasi mengumpulkan atau membagikan data pengguna?** ➔ **TIDAK (No)**
* Semua data disimpan secara lokal di perangkat pengguna (Local-First SQLite).
* Komunikasi jaringan hanya terjadi secara peer-to-peer antara HP pengguna dan PC pengguna via LAN atau Tailscale privat pengguna sendiri.
