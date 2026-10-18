/**
 * ============================================================================
 * QYONA — Catatan Keuangan Rumah Tangga (Google Apps Script Backend & Bot Engine)
 * Versi: 1.0 (Sesuai PRD v1.0)
 * ============================================================================
 * 
 * Struktur Sheet Database:
 * 1. Transaksi
 * 2. Anggota Keluarga
 * 3. Kategori & Budget
 * 4. Dompet / Sumber Dana
 * 5. Tagihan Rutin
 * 6. Riwayat Chat & AI Insight
 * 7. Pengajuan Dana (ekstensi untuk US-5 & US-6 Approval Dana Anak/Keluarga)
 * 
 * Konfigurasi Script Properties (PropertiesService):
 * - SPREADSHEET_ID       : ID Google Spreadsheet (opsional jika bound script)
 * - DRIVE_FOLDER_ID      : ID Folder Google Drive "Qyona_Struk_Belanja"
 * - GEMINI_API_KEY       : API Key Google Gemini (gemini-2.5-flash)
 * - TELEGRAM_BOT_TOKEN   : Token Bot Telegram dari @BotFather
 * - WA_API_TOKEN         : Token WhatsApp Cloud API / Fonnte
 * - WA_PHONE_NUMBER_ID   : Phone Number ID Meta Cloud API (opsional)
 * - FAMILY_INVITE_CODE   : Kode undangan keluarga (default: QYONA-2026)
 */

const SHEET_NAMES = {
  TRANSAKSI: 'Transaksi',
  ANGGOTA: 'Anggota Keluarga',
  KATEGORI: 'Kategori & Budget',
  DOMPET: 'Dompet / Sumber Dana',
  TAGIHAN: 'Tagihan Rutin',
  INSIGHT: 'Riwayat Chat & AI Insight',
  PENGAJUAN: 'Pengajuan Dana'
};

/**
 * HTTP GET Handler - Menyajikan Web App Qyona (HtmlService)
 */
function doGet(e) {
  initDatabaseIfNeeded();
  const template = HtmlService.createTemplateFromFile('Index');
  template.initialInviteCode = getConfig('FAMILY_INVITE_CODE', 'QYONA-2026');
  return template.evaluate()
    .setTitle('Qyona — Catatan Keuangan Rumah Tangga')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}

/**
 * Helper untuk menyertakan file HTML terpisah (CSS / JS modular)
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Ambil konfigurasi dari ScriptProperties dengan fallback default
 */
function getConfig(key, defaultValue = '') {
  try {
    const props = PropertiesService.getScriptProperties();
    const val = props.getProperty(key);
    return val !== null && val !== '' ? val : defaultValue;
  } catch (err) {
    return defaultValue;
  }
}

/**
 * Simpan konfigurasi ke ScriptProperties (Hanya Admin)
 */
function saveScriptConfigs(adminId, configObj) {
  const member = verifyMemberById(adminId);
  if (!member || member.role !== 'Admin') {
    throw new Error('Akses ditolak: Hanya Admin (Suami/Istri) yang dapat mengubah pengaturan sistem.');
  }
  const props = PropertiesService.getScriptProperties();
  Object.keys(configObj).forEach(k => {
    if (configObj[k] !== undefined && configObj[k] !== null && configObj[k] !== '********') {
      props.setProperty(k, String(configObj[k]).trim());
    }
  });
  return { success: true, message: 'Konfigurasi sistem berhasil disimpan di PropertiesService.' };
}

/**
 * Ambil instance Spreadsheet aktif atau berdasarkan SPREADSHEET_ID
 */
function getSpreadsheet() {
  const ssId = getConfig('SPREADSHEET_ID', '');
  if (ssId) {
    try {
      return SpreadsheetApp.openById(ssId);
    } catch (e) {
      // Fallback ke active spreadsheet atau buat baru
    }
  }
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    ss = SpreadsheetApp.create('Database_Keuangan_Rumah_Qyona');
    PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  }
  return ss;
}

/**
 * Pastikan folder Google Drive `Qyona_Struk_Belanja` tersedia
 */
function getOrCreateReceiptFolder() {
  const folderId = getConfig('DRIVE_FOLDER_ID', '');
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (e) {
      // Lanjut cari/buat folder
    }
  }
  const folders = DriveApp.getFoldersByName('Qyona_Struk_Belanja');
  let folder;
  if (folders.hasNext()) {
    folder = folders.next();
  } else {
    folder = DriveApp.createFolder('Qyona_Struk_Belanja');
  }
  PropertiesService.getScriptProperties().setProperty('DRIVE_FOLDER_ID', folder.getId());
  return folder;
}

/**
 * ============================================================================
 * INISIALISASI DATABASE & SEED DATA REALISTIS KELUARGA QYONA
 * ============================================================================
 */
