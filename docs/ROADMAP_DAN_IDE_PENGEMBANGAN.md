# Roadmap & Ide Pengembangan Llamrei (v3.1 - v4.0)

Tanggal Dokumen: 19 November 2026  
Penyusun: @Arthur Reezan  
Tujuan: Menutup celah operasional dari Dokumen Induk v3.0, mengubah sistem dari pencatatan pasif menjadi penegakan disiplin aktif, ketahanan data, dan integrasi akademik/trading.

---

## 1. Trading: Dari Mencatat Pasif Menjadi Penegakan Disiplin Aktif

1. **Pre-Trade Checklist Gate:**
   - Sebelum entri jurnal diizinkan dibuat, sistem memunculkan verifikasi wajib 3-faktor:
     1. Apakah sudah mengisi *10-Second Morning Check-In*?
     2. Apakah ada rilis berita *High-Impact* (CPI/NFP/FOMC) dalam 30 menit ke depan?
     3. Apakah rasio risiko (Risk-to-Reward) dan SL telah dihitung secara matematis?
   - Jika checklist dilanggar, antarmuka memunculkan *Red Alert Banner* peringatan risiko tinggi.
2. **Daily Loss Limit & Cooldown Circuit Breaker:**
   - Jika jurnal mendeteksi 2–3 kekalahan beruntun (*consecutive losses*) atau input emosi `revenge`/`tilted`, sistem otomatis:
     - Mengunci formulir entri jurnal trading selama periode *cooldown* (misal: 60–120 menit).
     - Menyalakan mode **Do Not Disturb (DND)** di smartphone via jembatan NectarLink.
3. **Kalkulator Posisi & Risiko (Position Sizing):**
   - Perhitungan otomatis lot size berdasarkan jarak Stop Loss (dalam pips/poin) dan persentase toleransi modal akun (% risk). Data langsung otomatis mengisi formulir entri jurnal.
4. **Lampiran Bukti Tangkapan Layar (Chart Screenshots) & Impor Statement:**
   - Penyimpanan gambar setup sebelum dan sesudah eksekusi.
   - Parser berkas laporan riwayat trading MT4/MT5 (format HTML/CSV) untuk mengeliminasi input manual yang rentan bias.
5. **Laporan Kinerja Mingguan Otomatis:**
   - Perhitungan otomatis *Win Rate*, *Profit Factor*, *Expectancy*, kurva ekuitas (*Equity Curve*), dan *Maximum Drawdown* per sesi pasar (London/NY), per pasangan mata uang (XAUUSD/EURUSD), per hari, dan per status emosi.
6. **Blok "No-Trade Window" di Kalender:**
   - Pembuatan blok visual otomatis di kalender 30 menit sebelum dan sesudah rilis data ekonomi *High-Impact* untuk mencegah pembukaan posisi saat volatilitas ekstrem.

---

## 2. Agen Llamrei Cerdas & Proaktif

1. **Memori Jangka Panjang (RAG Lokal Terenkripsi):**
   - Basis pengetahuan *vector-embeddings* lokal untuk dokumen skripsi, catatan rapat BEM, dan arsip obrolan penting, sehingga Llamrei mampu menjawab pertanyaan berbasis konteks historis (*Retrieval-Augmented Generation*).
2. **Fallback Model LLM Lokal (Ollama / Local Runner):**
   - Beralih mulus ke model offline (misal: Qwen 2.5 atau Llama 3) saat koneksi internet terputus atau batas kuota API Gemini tercapai.
3. **Agen Proaktif (Bukan Hanya Menunggu Perintah):**
   - Peringatan dini otomatis, contoh: *"Tugas Bab 4 Skripsi belum ada pembaruan selama 3 hari berturut-turut, padahal tenggat bimbingan adalah hari Jumat."*
4. **Ritual Penutup Hari (Evening Shutdown Routine):**
   - Dialog penutup hari untuk mengevaluasi tugas yang selesai, mencatat sisa pekerjaan, dan menjadwalkan ulang tugas tertunda ke hari berikutnya.
5. **Deteksi Kata Kunci Suara (*Voice Wake-Word*):**
   - Aktivasi hands-free dengan pemanggilan *"Hey Llamrei"* untuk mode suara.

---

## 3. Ekosistem Akademik, Skripsi FEB UKRIDA & BEM

1. **Tracker Progres Skripsi S1 (Dr. Fredella Colline):**
   - Pelacak progres per bab (Bab 1 s/d Bab 5 MRA Pokémon TCG), log bimbingan dosen, dan ekstraksi otomatis catatan revisi dari WhatsApp menjadi daftar subtugas ClickUp.
2. **Manajer Referensi & Sitasi Akademik:**
   - Impor cepat metadata jurnal via DOI / BibTeX dan ekspor format sitasi standar APA 7th Edition.
