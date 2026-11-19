# Kebijakan Privasi — Personal Dashboard Llamrei

Terakhir diperbarui: 19 November 2026

1. **Arsitektur Local-First:** Seluruh tugas ClickUp, catatan, jadwal kalender, alarm, jurnal trading, dan riwayat percakapan Llamrei disimpan secara lokal pada perangkat pengguna (`SQLite`). Pengembang tidak mengoperasikan server cloud terpusat.
2. **Akses Notifikasi & Alarm (`Notification Access` & `USE_EXACT_ALARM`):**
   - Jika pengguna mengaktifkan jembatan **NectarLink** atau izin notifikasi di Android, isi notifikasi diproses **secara lokal di perangkat** dan dikirim antar perangkat milik pengguna melalui koneksi terenkripsi *end-to-end* (*mutual TLS* di LAN / Tailscale Mesh pribadi).
   - Izin `USE_EXACT_ALARM` / `SCHEDULE_EXACT_ALARM` digunakan semata-mata untuk membunyikan **Hard Alarm** tugas dan jadwal kalender yang secara eksplisit diaktifkan pengguna.
3. **Pemrosesan AI (Google Gemini API):**
   - Pemanggilan AI bersifat opsional menggunakan API key milik pengguna sendiri.
   - Potongan teks chat WhatsApp hanya boleh dikirim ke model AI apabila pengguna telah mengonfirmasi proyek dengan penagihan aktif (`paid_billing_verified = true`), terbatas pada pesan yang menyebut alias pengguna plus maksimal dua pesan konteks dengan nomor telepon disamarkan (`[PHONE_REDACTED]`).
4. **Penafian Finansial:** Informasi pasar, watchlist, dan ringkasan jurnal trading hanya bersifat informasional dan evaluasi pribadi, **bukan saran investasi**.