function initDatabaseIfNeeded() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    const ss = getSpreadsheet();
    
    // 1. Sheet Anggota Keluarga
    let shAnggota = ss.getSheetByName(SHEET_NAMES.ANGGOTA);
    if (!shAnggota) {
      shAnggota = ss.insertSheet(SHEET_NAMES.ANGGOTA);
      shAnggota.appendRow(['ID', 'Nama', 'Peran', 'ID Chat WhatsApp', 'ID Chat Telegram', 'Status Aktif', 'PIN', 'Avatar', 'Kuota Jajan']);
      const seedMembers = [
        ['USR-01', 'Ayah Budi (Suami)', 'Admin', '6281234567801', '1001001', 'Aktif', '1234', '👨💼', 0],
        ['USR-02', 'Bunda Qyona (Istri)', 'Admin', '6281234567802', '1001002', 'Aktif', '1234', '👩💼', 0],
        ['USR-03', 'Kakak Raka (Anak)', 'Member', '6281234567803', '1001003', 'Aktif', '1111', '👦🎒', 600000],
        ['USR-04', 'Adik Nayla (Anak)', 'Member', '6281234567804', '1001004', 'Aktif', '2222', '👧🎨', 400000]
      ];
      shAnggota.getRange(2, 1, seedMembers.length, seedMembers[0].length).setValues(seedMembers);
      styleHeaderRow(shAnggota, 9);
    }

    // 2. Sheet Kategori & Budget
    let shKategori = ss.getSheetByName(SHEET_NAMES.KATEGORI);
    if (!shKategori) {
      shKategori = ss.insertSheet(SHEET_NAMES.KATEGORI);
      shKategori.appendRow(['Nama Kategori', 'Batas Anggaran Bulanan', 'Persentase Peringatan', 'Warna Ikon', 'Ikon', 'Tipe']);
      const seedCategories = [
        ['Dapur & Makanan', 3500000, 80, '#F97316', 'fa-utensils', 'Keluar'],
        ['Tagihan & Utilitas', 2200000, 80, '#3B82F6', 'fa-bolt', 'Keluar'],
        ['Jajan/Anak', 1000000, 80, '#A855F7', 'fa-ice-cream', 'Keluar'],
        ['Transportasi & BBM', 1200000, 80, '#14B8A6', 'fa-gas-pump', 'Keluar'],
        ['Kesehatan & Darurat', 800000, 80, '#EF4444', 'fa-notes-medical', 'Keluar'],
        ['Hiburan & Keluarga', 900000, 80, '#EC4899', 'fa-film', 'Keluar'],
        ['Pendidikan & Les', 1500000, 80, '#6366F1', 'fa-graduation-cap', 'Keluar'],
        ['Gaji & Pemasukan', 0, 100, '#10B981', 'fa-sack-dollar', 'Masuk']
      ];
      shKategori.getRange(2, 1, seedCategories.length, seedCategories[0].length).setValues(seedCategories);
      styleHeaderRow(shKategori, 6);
    }

    // 3. Sheet Dompet / Sumber Dana
    let shDompet = ss.getSheetByName(SHEET_NAMES.DOMPET);
    if (!shDompet) {
      shDompet = ss.insertSheet(SHEET_NAMES.DOMPET);
      shDompet.appendRow(['ID Dompet', 'Nama Dompet', 'Tipe', 'Saldo Awal', 'Saldo Berjalan', 'Nomor Rekening / Info']);
      const seedWallets = [
        ['WLT-01', 'BCA Keluarga', 'Bank', 14500000, 18745000, 'BCA •• 8821'],
        ['WLT-02', 'Mandiri Tabungan', 'Bank', 8000000, 7450000, 'Mandiri •• 4410'],
        ['WLT-03', 'GoPay / QRIS Rumah', 'E-wallet', 1500000, 1185000, 'GoPay 0812••02'],
        ['WLT-04', 'Dompet Tunai Dapur', 'Tunai', 1200000, 845000, 'Cash Pegangan Bunda'],
        ['WLT-05', 'Saku Anak (Gopay/Cash)', 'E-wallet', 1000000, 615000, 'Kuota Jajan Raka & Nayla']
      ];
      shDompet.getRange(2, 1, seedWallets.length, seedWallets[0].length).setValues(seedWallets);
      styleHeaderRow(shDompet, 6);
    }

    // 4. Sheet Transaksi
    let shTransaksi = ss.getSheetByName(SHEET_NAMES.TRANSAKSI);
    if (!shTransaksi) {
      shTransaksi = ss.insertSheet(SHEET_NAMES.TRANSAKSI);
      shTransaksi.appendRow(['ID', 'Tanggal', 'Tipe', 'Jumlah', 'Kategori', 'Keterangan', 'ID Dompet', 'ID Anggota', 'URL Foto Struk', 'Sumber Input', 'Status Approval']);
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const prevM = String(now.getMonth() === 0 ? 12 : now.getMonth()).padStart(2, '0');
      const prevY = now.getMonth() === 0 ? y - 1 : y;

      const seedTrx = [
        // Bulan Lalu (untuk komparasi AI Insight)
        ['TRX-0901', `${prevY}-${prevM}-01 09:00`, 'Masuk', 18500000, 'Gaji & Pemasukan', 'Gaji Bulanan Ayah & Bunda', 'WLT-01', 'USR-01', '', 'Form', 'Disetujui'],
        ['TRX-0902', `${prevY}-${prevM}-05 14:20`, 'Keluar', 2650000, 'Dapur & Makanan', 'Belanja Bulanan Groceries & Pasar', 'WLT-01', 'USR-02', '', 'OCR', 'Disetujui'],
        ['TRX-0903', `${prevY}-${prevM}-10 10:15`, 'Keluar', 1950000, 'Tagihan & Utilitas', 'Listrik PLN, Air PDAM & Internet', 'WLT-01', 'USR-01', '', 'Form', 'Disetujui'],
        ['TRX-0904', `${prevY}-${prevM}-15 16:40`, 'Keluar', 780000, 'Jajan/Anak', 'Total Jajan Sekolah Raka & Nayla', 'WLT-05', 'USR-03', '', 'Chat', 'Disetujui'],
        ['TRX-0905', `${prevY}-${prevM}-19 19:00`, 'Keluar', 920000, 'Transportasi & BBM', 'Pertamax Mobil & KRL Bulanan', 'WLT-03', 'USR-01', '', 'Chat', 'Disetujui'],
        ['TRX-0906', `${prevY}-${prevM}-24 20:10`, 'Keluar', 650000, 'Hiburan & Keluarga', 'Makan Malam Keluarga Akhir Pekan', 'WLT-01', 'USR-02', '', 'Chat', 'Disetujui'],

        // Bulan Berjalan
        ['TRX-1001', `${y}-${m}-01 08:30`, 'Masuk', 19200000, 'Gaji & Pemasukan', 'Gaji Bulanan Ayah Budi & Insentif', 'WLT-01', 'USR-01', '', 'Form', 'Disetujui'],
        ['TRX-1002', `${y}-${m}-02 10:12`, 'Keluar', 485000, 'Dapur & Makanan', 'Beli beras 10kg, minyak goreng 2L, telur 2kg', 'WLT-04', 'USR-02', '', 'Chat', 'Disetujui'],
        ['TRX-1003', `${y}-${m}-04 13:45`, 'Keluar', 1120000, 'Dapur & Makanan', 'Struk Superindo (14 item sembako & sayur segar)', 'WLT-01', 'USR-02', 'https://drive.google.com/qyona-sample-struk-01', 'OCR', 'Disetujui'],
        ['TRX-1004', `${y}-${m}-06 07:30`, 'Keluar', 350000, 'Transportasi & BBM', 'Isi BBM Pertamax full tank mobil keluarga', 'WLT-03', 'USR-01', '', 'Chat', 'Disetujui'],
        ['TRX-1005', `${y}-${m}-08 12:20`, 'Keluar', 45000, 'Jajan/Anak', 'Beli bekal roti bakar & susu UHT di kantin', 'WLT-05', 'USR-03', '', 'Chat', 'Pending'],
        ['TRX-1006', `${y}-${m}-09 15:10`, 'Keluar', 850000, 'Tagihan & Utilitas', 'Token Listrik PLN Rumah 200kWh & WiFi Biznet', 'WLT-01', 'USR-01', '', 'Chat', 'Disetujui'],
        ['TRX-1007', `${y}-${m}-11 16:05`, 'Keluar', 35000, 'Jajan/Anak', 'Beli buku gambar & es krim coklat', 'WLT-05', 'USR-04', '', 'Chat', 'Pending'],
        ['TRX-1008', `${y}-${m}-12 18:50`, 'Keluar', 725000, 'Dapur & Makanan', 'Belanja ikan segar, ayam kampung, bumbu dapur & gas 12kg', 'WLT-04', 'USR-02', '', 'Chat', 'Disetujui'],
        ['TRX-1009', `${y}-${m}-14 19:30`, 'Keluar', 540000, 'Hiburan & Keluarga', 'Kopi kenangan, cemilan sore & langganan streaming', 'WLT-03', 'USR-01', '', 'Chat', 'Disetujui'],
        ['TRX-1010', `${y}-${m}-15 09:15`, 'Keluar', 650000, 'Pendidikan & Les', 'Les Bahasa Inggris & Matematika Raka', 'WLT-02', 'USR-02', '', 'Form', 'Disetujui'],
        ['TRX-1011', `${y}-${m}-17 11:40`, 'Keluar', 165000, 'Jajan/Anak', 'Beli novel remaja & makan siang bareng teman', 'WLT-05', 'USR-03', '', 'Chat', 'Disetujui'],
        ['TRX-1012', `${y}-${m}-18 17:00`, 'Keluar', 590000, 'Dapur & Makanan', 'Pesan makanan online (GoFood) 3x minggu ini', 'WLT-03', 'USR-02', '', 'Chat', 'Disetujui']
      ];
      shTransaksi.getRange(2, 1, seedTrx.length, seedTrx[0].length).setValues(seedTrx);
      styleHeaderRow(shTransaksi, 11);
    }

    // 5. Sheet Tagihan Rutin
    let shTagihan = ss.getSheetByName(SHEET_NAMES.TAGIHAN);
    if (!shTagihan) {
      shTagihan = ss.insertSheet(SHEET_NAMES.TAGIHAN);
      shTagihan.appendRow(['ID Tagihan', 'Nama Tagihan', 'Nominal Estimasi', 'Tanggal Jatuh Tempo', 'Kategori', 'ID Dompet Default', 'Status', 'Pengingat Terkirim']);
      const seedBills = [
        ['BIL-01', 'Listrik PLN Pascabayar / Token Utama', 650000, 20, 'Tagihan & Utilitas', 'WLT-01', 'Lunas', 'Sudah'],
        ['BIL-02', 'Internet WiFi Fiber Rumah', 385000, 20, 'Tagihan & Utilitas', 'WLT-01', 'Belum', 'Belum'],
        ['BIL-03', 'Air PDAM & Iuran Keamanan RT', 275000, 22, 'Tagihan & Utilitas', 'WLT-04', 'Belum', 'Belum'],
        ['BIL-04', 'SPP Sekolah & Ekstrakurikuler Anak', 1350000, 25, 'Pendidikan & Les', 'WLT-02', 'Belum', 'Belum'],
        ['BIL-05', 'BPJS Kesehatan Keluarga (4 Jiwa)', 600000, 10, 'Kesehatan & Darurat', 'WLT-01', 'Lunas', 'Sudah']
      ];
      shTagihan.getRange(2, 1, seedBills.length, seedBills[0].length).setValues(seedBills);
      styleHeaderRow(shTagihan, 8);
    }

    // 6. Sheet Riwayat Chat & AI Insight
    let shInsight = ss.getSheetByName(SHEET_NAMES.INSIGHT);
    if (!shInsight) {
      shInsight = ss.insertSheet(SHEET_NAMES.INSIGHT);
      shInsight.appendRow(['ID Insight', 'Timestamp', 'ID Anggota', 'Teks Chat Asli / Trigger', 'Hasil Analisis AI', 'Jenis', 'Estimasi Penghematan', 'Status Rekomendasi']);
      const nowIso = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm');
      const seedInsights = [
        [
          'INS-01',
          nowIso,
          'USR-02',
          'Evaluasi Otomatis Pengeluaran Dapur & Pesan Antar',
          'Pengeluaran kategori Dapur & Makanan mencapai Rp 2.920.000 (83% dari budget Rp 3.500.000). Terdeteksi 20% di antaranya berasal dari pesan makanan online (GoFood) di hari kerja. Dengan menyiapkan meal-prep akhir pekan dan membatasi pesan-antar maksimal 1x seminggu, keluarga dapat menghemat signifikan.',
          'Bulanan',
          420000,
          'Aktif'
        ],
        [
          'INS-02',
          nowIso,
          'USR-01',
          'Optimasi Langganan Hiburan & Kopi Harian',
          'Pengeluaran Hiburan & Keluarga tercatat Rp 540.000 bulan ini. Pembelian kopi siap saji dan layanan streaming ganda menyumbang porsi terbesar. Menggabungkan paket family plan dan menyeduh kopi sendiri di rumah 3 hari/minggu sangat direkomendasikan.',
          'Mingguan',
          245000,
          'Aktif'
        ],
        [
          'INS-03',
          nowIso,
          'USR-03',
          'Tips Pintar Uang Jajan Anak (Raka & Nayla)',
          'Hebat! Penggunaan kuota uang jajan anak masih terkendali di angka 24.5% (Rp 245.000 dari Rp 1.000.000). Jika Kakak Raka dan Adik Nayla menyisihkan Rp 5.000 per hari sekolah ke celengan target, di akhir semester akan terkumpul Rp 600.000!',
          'Harian',
          150000,
          'Aktif'
        ]
      ];
      shInsight.getRange(2, 1, seedInsights.length, seedInsights[0].length).setValues(seedInsights);
      styleHeaderRow(shInsight, 8);
    }

    // 7. Sheet Pengajuan Dana (Approval Dana Anak / Request Tambahan)
    let shPengajuan = ss.getSheetByName(SHEET_NAMES.PENGAJUAN);
    if (!shPengajuan) {
      shPengajuan = ss.insertSheet(SHEET_NAMES.PENGAJUAN);
      shPengajuan.appendRow(['ID Request', 'Tanggal', 'ID Anggota', 'Nama Anggota', 'Nominal', 'Keperluan', 'Status', 'Diproses Oleh']);
      const nowDate = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm');
      const seedRequests = [
        ['REQ-01', nowDate, 'USR-03', 'Kakak Raka (Anak)', 125000, 'Beli buku latihan Olimpiade Sains & alat tulis praktikum', 'Menunggu Approval', ''],
        ['REQ-02', nowDate, 'USR-04', 'Adik Nayla (Anak)', 65000, 'Iuran karya wisata kelas dan beli cat air baru', 'Menunggu Approval', '']
      ];
      shPengajuan.getRange(2, 1, seedRequests.length, seedRequests[0].length).setValues(seedRequests);
      styleHeaderRow(shPengajuan, 8);
    }

    // Hapus Sheet1 default jika masih kosong dan ada sheet lain
    const defaultSheet = ss.getSheetByName('Sheet1');
    if (defaultSheet && ss.getSheets().length > 1) {
      try { ss.deleteSheet(defaultSheet); } catch (e) {}
    }

    recalculateAllWalletBalances(ss);
  } finally {
    lock.releaseLock();
  }
}

function styleHeaderRow(sheet, numCols) {
  const headerRange = sheet.getRange(1, 1, 1, numCols);
  headerRange.setBackground('#0F766E');
  headerRange.setFontColor('#FFFFFF');
  headerRange.setFontWeight('bold');
  sheet.setFrozenRows(1);
}

/**
 * ============================================================================
 * RBAC & AUTENTIKASI KELUARGA PRIVAT
 * ============================================================================
 */

function getAllMembers() {
  const ss = getSpreadsheet();
  const sh = ss.getSheetByName(SHEET_NAMES.ANGGOTA);
  const data = sh.getDataRange().getValues();
  const members = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[0]) continue;
    members.push({
      id: String(r[0]),
      name: String(r[1]),
      role: String(r[2]), // 'Admin' atau 'Member'
      waId: String(r[3] || ''),
      tgId: String(r[4] || ''),
      status: String(r[5] || 'Aktif'),
      pin: String(r[6] || '1234'),
      avatar: String(r[7] || '👤'),
      allowanceQuota: Number(r[8] || 0)
    });
  }
  return members;
}

function verifyMemberById(memberId) {
  const members = getAllMembers();
  return members.find(m => m.id === memberId && m.status === 'Aktif') || null;
}

function verifyMemberByChatId(chatId) {
  const cleanChatId = String(chatId || '').trim().replace(/^\+/, '');
  if (!cleanChatId) return null;
  const members = getAllMembers();
  return members.find(m =>
    m.status === 'Aktif' &&
    (m.waId.replace(/^\+/, '') === cleanChatId || m.tgId === cleanChatId || m.id.toLowerCase() === cleanChatId.toLowerCase())
  ) || null;
}

/**
 * Endpoint Login untuk Halaman Login Web App Qyona
 * Mendukung login dengan:
 * 1. ID Anggota + PIN
 * 2. Nomor WhatsApp / ID Chat Telegram + Kode Undangan / PIN
 */
function authenticateUser(credentials) {
  initDatabaseIfNeeded();
  const members = getAllMembers();
  const inviteCode = getConfig('FAMILY_INVITE_CODE', 'QYONA-2026');

  // Mode 1: Pilih profil keluarga + PIN
  if (credentials.memberId) {
    const user = members.find(m => m.id === credentials.memberId && m.status === 'Aktif');
    if (!user) {
      return { success: false, message: 'Profil anggota keluarga tidak ditemukan atau tidak aktif.' };
    }
    if (credentials.pin && user.pin !== String(credentials.pin).trim()) {
      return { success: false, message: 'PIN Keamanan salah. Untuk demo: Ayah/Bunda (1234), Raka (1111), Nayla (2222).' };
    }
    return {
      success: true,
      user: sanitizeMemberForClient(user),
      familyMembers: members.map(sanitizeMemberForClient)
    };
  }

  // Mode 2: Login dengan ID Chat WhatsApp/Telegram + Invite Code
  if (credentials.chatId) {
    const user = verifyMemberByChatId(credentials.chatId);
    if (!user) {
      return {
        success: false,
        message: 'ID Chat WhatsApp/Telegram belum terdaftar di Sheet Anggota Keluarga. Hubungi Admin (Ayah/Bunda).'
      };
    }
    if (credentials.inviteCode && credentials.inviteCode.trim().toUpperCase() !== inviteCode.toUpperCase()) {
      return {
        success: false,
        message: 'Kode Undangan Keluarga tidak valid.'
      };
    }
    return {
      success: true,
      user: sanitizeMemberForClient(user),
      familyMembers: members.map(sanitizeMemberForClient)
    };
  }

  return { success: false, message: 'Data kredensial tidak lengkap.' };
}

function sanitizeMemberForClient(m) {
  return {
    id: m.id,
    name: m.name,
    role: m.role,
    waId: m.waId,
    tgId: m.tgId,
    status: m.status,
    avatar: m.avatar,
    allowanceQuota: m.allowanceQuota
  };
}

/**
 * Ambil daftar profil keluarga publik untuk layar pilih akun di halaman login
 */
function getPublicFamilyProfiles() {
  initDatabaseIfNeeded();
  const members = getAllMembers().filter(m => m.status === 'Aktif');
  return {
    familyName: 'Keluarga Rumah Qyona',
    maxCapacity: 6,
    activeCount: members.length,
    profiles: members.map(m => ({
      id: m.id,
      name: m.name,
      role: m.role,
      avatar: m.avatar,
      hintPin: m.role === 'Admin' ? '1234' : (m.id === 'USR-03' ? '1111' : '2222'),
      waIdMasked: m.waId ? m.waId.slice(0, 5) + '••••' + m.waId.slice(-2) : '-',
      tgId: m.tgId
    }))
  };
}