3. **Generator Notulen Rapat BEM FEB Otomatis:**
   - Meringkas transkrip rapat atau obrolan grup kepanitiaan, mengekstraksi kesimpulan, dan mengubah daftar tugas menjadi tugas ClickUp berstatus penanggung jawab.
4. **Jembatan Portal BEM FEB UKRIDA:**
   - Sinkronisasi program kerja (proker) dan jadwal evaluasi divisi langsung ke dalam hierarki Space BEM di Llamrei.
5. **Mode Pomodoro Terintegrasi Time Tracker:**
   - Timer fokus kerja mendalam per mata kuliah dengan pencatatan agregat jam belajar ke Life OS.

---

## 4. Manajemen Keuangan Pribadi & Pemisahan Modal

1. **Pencatat Pengeluaran Cepat (*Quick Expense Entry*):**
   - Pencatatan via widget Android atau pesan singkat ke Llamrei dengan batas anggaran bulanan.
2. **Pengingat Tagihan & Kewajiban Finansial:**
   - Notifikasi terjadwal untuk tagihan berulang, biaya kuliah, dan operasional.
3. **Pemisahan Tegas Akun Modal Trading:**
   - Isolasi saldo akun modal trading dari rekening biaya kuliah dan kebutuhan hidup sehari-hari untuk menjaga netralitas emosi.

---

## 5. Ketahanan Sistem & Infrastruktur Operasional

1. **Backup Otomatis Database SQLite Terenkripsi:**
   - Snapshot harian otomatis berkas `llamrei.db` terkompresi dan terenkripsi (AES-256) yang disinkronkan ke lokasi sekunder (perangkat cadangan via Syncthing / Tailscale) disertai skrip verifikasi pemulihan (*test restore script*).
2. **Opsi Host Always-On (Micro-Server / VPS Privat):**
   - Pengoperasian daemon background di mesin hemat daya (misal: Raspberry Pi atau node privat Tailscale) agar pengiriman pesan terjadwal dan sinkronisasi tetap bekerja saat laptop tidur di dalam tas.
3. **Dasbor Diagnostik & Status Kesehatan Sistem (*System Health Center*):**
   - Halaman pemantauan visual untuk status Background Scheduler, driver Baileys, jembatan NectarLink, memori RAM, dan ukuran berkas SQLite.
4. **Quick Capture dari Android via Share Sheet:**
   - Integrasi Android Share Target agar membagikan teks, tautan artikel, atau foto dokumen langsung masuk sebagai tugas di Llamrei.

---

## 6. Catatan Kritis & Mitigasi Risiko Nyata

1. **Mitigasi Pemblokiran WhatsApp (Protokol Baileys):**
   - WhatsApp melarang keras bot otomatisasi tanpa otorisasi resmi. Penggunaan Baileys pada nomor utama memiliki risiko pemblokiran nomor (*account ban*).
   - *Tindakan Mitigasi:*
     - Terapkan batas kecepatan kirim (*rate-limiting*) ketat dan jeda acak (*human-like delay*).
     - Prioritaskan mode baca/notifikasi (*read-only*), serta pisahkan nomor bot operasional dari nomor pribadi Arthur (`6285215001339`).
2. **Kebijakan Google Play Console:**
   - Penggunaan izin `USE_EXACT_ALARM`, `Notification Access`, dan fungsi pencerminan layar (*Screencast*) diperiksa secara ketat oleh tim peninjau Google Play.
   - *Tindakan Mitigasi:*
     - Siapkan dokumen justifikasi teknis dan video demonstrasi fungsionalitas inti.
     - Sediakan opsi instalasi langsung melalui berkas APK mandiri yang ditandatangani (*Direct Signed APK*) sebagai saluran distribusi sekunder tanpa bergantung pada Play Store.
3. **Peningkatan Cakupan Pengujian Otomatis (*Test Coverage*):**
   - 16 pengujian unit saat ini adalah fondasi awal. Wajib ditambahkan pengujian regresi untuk:
     - Logika rekursif tugas berulang pada tanggal batas bulan (misal: 29–31).
     - Siklus atomik *Approval Card* dan *1-Click Undo*.
     - Gerbang persetujuan kalender proposal acara (*Calendar Acceptance Gate*).

---

## 7. Urutan Prioritas Eksekusi

1. **Prioritas 1:** Backup otomatis SQLite terenkripsi + skrip pengujian pemulihan (*disaster recovery*).
2. **Prioritas 2:** *Pre-trade checklist gate* dan *Daily loss limit / cooldown circuit breaker*.
3. **Prioritas 3:** Dasbor metrik & laporan mingguan analitis trading (win rate, expectancy, kurva ekuitas).
4. **Prioritas 4:** Pelacak progres skripsi FEB UKRIDA (bab 1–5, bimbingan, revisi).
5. **Prioritas 5:** Memori jangka panjang lokal (RAG terenkripsi) untuk asisten Llamrei.
