# Panduan Lengkap Publikasi Google Play Store — Llamrei

Panduan resmi langkah-demi-langkah untuk mendaftarkan dan merilis aplikasi **Llamrei (Android App Bundle / AAB)** ke **Google Play Store**.

---

## Ringkasan Aset yang Sudah Disiapkan untuk Anda

Seluruh berkas persyaratan Play Store telah dibuat dan tersimpan rapi di folder `docs/playstore/`:
1. 🎨 **Ikon Aplikasi Resolusi Tinggi (512x512 PNG, 32-bit):**
   `docs/playstore/icon-512.png`
2. 🖼️ **Banner Grafis Fitur (1024x500 PNG):**
   `docs/playstore/feature-graphic-1024x500.png`
3. 📝 **Metadata Deskripsi & Teks Listing:**
   `docs/playstore/STORE_LISTING_METADATA.md`
4. 🔒 **Kebijakan Privasi (Privacy Policy):**
   `docs/PRIVACY_POLICY.md`
5. 🛡️ **Kuesioner Keamanan Data (Data Safety Form):**
   `docs/GOOGLE_PLAY_DATA_SAFETY.md`

---

## 7 Langkah Rilis ke Google Play Console

### Langkah 1: Akun Google Play Console Developer
* Kunjungi: **https://play.google.com/console/signup**
* Login menggunakan akun Google Anda (`arthurfreelanceinquiries@gmail.com`).
* Bayar biaya registrasi developer Google (\$25, berlaku seumur hidup).
* Lengkapi verifikasi identitas (KTP/Paspor) sesuai instruksi Google.

---

### Langkah 2: Buat Aplikasi Baru di Konsol
1. Di beranda Google Play Console, klik tombol biru: **Buat Aplikasi (Create App)**.
2. Isi formulir awal:
   * **Nama Aplikasi:** `Llamrei: Task, Alarm & Widget`
   * **Bahasa Default:** `Bahasa Indonesia` (atau `Inggris - US`)
   * **Aplikasi atau Game:** `Aplikasi`
   * **Gratis atau Berbayar:** `Gratis`
3. Centang persetujuan Kebijakan Pengembang dan Persyaratan Ekspor AS ➔ Klik **Buat Aplikasi**.

---

### Langkah 3: Pengaturan Listing Toko Utama (Store Listing)
Buka menu sebelah kiri: **Tumbuhkan pengguna → Keberadaan di Google Play Store → Listing Toko Utama**:
1. Copy-paste teks dari file [`STORE_LISTING_METADATA.md`](file:///home/arthurreezan/Desktop/AI/Proyek/LLAMREI/docs/playstore/STORE_LISTING_METADATA.md):
   * *Deskripsi Singkat*
   * *Deskripsi Lengkap*
2. Unggah Aset Grafis:
   * **Ikon Aplikasi:** Unggah `docs/playstore/icon-512.png`
   * **Grafis Fitur:** Unggah `docs/playstore/feature-graphic-1024x500.png`
   * **Tangkapan Layar (Screenshots):** Unggah 2–4 screenshot tampilan widget di HP dan dashboard.

---

### Langkah 4: Kepatuhan Kebijakan & Konten Aplikasi
Buka menu sebelah kiri: **Kebijakan dan program → Konten aplikasi (App Content)**:

1. **Kebijakan Privasi (Privacy Policy):**
   * Masukkan URL kebijakan privasi (file [`docs/PRIVACY_POLICY.md`](file:///home/arthurreezan/Desktop/AI/Proyek/LLAMREI/docs/PRIVACY_POLICY.md) yang di-host di GitHub atau website Anda).
2. **Keamanan Data (Data Safety):**
   * Jawab **"Tidak"** untuk pengumpulan data pihak ketiga (karena aplikasi ini 100% *local-first* tersimpan di HP/laptop Anda sendiri).
3. **Deklarasi Izin Alarm Tepat Waktu (`USE_EXACT_ALARM`):**
   * Pilih kategori: **Jam weker atau Kalender (Alarm clock or Calendar app)**.
   * Salin alasan pembenaran dari `STORE_LISTING_METADATA.md` bagian 3A.
4. **Rating Konten (IARC Questionnaire):**
   * Jawab kuesioner standar (aplikasi utilitas tanpa kekerasan/judi/pornografi) ➔ Anda akan mendapatkan rating **Semua Umur (Everyone / PEGI 3)**.
5. **Target Audiens:**
   * Pilih usia **18 tahun ke atas** (tidak menargetkan anak-anak di bawah 13 tahun).

---

### Langkah 5: Buat Rilis Versi Perdana (Unggah `.aab`)
Google Play Store mewajibkan format **Android App Bundle (.aab)**:
1. Buka folder `android-widgets/` di Android Studio (atau compile via Gradle).
2. Pilih menu: **Build → Generate Signed Bundle / APK → Android App Bundle**.
3. Buat keystore rilis (`llamrei-key.jks`) dan klik **Finish**.
4. File `.aab` hasil build akan terbit di:
   `android-widgets/app/build/outputs/bundle/release/app-release.aab`
5. Di Google Play Console, buka menu: **Rilis → Pengujian tertutup (Closed testing)** ➔ Unggah file `.aab` tersebut.

---

### Langkah 6: Tahap Uji Coba Tertutup (Closed Testing 14 Hari — Wajib untuk Akun Personal Baru)
*Sejak November 2023, Google mewajibkan semua akun developer personal baru untuk melakukan uji coba tertutup dengan minimal 12 penguji sebelum aplikasi bisa dirilis ke publik umum:*
1. Buat daftar email penguji (masukkan minimal 12–20 alamat email Google teman, rekan kuliah, atau kerabat Anda).
2. Bagikan tautan uji coba tertutup Google Play kepada mereka.
3. Minta mereka mengunduh aplikasi dan membiarkannya terpasang selama **14 hari berturut-turut**.

---

### Langkah 7: Pengajuan Produksi Publik (Public Production)
1. Setelah 14 hari pengujian tertutup selesai, tombol **Terapkan untuk akses produksi (Apply for Production)** akan aktif di Google Play Console Anda.
2. Klik tombol tersebut ➔ Tim Google Play akan mereview aplikasi Anda dalam waktu 1–3 hari kerja.
3. Aplikasi **Llamrei** resmi tayang secara publik di Google Play Store di seluruh dunia!