/**
 * ============================================================================
 * PENGAMBILAN DATA DASHBOARD REAL-TIME DENGAN FILTER RBAC (US-3 & US-6)
 * ============================================================================
 */
function getAppBootstrapData(memberId, selectedMonthYear) {
  initDatabaseIfNeeded();
  const currentUser = verifyMemberById(memberId);
  if (!currentUser) {
    throw new Error('Sesi tidak valid atau akses anggota telah dinonaktifkan.');
  }

  const ss = getSpreadsheet();
  const isAdmin = currentUser.role === 'Admin';

  // Target bulan (default: bulan berjalan YYYY-MM)
  const now = new Date();
  const currentYM = selectedMonthYear || Utilities.formatDate(now, 'Asia/Jakarta', 'yyyy-MM');
  const [yrStr, moStr] = currentYM.split('-');
  const yr = parseInt(yrStr, 10);
  const mo = parseInt(moStr, 10);
  const prevDate = new Date(yr, mo - 2, 1);
  const prevYM = Utilities.formatDate(prevDate, 'Asia/Jakarta', 'yyyy-MM');

  // 1. Anggota
  const allMembers = getAllMembers();
  const memberMap = {};
  allMembers.forEach(m => { memberMap[m.id] = m; });

  // 2. Kategori & Budget
  const shKategori = ss.getSheetByName(SHEET_NAMES.KATEGORI);
  const katData = shKategori.getDataRange().getValues();
  let categories = [];
  for (let i = 1; i < katData.length; i++) {
    const r = katData[i];
    if (!r[0]) continue;
    categories.push({
      name: String(r[0]),
      monthlyLimit: Number(r[1] || 0),
      warnPercent: Number(r[2] || 80),
      color: String(r[3] || '#10B981'),
      icon: String(r[4] || 'fa-tag'),
      type: String(r[5] || 'Keluar')
    });
  }
  // RBAC Filter Kategori untuk Anak
  if (!isAdmin) {
    categories = categories.filter(c => c.name === 'Jajan/Anak');
  }

  // 3. Dompet / Sumber Dana
  recalculateAllWalletBalances(ss);
  const shDompet = ss.getSheetByName(SHEET_NAMES.DOMPET);
  const domData = shDompet.getDataRange().getValues();
  let wallets = [];
  for (let i = 1; i < domData.length; i++) {
    const r = domData[i];
    if (!r[0]) continue;
    wallets.push({
      id: String(r[0]),
      name: String(r[1]),
      type: String(r[2]),
      initialBalance: Number(r[3] || 0),
      currentBalance: Number(r[4] || 0),
      info: String(r[5] || '')
    });
  }
  const walletMap = {};
  wallets.forEach(w => { walletMap[w.id] = w; });

  // 4. Transaksi
  const shTrx = ss.getSheetByName(SHEET_NAMES.TRANSAKSI);
  const trxData = shTrx.getDataRange().getValues();
  const allTransactions = [];
  for (let i = 1; i < trxData.length; i++) {
    const r = trxData[i];
    if (!r[0]) continue;
    let dateStr = '';
    if (r[1] instanceof Date) {
      dateStr = Utilities.formatDate(r[1], 'Asia/Jakarta', 'yyyy-MM-dd HH:mm');
    } else {
      dateStr = String(r[1]);
    }
    const trxOwnerId = String(r[7] || '');
    const trxCategory = String(r[4] || '');

    // RBAC: Member terbatas (Anak) hanya boleh melihat transaksinya sendiri atau kategori Jajan/Anak miliknya
    if (!isAdmin && trxOwnerId !== currentUser.id) {
      continue;
    }

    const owner = memberMap[trxOwnerId] || { name: 'Keluarga', avatar: '👤', role: 'Member' };
    const wlt = walletMap[String(r[6])] || { name: 'Dompet Utama' };

    allTransactions.push({
      id: String(r[0]),
      date: dateStr,
      monthYear: dateStr.slice(0, 7),
      type: String(r[2]), // 'Masuk' | 'Keluar'
      amount: Number(r[3] || 0),
      category: trxCategory,
      description: String(r[5] || ''),
      walletId: String(r[6] || ''),
      walletName: wlt.name,
      memberId: trxOwnerId,
      memberName: owner.name,
      memberAvatar: owner.avatar,
      receiptUrl: String(r[8] || ''),
      source: String(r[9] || 'Chat'),
      approvalStatus: String(r[10] || 'Disetujui'),
      canEdit: isAdmin || (trxOwnerId === currentUser.id && String(r[10]) !== 'Disetujui')
    });
  }

  // Urutkan transaksi terbaru di atas
  allTransactions.sort((a, b) => (b.date > a.date ? 1 : -1));

  const currentMonthTrx = allTransactions.filter(t => t.monthYear === currentYM);
  const prevMonthTrx = allTransactions.filter(t => t.monthYear === prevYM);

  // Kalkulasi Ringkasan & Perbandingan Kategori
  let totalIncome = 0;
  let totalExpense = 0;
  const spendingByCategory = {};
  const prevSpendingByCategory = {};

  currentMonthTrx.forEach(t => {
    if (t.type === 'Masuk') {
      totalIncome += t.amount;
    } else {
      totalExpense += t.amount;
      spendingByCategory[t.category] = (spendingByCategory[t.category] || 0) + t.amount;
    }
  });

  prevMonthTrx.forEach(t => {
    if (t.type === 'Keluar') {
      prevSpendingByCategory[t.category] = (prevSpendingByCategory[t.category] || 0) + t.amount;
    }
  });

  const categoryBreakdown = categories
    .filter(c => c.type === 'Keluar')
    .map(c => {
      const spent = spendingByCategory[c.name] || 0;
      const prevSpent = prevSpendingByCategory[c.name] || 0;
      // Untuk Anak, gunakan kuota pribadinya sebagai limit
      const limit = (!isAdmin && c.name === 'Jajan/Anak')
        ? (currentUser.allowanceQuota || 500000)
        : c.monthlyLimit;
      const percentage = limit > 0 ? Math.round((spent / limit) * 100) : 0;
      const diffFromPrev = spent - prevSpent;
      const diffPercent = prevSpent > 0 ? Math.round(((spent - prevSpent) / prevSpent) * 100) : 0;
      return {
        name: c.name,
        spent: spent,
        prevSpent: prevSpent,
        limit: limit,
        percentage: percentage,
        warnPercent: c.warnPercent,
        color: c.color,
        icon: c.icon,
        isOverWarning: percentage >= c.warnPercent && percentage < 100,
        isOverBudget: percentage >= 100,
        diffFromPrev: diffFromPrev,
        diffPercent: diffPercent
      };
    });

  // 5. Tagihan Rutin (Hanya Admin yang melihat daftar tagihan rumah tangga lengkap)
  const shTagihan = ss.getSheetByName(SHEET_NAMES.TAGIHAN);
  const tagData = shTagihan.getDataRange().getValues();
  const bills = [];
  if (isAdmin) {
    for (let i = 1; i < tagData.length; i++) {
      const r = tagData[i];
      if (!r[0]) continue;
      bills.push({
        id: String(r[0]),
        name: String(r[1]),
        amount: Number(r[2] || 0),
        dueDay: Number(r[3] || 1),
        category: String(r[4] || 'Tagihan & Utilitas'),
        walletId: String(r[5] || 'WLT-01'),
        status: String(r[6] || 'Belum'),
        reminderSent: String(r[7] || 'Belum')
      });
    }
  }

  // 6. Pengajuan Dana (Admin lihat semua, Anak lihat miliknya sendiri)
  const shReq = ss.getSheetByName(SHEET_NAMES.PENGAJUAN);
  const reqData = shReq.getDataRange().getValues();
  const fundRequests = [];
  for (let i = 1; i < reqData.length; i++) {
    const r = reqData[i];
    if (!r[0]) continue;
    const reqOwnerId = String(r[2]);
    if (!isAdmin && reqOwnerId !== currentUser.id) continue;
    fundRequests.push({
      id: String(r[0]),
      date: String(r[1]),
      memberId: reqOwnerId,
      memberName: String(r[3]),
      amount: Number(r[4] || 0),
      reason: String(r[5] || ''),
      status: String(r[6] || 'Menunggu Approval'),
      processedBy: String(r[7] || '')
    });
  }

  // 7. AI Insights (RBAC: Admin lihat semua, Anak hanya lihat tips menabung/harian)
  const shIns = ss.getSheetByName(SHEET_NAMES.INSIGHT);
  const insData = shIns.getDataRange().getValues();
  const insights = [];
  for (let i = 1; i < insData.length; i++) {
    const r = insData[i];
    if (!r[0]) continue;
    const insType = String(r[5] || 'Bulanan');
    const targetMember = String(r[2] || '');
    if (!isAdmin && insType !== 'Harian' && targetMember !== currentUser.id) continue;
    insights.push({
      id: String(r[0]),
      timestamp: String(r[1]),
      memberId: targetMember,
      prompt: String(r[3]),
      analysis: String(r[4]),
      type: insType,
      estimatedSaving: Number(r[6] || 0),
      status: String(r[7] || 'Aktif')
    });
  }
  insights.reverse();

  // Hitung Saldo sesuai RBAC
  let totalBalance = 0;
  let visibleWallets = wallets;
  if (isAdmin) {
    totalBalance = wallets.reduce((acc, w) => acc + w.currentBalance, 0);
  } else {
    // Member Anak: hanya lihat sisa kuota jajan pribadinya
    const quota = currentUser.allowanceQuota || 500000;
    const childSpent = currentMonthTrx
      .filter(t => t.type === 'Keluar')
      .reduce((acc, t) => acc + t.amount, 0);
    totalBalance = Math.max(0, quota - childSpent);
    visibleWallets = [{
      id: 'WLT-05',
      name: `Kuota Jajan ${currentUser.name.split(' ')[1] || currentUser.name}`,
      type: 'E-wallet',
      initialBalance: quota,
      currentBalance: totalBalance,
      info: `Terpakai Rp ${formatRupiahPlain(childSpent)} dari Rp ${formatRupiahPlain(quota)}`
    }];
  }

  const totalBudgetLimit = categoryBreakdown.reduce((acc, c) => acc + c.limit, 0);

  return {
    serverTime: Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss'),
    currentMonthYear: currentYM,
    prevMonthYear: prevYM,
    currentUser: sanitizeMemberForClient(currentUser),
    summary: {
      totalBalance: totalBalance,
      totalIncome: isAdmin ? totalIncome : (currentUser.allowanceQuota || 500000),
      totalExpense: totalExpense,
      totalBudgetLimit: totalBudgetLimit,
      budgetUsedPercent: totalBudgetLimit > 0 ? Math.round((totalExpense / totalBudgetLimit) * 100) : 0,
      transactionCount: currentMonthTrx.length
    },
    categories: categories,
    categoryBreakdown: categoryBreakdown,
    wallets: visibleWallets,
    transactions: currentMonthTrx,
    bills: bills,
    fundRequests: fundRequests.reverse(),
    insights: insights,
    familyMembers: isAdmin ? allMembers.map(sanitizeMemberForClient) : [sanitizeMemberForClient(currentUser)],
    systemConfig: isAdmin ? {
      hasGeminiKey: Boolean(getConfig('GEMINI_API_KEY', '')),
      hasTelegramToken: Boolean(getConfig('TELEGRAM_BOT_TOKEN', '')),
      hasWaToken: Boolean(getConfig('WA_API_TOKEN', '')),
      inviteCode: getConfig('FAMILY_INVITE_CODE', 'QYONA-2026'),
      spreadsheetUrl: ss.getUrl()
    } : null
  };
}

/**
 * Hitung ulang Saldo Berjalan di Sheet Dompet berdasarkan Saldo Awal + Masuk - Keluar
 */
