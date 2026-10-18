# Catatan Keuangan Rumah Qyona (Google Apps Script)

Aplikasi Web & Bot Otomasi Pencatatan Keuangan Rumah Tangga berbasis **Google Apps Script (GAS)** yang dibangun sesuai dengan seluruh spesifikasi pada **PRD v1.0**.

---

## 📂 Struktur File Proyek (`qyona-finance-gas`)

1. [`appsscript.json`](file:///C:/Users/Administrator/.gemini/antigravity/scratch/qyona-finance-gas/appsscript.json) — Manifest Google Apps Script (`V8` Runtime, Timezone `Asia/Jakarta`, OAuth Scopes untuk Sheets, Drive, `UrlFetchApp`, dan `ScriptApp` Triggers).
2. [`Code.gs`](file:///C:/Users/Administrator/.gemini/antigravity/scratch/qyona-finance-gas/Code.gs) — Backend utama Google Apps Script:
   - Auto-inisialisasi & seeding database Google Sheets (6 Sheet utama PRD + 1 Sheet Pengajuan Dana Anak) dan folder Google Drive `Qyona_Struk_Belanja`.
   - Penerapan `LockService` pada setiap transaksi tulis/ubah/hapus untuk mencegah *race condition* ketika beberapa anggota keluarga mengirim chat bersamaan.
   - Mesin **AI Chatbot NLP Bahasa Indonesia** (terintegrasi dengan Gemini API + fallback parser cerdas) & **OCR Vision Struk Belanja**.
   - Webhook `doPost(e)` untuk **Telegram Bot API** dan **WhatsApp Cloud API / Fonnte** dengan verifikasi ketat **ID Chat & RBAC**.
   - **Time-driven Triggers** otomatis: Pengingat Tagihan H-3, Retensi penghapusan foto struk > 3 bulan di Drive, serta pengiriman **AI Insight Bulanan** setiap tanggal 1.
3. [`Index.html`](file:///C:/Users/Administrator/.gemini/antigravity/scratch/qyona-finance-gas/Index.html) — Antarmuka pengguna (Halaman Login Keluarga Privat hingga Main App 2-Panel Desktop & Bottom-Nav Mobile).
4. [`Stylesheet.html`](file:///C:/Users/Administrator/.gemini/antigravity/scratch/qyona-finance-gas/Stylesheet.html) — Sistem desain CSS dengan warna utama Hijau Emerald / Biru Teal, indikator warna kategori (Oranye = Dapur, Biru = Tagihan, Ungu = Anak, Merah = Overbudget), serta dukungan *Dark Mode*.
5. [`JavaScript.html`](file:///C:/Users/Administrator/.gemini/antigravity/scratch/qyona-finance-gas/JavaScript.html) — Controller interaktif sisi klien (`google.script.run` bridge, Chart.js Donut & Bar Comparison, Web Speech API mikrofon Bahasa Indonesia `id-ID`, kompresi gambar struk otomatis via HTML5 Canvas, serta Local Emulator).
6. [`Preview_Standalone.html`](file:///C:/Users/Administrator/.gemini/antigravity/scratch/qyona-finance-gas/Preview_Standalone.html) — File bundel mandiri yang dapat langsung Anda klik dua kali (buka di browser lokal) untuk mencoba seluruh alur dari **Halaman Login** hingga **Main App** secara instan.

---

## 🚀 Cara Deploy ke Google Apps Script

### Opsi A: Menggunakan Google Spreadsheet Baru / Editor GAS
1. Buka [Google Sheets](https://sheets.new) atau [script.google.com](https://script.google.com).
2. Klik **Extensions > Apps Script**.
3. Salin isi [`Code.gs`](file:///C:/Users/Administrator/.gemini/antigravity/scratch/qyona-finance-gas/Code.gs) ke file `Code.gs` di editor.
4. Buat 3 file HTML baru (**File > + > HTML**) dengan nama persis:
   - `Index` (salin isi [`Index.html`](file:///C:/Users/Administrator/.gemini/antigravity/scratch/qyona-finance-gas/Index.html))
   - `Stylesheet` (salin isi [`Stylesheet.html`](file:///C:/Users/Administrator/.gemini/antigravity/scratch/qyona-finance-gas/Stylesheet.html))
   - `JavaScript` (salin isi [`JavaScript.html`](file:///C:/Users/Administrator/.gemini/antigravity/scratch/qyona-finance-gas/JavaScript.html))
5. Klik **Deploy > New deployment > Web app**:
   - **Execute as**: *Me*
   - **Who has access**: *Anyone* (Keamanan keluarga tetap terjaga lewat layar Login PIN/ID Chat & verifikasi RBAC di backend).
6. Salin **Web App URL** hasil deployment. Saat pertama kali dibuka, fungsi `initDatabaseIfNeeded()` otomatis membuat seluruh struktur Sheet beserta data awal keluarga Qyona.

### Opsi B: Mengatur Kredensial Bot & AI (`PropertiesService`)
Masuk ke aplikasi sebagai **Admin (Ayah Budi / Bunda Qyona)** -> buka menu **Dompet & Keluarga** -> bagian paling bawah **Konfigurasi Bot Engine, AI Vision & Trigger Otomatis**:
- Masukkan `GEMINI_API_KEY`, `TELEGRAM_BOT_TOKEN`, dan `WA_API_TOKEN`.
- Klik **Simpan ke PropertiesService** dan klik **Aktifkan Trigger Harian & Bulanan**.