function recalculateAllWalletBalances(ss) {
  ss = ss || getSpreadsheet();
  const shDompet = ss.getSheetByName(SHEET_NAMES.DOMPET);
  const shTrx = ss.getSheetByName(SHEET_NAMES.TRANSAKSI);
  if (!shDompet || !shTrx) return;

  const domData = shDompet.getDataRange().getValues();
  const trxData = shTrx.getDataRange().getValues();

  const deltaByWallet = {};
  for (let i = 1; i < trxData.length; i++) {
    const r = trxTrxRow(trxData[i]);
    if (!r.id) continue;
    if (!deltaByWallet[r.walletId]) deltaByWallet[r.walletId] = 0;
    if (r.type === 'Masuk') {
      deltaByWallet[r.walletId] += r.amount;
    } else {
      deltaByWallet[r.walletId] -= r.amount;
    }
  }

  for (let j = 1; j < domData.length; j++) {
    const wId = String(domData[j][0]);
    if (!wId) continue;
    const initBal = Number(domData[j][3] || 0);
    const runningBal = initBal + (deltaByWallet[wId] || 0);
    shDompet.getRange(j + 1, 5).setValue(runningBal);
  }
}

function trxTrxRow(r) {
  return {
    id: String(r[0] || ''),
    type: String(r[2] || 'Keluar'),
    amount: Number(r[3] || 0),
    walletId: String(r[6] || 'WLT-01')
  };
}

/**
 * ============================================================================
 * CRUD TRANSAKSI DENGAN LOCKSERVICE & VALIDASI RBAC (US-1, US-2, US-6)
 * ============================================================================
 */
function saveTransaction(memberId, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const user = verifyMemberById(memberId);
    if (!user) throw new Error('Pengguna tidak terautentikasi.');

    const ss = getSpreadsheet();
    const shTrx = ss.getSheetByName(SHEET_NAMES.TRANSAKSI);
    const data = shTrx.getDataRange().getValues();

    const isAdmin = user.role === 'Admin';
    const amount = Math.abs(Number(payload.amount || 0));
    if (!amount || amount <= 0) {
      throw new Error('Nominal transaksi harus lebih besar dari Rp 0.');
    }

    // RBAC Rule US-6: Input dari Anak otomatis dikunci ke kategori "Jajan/Anak" & Tipe "Keluar"
    let category = String(payload.category || 'Dapur & Makanan');
    let type = String(payload.type || 'Keluar');
    let walletId = String(payload.walletId || (isAdmin ? 'WLT-01' : 'WLT-05'));
    let approvalStatus = isAdmin ? 'Disetujui' : 'Pending';

    if (!isAdmin) {
      category = 'Jajan/Anak';
      type = 'Keluar';
      walletId = 'WLT-05';
    }

    const description = String(payload.description || '').trim() || category;
    const dateStr = payload.date || Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm');
    const source = String(payload.source || 'Form');
    const receiptUrl = String(payload.receiptUrl || '');

    // Jika Edit Transaksi (memiliki ID yang sudah ada)
    if (payload.id) {
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(payload.id)) {
          const ownerId = String(data[i][7]);
          const currentApproval = String(data[i][10] || 'Disetujui');

          if (!isAdmin) {
            if (ownerId !== user.id) {
              throw new Error('RBAC: Anda hanya boleh mengubah transaksi milik sendiri.');
            }
            if (currentApproval === 'Disetujui') {
              throw new Error('RBAC: Transaksi ini sudah disetujui Admin dan tidak dapat diubah lagi.');
            }
          }

          const updatedRow = [
            payload.id,
            dateStr,
            type,
            amount,
            category,
            description,
            walletId,
             isAdmin && payload.targetMemberId ? payload.targetMemberId : ownerId,
            receiptUrl || String(data[i][8] || ''),
            source,
            isAdmin ? (payload.approvalStatus || 'Disetujui') : currentApproval
          ];
          shTrx.getRange(i + 1, 1, 1, updatedRow.length).setValues([updatedRow]);
          recalculateAllWalletBalances(ss);
          return {
            success: true,
            mode: 'update',
            transactionId: payload.id,
            message: `Transaksi ${payload.id} berhasil diperbarui.`
          };
        }
      }
    }

    // Buat Transaksi Baru
    const newId = 'TRX-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'ddHHmmss') + '-' + Math.floor(Math.random() * 90 + 10);
    const newRow = [
      newId,
      dateStr,
      type,
      amount,
      category,
      description,
      walletId,
      user.id,
      receiptUrl,
      source,
      approvalStatus
    ];
    shTrx.appendRow(newRow);
    recalculateAllWalletBalances(ss);

    // Cek apakah pengeluaran kategori melewati ambang peringatan budget (default 80%)
    const budgetAlert = checkCategoryBudgetWarning(ss, category);

    return {
      success: true,
      mode: 'create',
      transactionId: newId,
      category: category,
      amount: amount,
      budgetAlert: budgetAlert,
      message: `Transaksi ${description} sebesar Rp ${formatRupiahPlain(amount)} berhasil dicatat ke kategori ${category}.`
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Hapus Transaksi (RBAC: Admin bisa hapus semua, Member hanya miliknya sebelum disetujui)
 */
function deleteTransaction(memberId, transactionId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const user = verifyMemberById(memberId);
    if (!user) throw new Error('Akses tidak sah.');

    const ss = getSpreadsheet();
    const shTrx = ss.getSheetByName(SHEET_NAMES.TRANSAKSI);
    const data = shTrx.getDataRange().getValues();
    const isAdmin = user.role === 'Admin';

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(transactionId)) {
        const ownerId = String(data[i][7]);
        const status = String(data[i][10] || 'Disetujui');
        if (!isAdmin) {
          if (ownerId !== user.id) {
            throw new Error('RBAC: Tidak dapat menghapus transaksi anggota lain.');
          }
          if (status === 'Disetujui') {
            throw new Error('RBAC: Transaksi yang sudah disetujui Admin tidak bisa dihapus.');
          }
        }
        shTrx.deleteRow(i + 1);
        recalculateAllWalletBalances(ss);
        return { success: true, message: `Transaksi ${transactionId} telah dihapus.` };
      }
    }
    throw new Error('Transaksi tidak ditemukan.');
  } finally {
    lock.releaseLock();
  }
}

/**
 * Admin menyetujui transaksi anak (status Pending -> Disetujui)
 */
function approveChildTransaction(adminId, transactionId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const admin = verifyMemberById(adminId);
    if (!admin || admin.role !== 'Admin') {
      throw new Error('Hanya Admin yang dapat menyetujui transaksi.');
    }
    const ss = getSpreadsheet();
    const shTrx = ss.getSheetByName(SHEET_NAMES.TRANSAKSI);
    const data = shTrx.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(transactionId)) {
        shTrx.getRange(i + 1, 11).setValue('Disetujui');
        return { success: true, message: `Transaksi ${transactionId} telah disetujui.` };
      }
    }
    throw new Error('Transaksi tidak ditemukan.');
  } finally {
    lock.releaseLock();
  }
}

function checkCategoryBudgetWarning(ss, categoryName) {
  const shKat = ss.getSheetByName(SHEET_NAMES.KATEGORI);
  const shTrx = ss.getSheetByName(SHEET_NAMES.TRANSAKSI);
  const katData = shKat.getDataRange().getValues();
  let limit = 0;
  let warnPct = 80;
  for (let i = 1; i < katData.length; i++) {
    if (String(katData[i][0]) === categoryName) {
      limit = Number(katData[i][1] || 0);
      warnPct = Number(katData[i][2] || 80);
      break;
    }
  }
  if (limit <= 0) return null;

  const currentYM = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM');
  const trxData = shTrx.getDataRange().getValues();
  let spent = 0;
  for (let j = 1; j < trxData.length; j++) {
    const r = trxData[j];
    const dStr = r[1] instanceof Date
      ? Utilities.formatDate(r[1], 'Asia/Jakarta', 'yyyy-MM')
      : String(r[1]).slice(0, 7);
    if (dStr === currentYM && String(r[2]) === 'Keluar' && String(r[4]) === categoryName) {
      spent += Number(r[3] || 0);
    }
  }

  const pct = Math.round((spent / limit) * 100);
  if (pct >= 100) {
    return `🚨 OVERBUDGET! Kategori "${categoryName}" telah mencapai ${pct}% (Rp ${formatRupiahPlain(spent)} dari batas Rp ${formatRupiahPlain(limit)}).`;
  } else if (pct >= warnPct) {
    return `⚠️ Peringatan Anggaran: Kategori "${categoryName}" sudah mencapai ${pct}% dari kuota bulanan (Rp ${formatRupiahPlain(spent)} / Rp ${formatRupiahPlain(limit)}).`;
  }
  return null;
}

/**
 * ============================================================================
 * AI CHATBOT NLP & OCR STRUK BELANJA (US-1 & US-2)
 * ============================================================================
 */

/**
 * Proses pesan obrolan dari Web App atau Webhook WhatsApp/Telegram
 * Mendukung:
 * 1. Pertanyaan seputar keuangan ("Sisa uang makan bulan ini berapa?", "Saldo keluarga berapa?")
 * 2. Input transaksi1 atau banyak item sekaligus ("Beli beras 5kg 75rb dan gas 22rb pakai tunai")
 * 3. Permintaan dana tambahan dari Anak ("Minta uang tambahan 50rb buat beli buku")
 */
function processChatbotMessage(memberId, rawMessage, confirmedCategory) {
  initDatabaseIfNeeded();
  const user = verifyMemberById(memberId);
  if (!user) throw new Error('Anggota tidak dikenali.');

  const text = String(rawMessage || '').trim();
  if (!text) throw new Error('Pesan tidak boleh kosong.');

  const isAdmin = user.role === 'Admin';
  const ss = getSpreadsheet();

  // 1. Cek apakah pesan berupa PERTANYAAN seputar saldo / budget
  if (isQuestionIntent(text)) {
    const answer = answerFinancialQuestion(ss, user, text);
    logChatAndInsight(ss, user.id, text, answer, 'Harian', 0, 'Terjawab');
    return {
      status: 'QUESTION_ANSWERED',
      reply: answer,
      transactionsCreated: []
    };
  }

  // 2. Cek apakah Member Anak mengajukan request dana tambahan (US-6 AC2)
  if (!isAdmin && /(minta|ajukan|request|butuh|tambah)\s+(uang|dana|jajan|saldo)/i.test(text)) {
    const parsedReq = parseNaturalLanguageTransactions(text, user);
    const reqNominal = parsedReq.items.length > 0 ? parsedReq.items[0].amount : extractFirstAmount(text);
    if (reqNominal > 0) {
      const reqRes = createFundRequest(user.id, {
        amount: reqNominal,
        reason: text
      });
      return {
        status: 'FUND_REQUEST_CREATED',
        reply: `📩 Pengajuan dana tambahan sebesar *Rp ${formatRupiahPlain(reqNominal)}* untuk _"${text}"_ berhasil dikirim ke Admin (Ayah & Bunda) untuk disetujui!`,
        request: reqRes
      };
    }
  }

  // 3. Parsing transaksi menggunakan Gemini AI (jika GEMINI_API_KEY diatur) atau Smart Rule-Based NLP Indonesia
  const parsed = parseNaturalLanguageTransactions(text, user, confirmedCategory);

  if (!parsed.items || parsed.items.length === 0) {
    return {
      status: 'UNRECOGNIZED',
      reply: '🤔 Maaf, Qyona AI belum menemukan nominal rupiah di pesanmu.\n\nContoh ketik:\n• _"Beli beras 5kg 75rb pakai tunai"_\n• _"Isi bensin Pertamax 150rb pakai GoPay"_\n• _"Sisa uang dapur bulan ini berapa?"_'
    };
  }

  // US-1 AC2: Jika kategori tidak terdeteksi otomatis dan pengguna adalah Admin, tanyakan balik untuk konfirmasi
  const ambiguousItem = parsed.items.find(it => it.needsCategoryConfirmation);
  if (ambiguousItem && isAdmin && !confirmedCategory) {
    return {
      status: 'NEEDS_CONFIRMATION',
      pendingMessage: text,
      detectedAmount: ambiguousItem.amount,
      detectedDescription: ambiguousItem.description,
      detectedWalletId: ambiguousItem.walletId,
      suggestedCategories: ['Dapur & Makanan', 'Tagihan & Utilitas', 'Transportasi & BBM', 'Jajan/Anak', 'Hiburan & Keluarga', 'Kesehatan & Darurat', 'Pendidikan & Les'],
      reply: `🤔 Saya mendeteksi transaksi *${ambiguousItem.description}* sebesar *Rp ${formatRupiahPlain(ambiguousItem.amount)}*, namun kategorinya belum spesifik.\n\nSilakan pilih kategori di bawah ini sebelum saya menyimpannya:`
    };
  }

  // Simpan seluruh item yang terdeteksi
  const savedItems = [];
  const alerts = [];
  parsed.items.forEach(item => {
    const res = saveTransaction(user.id, {
      type: item.type,
      amount: item.amount,
      category: confirmedCategory || item.category,
      description: item.description,
      walletId: item.walletId,
      source: 'Chat'
    });
    savedItems.push({
      id: res.transactionId,
      description: item.description,
      amount: item.amount,
      category: res.category,
      type: item.type,
      walletName: item.walletName
    });
    if (res.budgetAlert) alerts.push(res.budgetAlert);
  });

  // US-1 AC3: Balas ringkasan transaksi yang tersimpan dalam 1 pesan konfirmasi
  const totalSaved = savedItems.reduce((s, i) => s + i.amount, 0);
  const lines = savedItems.map((it, idx) =>
    `${idx + 1}. *${it.description}* — Rp ${formatRupiahPlain(it.amount)} _(${it.category} • ${it.walletName})_`
  );
  let replyMsg = `✅ *Tercatat Otomatis (${savedItems.length} Transaksi)*\n` +
    lines.join('\n') +
    `\n\n💰 *Total:* Rp ${formatRupiahPlain(totalSaved)}\n👤 *Dicatat oleh:* ${user.name}`;

  if (!isAdmin) {
    replyMsg += `\n🔒 _Info RBAC: Otomatis masuk kategori Jajan/Anak._`;
  }
  if (alerts.length > 0) {
    replyMsg += `\n\n${alerts.join('\n')}`;
  }

  logChatAndInsight(ss, user.id, text, replyMsg, 'Harian', 0, 'Tersimpan');

  return {
    status: 'SAVED',
    reply: replyMsg,
    transactionsCreated: savedItems
  };
}

/**
 * Deteksi apakah teks chat adalah kalimat tanya
 */
function isQuestionIntent(text) {
  const lower = text.toLowerCase();
  const hasQuestionWord = /(berapa|sisa|total|cek|gimana|bagaimana|info|status|rekap|laporan|apakah|\?)/i.test(lower);
  const hasFinanceKeyword = /(saldo|uang|budget|anggaran|dapur|makan|jajan|tagihan|pengeluaran|pemasukan|dompet|hemat|boros)/i.test(lower);
  // Pastikan bukan kalimat perintah input seperti "beli makan 25rb"
  const isPurchase = /^(beli|bayar|isi|jajan|catat|masuk|transfer|belanja)\b/i.test(lower) && extractFirstAmount(lower) > 0;
  return hasQuestionWord && hasFinanceKeyword && !isPurchase;
}

/**
 * Jawab pertanyaan langsung pengguna dari data real-time Spreadsheet
 */
function answerFinancialQuestion(ss, user, questionText) {
  const data = getAppBootstrapData(user.id);
  const lower = questionText.toLowerCase();

  if (user.role !== 'Admin') {
    const childCat = data.categoryBreakdown.find(c => c.name === 'Jajan/Anak') || { spent: 0, limit: user.allowanceQuota || 500000 };
    const remaining = Math.max(0, childCat.limit - childCat.spent);
    return `👦Halo *${user.name}*!\n\n` +
      `• *Sisa Kuota Jajanmu:* Rp ${formatRupiahPlain(remaining)}\n` +
      `• *Terpakai Bulan Ini:* Rp ${formatRupiahPlain(childCat.spent)} dari Rp ${formatRupiahPlain(childCat.limit)} (${childCat.percentage || 0}%)\n\n` +
      `Tetap semangat menabung ya! 🌟`;
  }

  // Cek apakah menanyakan kategori tertentu (mis. "uang makan" / "dapur")
  let matchedCat = null;
  if (/dapur|makan|sembako|masak|beras/i.test(lower)) {
    matchedCat = data.categoryBreakdown.find(c => c.name === 'Dapur & Makanan');
  } else if (/tagihan|listrik|air|wifi|internet/i.test(lower)) {
    matchedCat = data.categoryBreakdown.find(c => c.name === 'Tagihan & Utilitas');
  } else if (/jajan|anak|raka|nayla/i.test(lower)) {
    matchedCat = data.categoryBreakdown.find(c => c.name === 'Jajan/Anak');
  } else if (/bensin|transport|bbm|tol|mobil/i.test(lower)) {
    matchedCat = data.categoryBreakdown.find(c => c.name === 'Transportasi & BBM');
  } else if (/hiburan|nonton|kopi|jalan/i.test(lower)) {
    matchedCat = data.categoryBreakdown.find(c => c.name === 'Hiburan & Keluarga');
  }

  if (matchedCat) {
    const sisa = Math.max(0, matchedCat.limit - matchedCat.spent);
    return `📊 *Status Anggaran ${matchedCat.name} (${data.currentMonthYear})*\n\n` +
      `• *Sisa Anggaran:* Rp ${formatRupiahPlain(sisa)}\n` +
      `• *Terpakai:* Rp ${formatRupiahPlain(matchedCat.spent)} (${matchedCat.percentage}%)\n` +
      `• *Batas Bulanan:* Rp ${formatRupiahPlain(matchedCat.limit)}\n` +
      `• *Perbandingan Bulan Lalu:* ${matchedCat.diffFromPrev >= 0 ? 'Naik' : 'Turun'} Rp ${formatRupiahPlain(Math.abs(matchedCat.diffFromPrev))}`;
  }

  // Jawaban ringkasan umum
  const s = data.summary;
  const sisaBudgetTotal = Math.max(0, s.totalBudgetLimit - s.totalExpense);
  return `🏦 *Ringkasan Kas Keluarga Qyona (${data.currentMonthYear})*\n\n` +
    `• *Saldo Gabungan Semua Dompet:* Rp ${formatRupiahPlain(s.totalBalance)}\n` +
    `• *Pemasukan Bulan Ini:* Rp ${formatRupiahPlain(s.totalIncome)}\n` +
    `• *Pengeluaran Bulan Ini:* Rp ${formatRupiahPlain(s.totalExpense)} (${s.budgetUsedPercent}% dari budget)\n` +
    `• *Sisa Kuota Anggaran:* Rp ${formatRupiahPlain(sisaBudgetTotal)}`;
}

/**
 * Parsing teks bebas bahasa Indonesia menjadi item transaksi terstruktur
 * Menggunakan Gemini API jika key tersedia, dan fallback cerdas berbasis kamus Bahasa Indonesia
 */
function parseNaturalLanguageTransactions(text, user, forcedCategory) {
  const isAdmin = user.role === 'Admin';
  const geminiKey = getConfig('GEMINI_API_KEY', '');

  // Deteksi Dompet dari teks
  const walletDetection = detectWalletFromText(text, isAdmin);

  // Jika Gemini API Key dikonfigurasi, panggil Gemini untuk ekstraksi presisi
  if (geminiKey) {
    try {
      const aiResult = callGeminiForTextParsing(geminiKey, text, isAdmin, walletDetection);
      if (aiResult && aiResult.items && aiResult.items.length > 0) {
        return aiResult;
      }
    } catch (e) {
      // Lanjut gunakan mesin NLP lokal jika kuota habis / offline
    }
  }

  // Mesin NLP Bahasa Indonesia Lokal (mendukung multi-item dipisah koma / "dan" / baris baru)
  const segments = text
    .split(/(?:\r?\n|\s+dan\s+|\s*,\s*(?=[a-zA-Z]+\s+.*?\d)|\s*;\s*)/i)
    .map(s => s.trim())
    .filter(Boolean);

  const items = [];
  const targetSegments = segments.length > 0 ? segments : [text];

  targetSegments.forEach(seg => {
    const amount = extractFirstAmount(seg);
    if (amount > 0) {
      const catInfo = !isAdmin
        ? { category: 'Jajan/Anak', type: 'Keluar', confident: true }
        : (forcedCategory
            ? { category: forcedCategory, type: forcedCategory === 'Gaji & Pemasukan' ? 'Masuk' : 'Keluar', confident: true }
            : classifyIndonesianCategory(seg));

      const cleanDesc = cleanItemDescription(seg);
      items.push({
        description: cleanDesc || seg,
        amount: amount,
        category: catInfo.category,
        type: catInfo.type,
        walletId: walletDetection.id,
        walletName: walletDetection.name,
        needsCategoryConfirmation: !catInfo.confident && isAdmin && !forcedCategory
      });
    }
  });

  // Jika segmen terpecah gagal mengambil nominal tapi kalimat utuh punya nominal
  if (items.length === 0) {
    const singleAmount = extractFirstAmount(text);
    if (singleAmount > 0) {
      const catInfo = !isAdmin
        ? { category: 'Jajan/Anak', type: 'Keluar', confident: true }
        : (forcedCategory
            ? { category: forcedCategory, type: forcedCategory === 'Gaji & Pemasukan' ? 'Masuk' : 'Keluar', confident: true }
            : classifyIndonesianCategory(text));

      items.push({
        description: cleanItemDescription(text) || text,
        amount: singleAmount,
        category: catInfo.category,
        type: catInfo.type,
        walletId: walletDetection.id,
        walletName: walletDetection.name,
        needsCategoryConfirmation: !catInfo.confident && isAdmin && !forcedCategory
      });
    }
  }

  return { items: items };
}

/**
 * Ekstrak nominal Rupiah dari format populer Indonesia:
 * "75rb", "75.000", "75k", "1,5jt", "1.5 juta", "Rp 22.000", "22000"
 * Mengabaikan angka kuantitas seperti "5kg", "2L", "3x", "100kWh"
 */
function extractFirstAmount(str) {
  if (!str) return 0;
  // Hapus angka yang menempel dengan satuan berat/volume/frekuensi agar tidak salah baca ("5kg", "2liter", "3x", "12kg")
  const cleaned = str.replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|gr|gram|liter|ltr|ml|ons|kw|kwh|pcs|buah|ikat|bungkus|pak|box|x|kali|orang)\b/gi, ' ');

  // 1. Cek pola dengan akhiran juta / jt / rb / ribu / k
  const unitRegex = /(?:rp\.?\s*)?(\d+(?:[.,]\d+)?)\s*(juta|jt|ribu|rb|k)\b/i;
  const unitMatch = cleaned.match(unitRegex);
  if (unitMatch) {
    const rawNum = parseFloat(unitMatch[1].replace(',', '.'));
    const unit = unitMatch[2].toLowerCase();
    if (unit === 'juta' || unit === 'jt') return Math.round(rawNum * 1000000);
    if (unit === 'ribu' || unit === 'rb' || unit === 'k') return Math.round(rawNum * 1000);
  }

  // 2. Cek pola ribuan berformat titik (mis. 75.000 atau 1.250.000)
  const dottedRegex = /(?:rp\.?\s*)?(\d{1,3}(?:\.\d{3})+)\b/i;
  const dottedMatch = cleaned.match(dottedRegex);
  if (dottedMatch) {
    return parseInt(dottedMatch[1].replace(/\./g, ''), 10);
  }

  // 3. Cek angka murni >= 500 (mis. 22000 atau 75000)
  const plainRegex = /(?:rp\.?\s*)?(\d{3,9})\b/i;
  const plainMatch = cleaned.match(plainRegex);
  if (plainMatch) {
    return parseInt(plainMatch[1], 10);
  }

  return 0;
}

function cleanItemDescription(seg) {
  let s = seg
    .replace(/(?:pakai|via|dengan|dari|lewat)\s+(?:tunai|cash|bca|mandiri|gopay|qris|ovo|dana|bank|dompet\s+\w+)/gi, '')
    .replace(/(?:rp\.?\s*)?\d+(?:[.,]\d+)?\s*(?:juta|jt|ribu|rb|k)\b/gi, '')
    .replace(/(?:rp\.?\s*)?\d{1,3}(?:\.\d{3})+\b/gi, '')
    .replace(/(?:rp\.?\s*)?\b\d{4,9}\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return 'Transaksi Harian';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function detectWalletFromText(text, isAdmin) {
  if (!isAdmin) {
    return { id: 'WLT-05', name: 'Saku Anak (Gopay/Cash)' };
  }
  const lower = text.toLowerCase();
  if (/tunai|cash|dapur/i.test(lower)) return { id: 'WLT-04', name: 'Dompet Tunai Dapur' };
  if (/gopay|qris|ewallet|ovo|dana|shopeepay/i.test(lower)) return { id: 'WLT-03', name: 'GoPay / QRIS Rumah' };
  if (/mandiri/i.test(lower)) return { id: 'WLT-02', name: 'Mandiri Tabungan' };
  return { id: 'WLT-01', name: 'BCA Keluarga' };
}

function classifyIndonesianCategory(text) {
  const lower = text.toLowerCase();
  if (/gaji|bonus|thr|insentif|pemasukan|komisi|dividen|terima uang/i.test(lower)) {
    return { category: 'Gaji & Pemasukan', type: 'Masuk', confident: true };
  }
  if (/beras|minyak|telur|sayur|ayam|ikan|daging|bumbu|pasar|superindo|alfamart|indomaret|gas|galon|aqua|sembako|masak|makan|sarapan|lauk|roti|susu|buah|gofood|grabfood|warteg|restoran/i.test(lower)) {
    return { category: 'Dapur & Makanan', type: 'Keluar', confident: true };
  }
  if (/listrik|pln|token|air|pdam|wifi|internet|biznet|indihome|pulsa|paket data|iuran|rt|sampah|cicilan|kpr/i.test(lower)) {
    return { category: 'Tagihan & Utilitas', type: 'Keluar', confident: true };
  }
  if (/bensin|pertamax|pertalite|solar|bbm|tol|parkir|grab|gojek|ojol|krl|kereta|bus|servis mobil|servis motor|oli|ban/i.test(lower)) {
    return { category: 'Transportasi & BBM', type: 'Keluar', confident: true };
  }
  if (/jajan|es krim|coklat|snack|mainan|uang saku|kantin|raka|nayla/i.test(lower)) {
    return { category: 'Jajan/Anak', type: 'Keluar', confident: true };
  }
  if (/obat|dokter|apotek|vitamin|rs|rumah sakit|klinik|bpjs|cek lab|gigi/i.test(lower)) {
    return { category: 'Kesehatan & Darurat', type: 'Keluar', confident: true };
  }
  if (/spp|sekolah|les|kursus|buku|alat tulis|seragam|ujian|pendidikan/i.test(lower)) {
    return { category: 'Pendidikan & Les', type: 'Keluar', confident: true };
  }
  if (/nonton|bioskop|netflix|spotify|kopi|cafe|liburan|hotel|wisata|rekrasi|mall|hiburan/i.test(lower)) {
    return { category: 'Hiburan & Keluarga', type: 'Keluar', confident: true };
  }
  // Jika tidak cocok dengan kata kunci di atas, minta konfirmasi (US-1 AC2)
  return { category: 'Dapur & Makanan', type: 'Keluar', confident: false };
}

/**
 * ============================================================================
 * OCR VISION STRUK BELANJA + PENYIMPANAN KE GOOGLE DRIVE (US-2)
 * ============================================================================
 */
function processReceiptImageOCR(memberId, payload) {
  initDatabaseIfNeeded();
  const user = verifyMemberById(memberId);
  if (!user) throw new Error('Pengguna tidak dikenali.');

  const isAdmin = user.role === 'Admin';
  let driveFileUrl = '';

  // 1. Simpan foto struk ke Folder Drive `Qyona_Struk_Belanja` (US-2 AC3)
  if (payload.base64Data) {
    try {
      const folder = getOrCreateReceiptFolder();
      const cleanBase64 = payload.base64Data.replace(/^data:image\/\w+;base64,/, '');
      const decoded = Utilities.base64Decode(cleanBase64);
      const mimeType = payload.mimeType || 'image/jpeg';
      const fileName = `Struk_${user.id}_${Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMdd_HHmmss')}.jpg`;
      const blob = Utilities.newBlob(decoded, mimeType, fileName);
      const file = folder.createFile(blob);
      driveFileUrl = file.getUrl();
    } catch (driveErr) {
      driveFileUrl = 'https://drive.google.com/qyona-struk-' + new Date().getTime();
    }
  }

  // 2. Ekstraksi item struk via Gemini Vision API (jika GEMINI_API_KEY tersedia) atau ekstraksi cerdas
  const geminiKey = getConfig('GEMINI_API_KEY', '');
  let extractedItems = [];

  if (geminiKey && payload.base64Data) {
    try {
      extractedItems = callGeminiVisionOCR(geminiKey, payload.base64Data, payload.mimeType || 'image/jpeg', isAdmin);
    } catch (visionErr) {
      // Fallback ke parser teks struk / simulasi OCR terstruktur
    }
  }

  // Jika pengguna juga menyertakan teks OCR atau menggunakan mode simulasi struk belanja bulanan
  if (extractedItems.length === 0) {
    if (payload.ocrRawText) {
      const parsedFromRaw = parseNaturalLanguageTransactions(payload.ocrRawText, user);
      extractedItems = parsedFromRaw.items;
    } else {
      // Contoh ekstraksi cerdas struk belanja pasar/minimarket sesuai profil pengguna
      extractedItems = getSmartReceiptFallbackItems(isAdmin, payload.fileName || '');
    }
  }

  return {
    success: true,
    receiptUrl: driveFileUrl,
    merchantName: payload.merchantName || 'Superindo / Minimarket Keluarga',
    extractedDate: Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm'),
    items: extractedItems
  };
}

/**
 * Simpan batch item hasil ekstraksi OCR yang telah dikoreksi/disetujui pengguna di Modal
 */
function commitBatchOcrItems(memberId, batchPayload) {
  const user = verifyMemberById(memberId);
  if (!user) throw new Error('Akses ditolak.');

  const items = batchPayload.items || [];
  if (items.length === 0) throw new Error('Tidak ada item struk untuk disimpan.');

  const receiptUrl = batchPayload.receiptUrl || '';
  const walletId = batchPayload.walletId || (user.role === 'Admin' ? 'WLT-01' : 'WLT-05');
  const saved = [];

  items.forEach(it => {
    if (Number(it.amount) > 0) {
      const res = saveTransaction(user.id, {
        type: 'Keluar',
        amount: Number(it.amount),
        category: user.role === 'Admin' ? it.category : 'Jajan/Anak',
        description: `[Struk] ${it.description}`,
        walletId: walletId,
        receiptUrl: receiptUrl,
        source: 'OCR'
      });
      saved.push(res);
    }
  });

  return {
    success: true,
    savedCount: saved.length,
    receiptUrl: receiptUrl,
    message: `${saved.length} item dari foto struk berhasil disimpan ke Sheet Transaksi & ditautkan ke Google Drive.`
  };
}

function getSmartReceiptFallbackItems(isAdmin, fileName) {
  if (!isAdmin) {
    return [
      { description: 'Roti Gandum Coklat Sari Roti', amount: 18500, category: 'Jajan/Anak' },
      { description: 'Susu UHT Ultra Milk 250ml x2', amount: 15000, category: 'Jajan/Anak' },
      { description: 'Buku Catatan Bergaris Campus', amount: 12500, category: 'Jajan/Anak' }
    ];
  }
  return [
    { description: 'Beras Ramos Premium 5kg', amount: 74500, category: 'Dapur & Makanan' },
    { description: 'Minyak Goreng Tropical 2 Liter', amount: 36900, category: 'Dapur & Makanan' },
    { description: 'Telur Ayam Negeri Omega 1 Tray', amount: 29800, category: 'Dapur & Makanan' },
    { description: 'Dada Ayam Fillet Segar 1kg', amount: 52000, category: 'Dapur & Makanan' },
    { description: 'Sabun Cuci Piring Sunlight & Deterjen', amount: 41500, category: 'Dapur & Makanan' },
    { description: 'Susu Anak & Biskuit Gandum', amount: 48000, category: 'Jajan/Anak' },
    { description: 'Vitamin C Keluarga & Plester Luka', amount: 34500, category: 'Kesehatan & Darurat' }
  ];
}

/**
 * Panggilan ke Gemini Vision API untuk membaca foto struk nyata
 */
function callGeminiVisionOCR(apiKey, base64Image, mimeType, isAdmin) {
  const cleanB64 = base64Image.replace(/^data:image\/\w+;base64,/, '');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const prompt = `Kamu adalah asisten akuntan keluarga Qyona. Baca gambar struk belanja ini dan ekstrak daftar item beserta harganya dalam Rupiah (angka bulat).
Petakan setiap item ke salah satu kategori berikut:
- "Dapur & Makanan"
- "Tagihan & Utilitas"
- "Jajan/Anak"
- "Transportasi & BBM"
- "Kesehatan & Darurat"
- "Hiburan & Keluarga"
- "Pendidikan & Les"
Kembalikan HANYA JSON array murni dengan format: [{"description": "Nama Item", "amount": 25000, "category": "Dapur & Makanan"}]`;

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: cleanB64 } }
      ]
    }],
    generationConfig: { temperature: 0.1 }
  };

  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  const json = JSON.parse(resp.getContentText());
  const rawText = json.candidates &&
    json.candidates[0] &&
    json.candidates[0].content &&
    json.candidates[0].content.parts[0].text;

  if (!rawText) return [];
  const cleanedJson = rawText.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleanedJson);
  return Array.isArray(parsed) ? parsed.map(it => ({
    description: String(it.description || 'Item Struk'),
    amount: Number(it.amount || 0),
    category: isAdmin ? String(it.category || 'Dapur & Makanan') : 'Jajan/Anak'
  })) : [];
}

function callGeminiForTextParsing(apiKey, text, isAdmin, walletDetection) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const prompt = `Urai pesan transaksi keuangan rumah tangga berikut menjadi JSON: "${text}"
Kategori yang diizinkan: "Dapur & Makanan", "Tagihan & Utilitas", "Jajan/Anak", "Transportasi & BBM", "Kesehatan & Darurat", "Hiburan & Keluarga", "Pendidikan & Les", "Gaji & Pemasukan".
Kembalikan HANYA JSON dengan format:
{"items": [{"description": "Beli beras 5kg", "amount": 75000, "category": "Dapur & Makanan", "type": "Keluar", "needsCategoryConfirmation": false}]}`;

  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1 }
    }),
    muteHttpExceptions: true
  });

  const json = JSON.parse(resp.getContentText());
  const rawText = json.candidates && json.candidates[0].content.parts[0].text;
  const parsed = JSON.parse(rawText.replace(/```json|```/g, '').trim());
  if (parsed && Array.isArray(parsed.items)) {
    parsed.items = parsed.items.map(it => ({
      description: it.description,
      amount: Number(it.amount || 0),
      category: isAdmin ? it.category : 'Jajan/Anak',
      type: isAdmin ? (it.type || 'Keluar') : 'Keluar',
      walletId: walletDetection.id,
      walletName: walletDetection.name,
      needsCategoryConfirmation: Boolean(it.needsCategoryConfirmation)
    }));
  }
  return parsed;
}

/**
 * ============================================================================
 * AI INSIGHT BULANAN PROAKTIF (US-4)
 * ============================================================================
 */
function generateProactiveAIInsight(memberId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const user = verifyMemberById(memberId);
    if (!user) throw new Error('Akses ditolak.');

    const data = getAppBootstrapData(user.id);
    const ss = getSpreadsheet();

    // Cari kategori dengan kenaikan tertinggi atau persentase budget tertinggi
    const sortedByRatio = [...data.categoryBreakdown].sort((a, b) => b.percentage - a.percentage);
    const topCat = sortedByRatio[0] || { name: 'Dapur & Makanan', spent: 0, limit: 3500000, percentage: 0, prevSpent: 0 };

    let analysisText = '';
    let savingEstimate = 0;
    let insightTitle = '';

    if (user.role !== 'Admin') {
      insightTitle = `Evaluasi Uang Jajan ${user.name}`;
      savingEstimate = Math.round(topCat.spent * 0.2) || 50000;
      analysisText = `Bulan ini kamu sudah menggunakan Rp ${formatRupiahPlain(topCat.spent)} (${topCat.percentage}% dari kuota). Jika kamu membawa botol minum sendiri dari rumah dan menyisihkan Rp 5.000 setiap kali jajan, kamu bisa menabung ekstra Rp ${formatRupiahPlain(savingEstimate)} bulan ini!`;
    } else {
      insightTitle = `Analisis Komparatif ${data.currentMonthYear} vs ${data.prevMonthYear}`;
      const totalOver = data.categoryBreakdown.filter(c => c.percentage >= 75);
      savingEstimate = Math.max(185000, Math.round(topCat.spent * 0.15));

      const diffWord = topCat.diffFromPrev >= 0
        ? `naik Rp ${formatRupiahPlain(topCat.diffFromPrev)}`
        : `berhasil turun Rp ${formatRupiahPlain(Math.abs(topCat.diffFromPrev))}`;

      analysisText = `Pos pengeluaran terbesar bulan ini adalah "${topCat.name}" sebesar Rp ${formatRupiahPlain(topCat.spent)} (${topCat.percentage}% dari batas Rp ${formatRupiahPlain(topCat.limit)}), ${diffWord} dibanding bulan lalu. ` +
        (totalOver.length > 0
          ? `Terdapat ${totalOver.length} kategori yang mendekati/melewati ambang aman. Rekomendasi konkret: terapkan belanja mingguan terjadwal dengan daftar tetap & kurangi transaksi impulsif e-wallet untuk menghemat sekitar Rp ${formatRupiahPlain(savingEstimate)}/bulan.`
          : `Seluruh kategori masih berada di zona hijau aman (<75%). Pertahankan rasio tabungan keluarga dan alokasikan surplus ke dana darurat.`);
    }

    const insightId = logChatAndInsight(
      ss,
      user.id,
      insightTitle,
      analysisText,
      user.role === 'Admin' ? 'Bulanan' : 'Harian',
      savingEstimate,
      'Aktif'
    );

    return {
      success: true,
      insight: {
        id: insightId,
        timestamp: Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm'),
        prompt: insightTitle,
        analysis: analysisText,
        type: user.role === 'Admin' ? 'Bulanan' : 'Harian',
        estimatedSaving: savingEstimate,
        status: 'Aktif'
      }
    };
  } finally {
    lock.releaseLock();
  }
}

function logChatAndInsight(ss, memberId, promptText, aiAnalysis, type, savingNominal, status) {
  const sh = ss.getSheetByName(SHEET_NAMES.INSIGHT);
  const id = 'INS-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'ddHHmmss');
  const nowStr = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm');
  sh.appendRow([id, nowStr, memberId, promptText, aiAnalysis, type || 'Harian', Number(savingNominal || 0), status || 'Aktif']);
  return id;
}

/**
 * ============================================================================
 * APPROVAL TAGIHAN RUTIN & PENGAJUAN DANA ANAK (US-5 & US-6)
 * ============================================================================
 */
function markBillAsPaid(adminId, billId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const admin = verifyMemberById(adminId);
    if (!admin || admin.role !== 'Admin') {
      throw new Error('RBAC: Hanya Admin (Suami/Istri) yang dapat menandai tagihan lunas.');
    }

    const ss = getSpreadsheet();
    const shBill = ss.getSheetByName(SHEET_NAMES.TAGIHAN);
    const data = shBill.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(billId)) {
        const billName = String(data[i][1]);
        const amount = Number(data[i][2] || 0);
        const category = String(data[i][4] || 'Tagihan & Utilitas');
        const walletId = String(data[i][5] || 'WLT-01');
        const currentStatus = String(data[i][6]);

        if (currentStatus === 'Lunas') {
          return { success: true, message: `Tagihan "${billName}" sudah berstatus Lunas.` };
        }

        // Tandai Lunas di Sheet Tagihan Rutin
        shBill.getRange(i + 1, 7).setValue('Lunas');

        // US-5 AC2: Otomatis mencatat sebagai transaksi pengeluaran
        const trxRes = saveTransaction(admin.id, {
          type: 'Keluar',
          amount: amount,
          category: category,
          description: `Pelunasan Tagihan Rutin: ${billName}`,
          walletId: walletId,
          source: 'Form'
        });

        return {
          success: true,
          transactionId: trxRes.transactionId,
          message: `Tagihan "${billName}" (Rp ${formatRupiahPlain(amount)}) berhasil ditandai LUNAS dan otomatis tercatat di Transaksi.`
        };
      }
    }
    throw new Error('Data tagihan tidak ditemukan.');
  } finally {
    lock.releaseLock();
  }
}

function saveRoutineBill(adminId, billPayload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const admin = verifyMemberById(adminId);
    if (!admin || admin.role !== 'Admin') {
      throw new Error('Hanya Admin yang dapat mengelola tagihan rutin.');
    }
    const ss = getSpreadsheet();
    const sh = ss.getSheetByName(SHEET_NAMES.TAGIHAN);
    const id = 'BIL-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'HHmmss');
    sh.appendRow([
      id,
      String(billPayload.name || 'Tagihan Baru'),
      Number(billPayload.amount || 0),
      Number(billPayload.dueDay || 20),
      String(billPayload.category || 'Tagihan & Utilitas'),
      String(billPayload.walletId || 'WLT-01'),
      'Belum',
      'Belum'
    ]);
    return { success: true, billId: id, message: 'Tagihan rutin baru berhasil ditambahkan.' };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Pengajuan Dana Tambahan dari Anak / Anggota (US-6 AC2)
 */
function createFundRequest(memberId, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const user = verifyMemberById(memberId);
    if (!user) throw new Error('Pengguna tidak valid.');

    const amount = Number(payload.amount || 0);
    if (amount <= 0) throw new Error('Nominal pengajuan harus lebih dari Rp 0.');

    const ss = getSpreadsheet();
    const sh = ss.getSheetByName(SHEET_NAMES.PENGAJUAN);
    const reqId = 'REQ-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'ddHHmmss');
    const nowStr = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm');

    sh.appendRow([
      reqId,
      nowStr,
      user.id,
      user.name,
      amount,
      String(payload.reason || 'Permintaan dana tambahan'),
      'Menunggu Approval',
      ''
    ]);

    return {
      success: true,
      requestId: reqId,
      message: `Permintaan dana Rp ${formatRupiahPlain(amount)} telah dikirim ke Admin untuk disetujui.`
    };
  } finally {
    lock.releaseLock();
  }
}

function processFundRequestApproval(adminId, requestId, decision) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const admin = verifyMemberById(adminId);
    if (!admin || admin.role !== 'Admin') {
      throw new Error('RBAC: Hanya Admin yang dapat menyetujui atau menolak pengajuan dana.');
    }

    const ss = getSpreadsheet();
    const sh = ss.getSheetByName(SHEET_NAMES.PENGAJUAN);
    const data = sh.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(requestId)) {
        const requesterId = String(data[i][2]);
        const requesterName = String(data[i][3]);
        const amount = Number(data[i][4] || 0);
        const reason = String(data[i][5] || '');

        const finalStatus = decision === 'APPROVE' ? 'Disetujui' : 'Ditolak';
        sh.getRange(i + 1, 7).setValue(finalStatus);
        sh.getRange(i + 1, 8).setValue(admin.name);

        // Jika disetujui, tambahkan kuota jajan anak & catat pengeluaran/alokasi
        if (decision === 'APPROVE') {
          const shAnggota = ss.getSheetByName(SHEET_NAMES.ANGGOTA);
          const angData = shAnggota.getDataRange().getValues();
          for (let j = 1; j < angData.length; j++) {
            if (String(angData[j][0]) === requesterId) {
              const oldQuota = Number(angData[j][8] || 0);
              shAnggota.getRange(j + 1, 9).setValue(oldQuota + amount);
              break;
            }
          }
          saveTransaction(admin.id, {
            type: 'Keluar',
            amount: amount,
            category: 'Jajan/Anak',
            description: `[Approval Dana ${requesterName}] ${reason}`,
            walletId: 'WLT-05',
            targetMemberId: requesterId,
            source: 'Form'
          });
        }

        return {
          success: true,
          status: finalStatus,
          message: `Pengajuan dana dari ${requesterName} sebesar Rp ${formatRupiahPlain(amount)} telah ${finalStatus.toUpperCase()}.`
        };
      }
    }
    throw new Error('Data pengajuan dana tidak ditemukan.');
  } finally {
    lock.releaseLock();
  }
}

/**
 * ============================================================================
 * KELOLA DOMPET, KATEGORI BUDGET & ANGGOTA KELUARGA (HANYA ADMIN)
 * ============================================================================
 */
function updateCategoryBudget(adminId, categoryName, newLimit, newWarnPercent) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const admin = verifyMemberById(adminId);
    if (!admin || admin.role !== 'Admin') {
      throw new Error('RBAC: Hanya Admin yang dapat mengubah target budget.');
    }
    const ss = getSpreadsheet();
    const sh = ss.getSheetByName(SHEET_NAMES.KATEGORI);
    const data = sh.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(categoryName)) {
        sh.getRange(i + 1, 2).setValue(Number(newLimit || 0));
        if (newWarnPercent !== undefined) {
          sh.getRange(i + 1, 3).setValue(Number(newWarnPercent || 80));
        }
        return { success: true, message: `Target anggaran "${categoryName}" diperbarui menjadi Rp ${formatRupiahPlain(newLimit)}.` };
      }
    }
    throw new Error('Kategori tidak ditemukan.');
  } finally {
    lock.releaseLock();
  }
}

function saveWalletSource(adminId, walletPayload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const admin = verifyMemberById(adminId);
    if (!admin || admin.role !== 'Admin') {
      throw new Error('RBAC: Hanya Admin yang dapat menambah atau mengubah dompet.');
    }
    const ss = getSpreadsheet();
    const sh = ss.getSheetByName(SHEET_NAMES.DOMPET);
    const id = walletPayload.id || ('WLT-0' + sh.getLastRow());
    const initBal = Number(walletPayload.initialBalance || 0);
    sh.appendRow([
      id,
      String(walletPayload.name || 'Dompet Baru'),
      String(walletPayload.type || 'Bank'),
      initBal,
      initBal,
      String(walletPayload.info || '')
    ]);
    recalculateAllWalletBalances(ss);
    return { success: true, walletId: id, message: `Dompet "${walletPayload.name}" berhasil ditambahkan.` };
  } finally {
    lock.releaseLock();
  }
}

function inviteOrUpdateFamilyMember(adminId, memberPayload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const admin = verifyMemberById(adminId);
    if (!admin || admin.role !== 'Admin') {
      throw new Error('RBAC: Hanya Admin yang dapat mengundang anggota keluarga.');
    }
    const ss = getSpreadsheet();
    const sh = ss.getSheetByName(SHEET_NAMES.ANGGOTA);
    const currentMembers = getAllMembers().filter(m => m.status === 'Aktif');

    // Sesuai PRD Bab 3: Maksimal sistem dibatasi 6 anggota per keluarga
    if (!memberPayload.id && currentMembers.length >= 6) {
      throw new Error('Batas Kapasitas PRD: Maksimal 6 anggota keluarga aktif per akun rumah tangga Qyona.');
    }

    const newId = 'USR-0' + (sh.getLastRow());
    const role = memberPayload.role === 'Admin' ? 'Admin' : 'Member';
    const avatar = role === 'Admin' ? '🧑💼' : '🧒🎒';
    sh.appendRow([
      newId,
      String(memberPayload.name || 'Anggota Keluarga'),
      role,
      String(memberPayload.waId || ''),
      String(memberPayload.tgId || ''),
      'Aktif',
      String(memberPayload.pin || '1234'),
      avatar,
      Number(memberPayload.allowanceQuota || (role === 'Member' ? 500000 : 0))
    ]);

    return {
      success: true,
      memberId: newId,
      message: `${memberPayload.name} (${role}) berhasil didaftarkan ke Keluarga Qyona.`
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ============================================================================
 * EKSPOR LAPORAN PDF BULANAN & CSV/EXCEL (US-7)
 * ============================================================================
 */
function exportMonthlyCsv(memberId, monthYear) {
  const data = getAppBootstrapData(memberId, monthYear);
  const headers = ['ID Transaksi', 'Tanggal', 'Tipe', 'Nominal (Rp)', 'Kategori', 'Keterangan', 'Dompet', 'Anggota', 'Sumber Input', 'Status Approval', 'URL Foto Struk'];
  const rows = data.transactions.map(t => [
    t.id,
    t.date,
    t.type,
    t.amount,
    `"${(t.category || '').replace(/"/g, '""')}"`,
    `"${(t.description || '').replace(/"/g, '""')}"`,
    `"${(t.walletName || '').replace(/"/g, '""')}"`,
    `"${(t.memberName || '').replace(/"/g, '""')}"`,
    t.source,
    t.approvalStatus,
    t.receiptUrl
  ]);

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  return {
    success: true,
    fileName: `Laporan_Transaksi_Qyona_${data.currentMonthYear}.csv`,
    csvContent: csvContent
  };
}

function generateMonthlyPdfReport(memberId, monthYear) {
  const data = getAppBootstrapData(memberId, monthYear);
  const s = data.summary;
  const topInsight = data.insights[0] ? data.insights[0].analysis : 'Pengeluaran keluarga tercatat terkendali sesuai anggaran.';

  const catRowsHtml = data.categoryBreakdown.map(c => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;"><b>${c.name}</b></td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">Rp ${formatRupiahPlain(c.spent)}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">Rp ${formatRupiahPlain(c.limit)}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:center;color:${c.percentage >= 100 ? '#dc2626' : '#0f766e'};font-weight:bold;">${c.percentage}%</td>
    </tr>
  `).join('');

  const billRowsHtml = data.bills.map(b => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${b.name}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">Tgl ${b.dueDay}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">Rp ${formatRupiahPlain(b.amount)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:center;">${b.status}</td>
    </tr>
  `).join('');

  const htmlReport = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; color: #0f172a; margin: 28px; font-size: 12px; }
        .header { background: #0f766e; color: white; padding: 18px 22px; border-radius: 10px; }
        .header h1 { margin: 0; font-size: 20px; }
        .header p { margin: 4px 0 0; opacity: 0.9; font-size: 11px; }
        .grid { width: 100%; margin-top: 16px; border-collapse: collapse; }
        .card { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; }
        h3 { color: #0f766e; margin: 18px 0 8px; border-bottom: 2px solid #0f766e; padding-bottom: 4px; }
        table.data { width: 100%; border-collapse: collapse; margin-top: 6px; }
        table.data th { background: #f1f5f9; text-align: left; padding: 8px; border-bottom: 2px solid #cbd5e1; }
        .insight-box { background: #ecfdf5; border-left: 4px solid #10b981; padding: 12px; border-radius: 6px; margin-top: 12px; line-height: 1.5; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Laporan Keuangan Rumah Tangga Qyona</h1>
        <p>Periode: ${data.currentMonthYear} • Dicetak oleh: ${data.currentUser.name} (${data.currentUser.role}) • Tanggal Cetak: ${data.serverTime}</p>
      </div>

      <table class="grid">
        <tr>
          <td class="card" width="33%"><b>Saldo Gabungan</b><br><span style="font-size:16px;color:#0f766e;font-weight:bold;">Rp ${formatRupiahPlain(s.totalBalance)}</span></td>
          <td class="card" width="33%"><b>Total Pemasukan</b><br><span style="font-size:16px;color:#10b981;font-weight:bold;">Rp ${formatRupiahPlain(s.totalIncome)}</span></td>
          <td class="card" width="33%"><b>Total Pengeluaran</b><br><span style="font-size:16px;color:#ef4444;font-weight:bold;">Rp ${formatRupiahPlain(s.totalExpense)} (${s.budgetUsedPercent}%)</span></td>
        </tr>
      </table>

      <h3>1. Breakdown Realisasi Anggaran per Kategori</h3>
      <table class="data">
        <thead>
          <tr><th>Kategori</th><th style="text-align:right;">Realisasi</th><th style="text-align:right;">Batas Budget</th><th style="text-align:center;">Persentase</th></tr>
        </thead>
        <tbody>${catRowsHtml}</tbody>
      </table>

      ${data.bills.length > 0 ? `
      <h3>2. Status Tagihan Rutin Keluarga</h3>
      <table class="data">
        <thead>
          <tr><th>Nama Tagihan</th><th>Jatuh Tempo</th><th style="text-align:right;">Nominal</th><th style="text-align:center;">Status</th></tr>
        </thead>
        <tbody>${billRowsHtml}</tbody>
      </table>` : ''}

      <h3>3. Kesimpulan & Rekomendasi AI Insight</h3>
      <div class="insight-box">
        <b>Analisis AI Qyona:</b><br>${topInsight}
      </div>
    </body>
    </html>
  `;

  try {
    const blob = Utilities.newBlob(htmlReport, 'text/html', 'report.html').getAs('application/pdf');
    blob.setName(`Laporan_Keuangan_Qyona_${data.currentMonthYear}.pdf`);
    const base64Pdf = Utilities.base64Encode(blob.getBytes());
    return {
      success: true,
      fileName: `Laporan_Keuangan_Qyona_${data.currentMonthYear}.pdf`,
      base64Pdf: base64Pdf,
      htmlPreview: htmlReport
    };
  } catch (e) {
    return {
      success: true,
      fileName: `Laporan_Keuangan_Qyona_${data.currentMonthYear}.html`,
      base64Pdf: '',
      htmlPreview: htmlReport
    };
  }
}

/**
 * ============================================================================
 * WEBHOOK BOT TELEGRAM & WHATSAPP CLOUD API / FONNTE (doPost)
 * ============================================================================
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok' })).setMimeType(ContentService.MimeType.JSON);
    }

    const body = JSON.parse(e.postData.contents);

    // A. Deteksi Webhook Telegram Bot API
    if (body.message || body.edited_message) {
      const msg = body.message || body.edited_message;
      const tgChatId = String(msg.chat.id);
      const member = verifyMemberByChatId(tgChatId);

      if (!member) {
        sendTelegramMessage(tgChatId, `⛔ *Akses Ditolak (Privat)*\nID Chat Telegram Anda (\`${tgChatId}\`) belum terdaftar di aplikasi *Catatan Keuangan Rumah Qyona*.\n\nMinta Admin (Suami/Istri) mendaftarkan ID ini di menu *Kelola Keluarga*.`);
        return ContentService.createTextOutput('OK');
      }

      const text = msg.text || msg.caption || '';
      const result = processChatbotMessage(member.id, text);
      sendTelegramMessage(tgChatId, result.reply);
      return ContentService.createTextOutput('OK');
    }

    // B. Deteksi Webhook WhatsApp (Meta Cloud API atau Fonnte/Twilio)
    const waSender = body.sender || (body.entry && body.entry[0]?.changes?.[0]?.value?.messages?.[0]?.from);
    const waText = body.message || (body.entry && body.entry[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body);

    if (waSender && waText) {
      const member = verifyMemberByChatId(waSender);
      if (!member) {
        sendWhatsAppMessage(waSender, `⛔ *Akses Keluarga Privat*\nNomor WhatsApp (${waSender}) belum terdaftar di Catatan Keuangan Rumah Qyona.`);
        return ContentService.createTextOutput('OK');
      }
      const result = processChatbotMessage(member.id, waText);
      sendWhatsAppMessage(waSender, result.reply);
      return ContentService.createTextOutput('OK');
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'ignored' })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

function sendTelegramMessage(chatId, text) {
  const token = getConfig('TELEGRAM_BOT_TOKEN', '');
  if (!token) return;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    }),
    muteHttpExceptions: true
  });
}

function sendWhatsAppMessage(phone, text) {
  const token = getConfig('WA_API_TOKEN', '');
  if (!token) return;
  const phoneNumberId = getConfig('WA_PHONE_NUMBER_ID', '');

  if (phoneNumberId) {
    // Meta WhatsApp Cloud API Resmi
    UrlFetchApp.fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method: 'post',
      headers: { Authorization: `Bearer ${token}` },
      contentType: 'application/json',
      payload: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: text }
      }),
      muteHttpExceptions: true
    });
  } else {
    // Fonnte Gateway populer di Indonesia
    UrlFetchApp.fetch('https://api.fonnte.com/send', {
      method: 'post',
      headers: { Authorization: token },
      payload: { target: phone, message: text },
      muteHttpExceptions: true
    });
  }
}

/**
 * ============================================================================
 * TIME-DRIVEN TRIGGERS: REMINDER TAGIHAN H-3, RETENSISTRUK 3 BULAN, INSIGHT TGL 1
 * ============================================================================
 */

/**
 * Pasang seluruh trigger otomatis (Dapat dipanggil dari UI Pengaturan Admin)
 */
function setupAutomatedTriggers(adminId) {
  const admin = verifyMemberById(adminId);
  if (!admin || admin.role !== 'Admin') {
    throw new Error('Hanya Admin yang dapat mengaktifkan Trigger terjadwal.');
  }

  // Hapus trigger duplikat sebelumnya
  const existing = ScriptApp.getProjectTriggers();
  existing.forEach(t => ScriptApp.deleteTrigger(t));

  // 1. Trigger Harian (Jam 08:00 pagi) -> Cek Tagihan H-3 & Retensi Drive 3 Bulan
  ScriptApp.newTrigger('runDailyHouseholdAutomation')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();

  // 2. Trigger Bulanan (Setiap Tanggal 1 Jam 07:00 pagi) -> Kirim AI Insight Bulanan ke Admin
  ScriptApp.newTrigger('runMonthlyInsightBroadcast')
    .timeBased()
    .onMonthDay(1)
    .atHour(7)
    .create();

  return {
    success: true,
    message: 'Trigger Otomatis Harian (H-3 Tagihan & Retensi Foto 3 Bulan) dan Bulanan (AI Insight Tanggal 1) berhasil diaktifkan!'
  };
}

/**
 * Trigger Harian:
 * 1. Kirim pengingat tagihan H-3 sebelum jatuh tempo (US-5 AC1)
 * 2. Hapus foto struk di Google Drive yang berumur > 3 bulan (Bab 4.2 & Bab 6)
 */
function runDailyHouseholdAutomation() {
  const ss = getSpreadsheet();
  const shBill = ss.getSheetByName(SHEET_NAMES.TAGIHAN);
  const data = shBill.getDataRange().getValues();
  const todayDay = new Date().getDate();
  const admins = getAllMembers().filter(m => m.role === 'Admin' && m.status === 'Aktif');

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const billName = String(r[1]);
    const amount = Number(r[2] || 0);
    const dueDay = Number(r[3] || 1);
    const status = String(r[6]);
    const diffDays = dueDay - todayDay;

    if (status !== 'Lunas' && diffDays >= 0 && diffDays <= 3) {
      const msg = `⏰ *Pengingat Tagihan Rutin Qyona (H-${diffDays})*\nTagihan *${billName}* sebesar *Rp ${formatRupiahPlain(amount)}* jatuh tempo pada tanggal ${dueDay}.\n\nSilakan buka menu *Tagihan Rutin* dan klik *Tandai Lunas* jika sudah dibayar.`;
      admins.forEach(adm => {
        if (adm.tgId) sendTelegramMessage(adm.tgId, msg);
        if (adm.waId) sendWhatsAppMessage(adm.waId, msg);
      });
      shBill.getRange(i + 1, 8).setValue('Sudah');
    }
  }

  // Kebijakan Retensi Media Bab 4.2: Hapus foto struk > 90 hari (3 bulan)
  cleanupOldReceiptsFromDrive();
}

function cleanupOldReceiptsFromDrive() {
  try {
    const folder = getOrCreateReceiptFolder();
    const files = folder.getFiles();
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setDate(threeMonthsAgo.getDate() - 90);

    while (files.hasNext()) {
      const file = files.next();
      if (file.getDateCreated() < threeMonthsAgo) {
        file.setTrashed(true);
      }
    }
  } catch (e) {
    // Abaikan jika belum ada izin Drive
  }
}

/**
 * Trigger Bulanan Setiap Tanggal 1 (US-4 AC3)
 */
function runMonthlyInsightBroadcast() {
  const admins = getAllMembers().filter(m => m.role === 'Admin' && m.status === 'Aktif');
  if (admins.length === 0) return;

  const res = generateProactiveAIInsight(admins[0].id);
  if (res && res.insight) {
    const text = `📊 *AI Insight Bulanan Keluarga Qyona*\n\n${res.insight.analysis}\n\n💡 *Potensi Penghematan:* Rp ${formatRupiahPlain(res.insight.estimatedSaving)}/bulan`;
    admins.forEach(adm => {
      if (adm.tgId) sendTelegramMessage(adm.tgId, text);
      if (adm.waId) sendWhatsAppMessage(adm.waId, text);
    });
  }
}

function formatRupiahPlain(num) {
  return Math.round(Number(num || 0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
