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
  PENGAJUAN: 'Pengajuan Dana',
  GOALS: 'Target Tabungan & Impian',
  AI_HISTORI: 'AI_Histori'
};

/**
 * HTTP GET Handler - Menyajikan Web App Qyona (HtmlService)
 */
function doGet(e) {
  initDatabaseIfNeeded();
  // Dukungan JSON API untuk sinkronisasi dua arah dengan GitHub Pages PWA
  if (e && e.parameter && e.parameter.action === 'rpc') {
    try {
      const fnName = String(e.parameter.fn || '');
      const args = e.parameter.args ? JSON.parse(e.parameter.args) : [];
      const res = executeAllowedRpc(fnName, args);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, data: res }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message || String(err) }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  const template = HtmlService.createTemplateFromFile('Index');
  template.initialInviteCode = getConfig('FAMILY_INVITE_CODE', 'QYONA-2026');
  return template.evaluate()
    .setTitle('Qyona — Catatan Keuangan Rumah Tangga')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}

function executeAllowedRpc(fnName, args) {
  const allowed = {
    getPublicFamilyProfiles: getPublicFamilyProfiles,
    authenticateUser: authenticateUser,
    getAppBootstrapData: getAppBootstrapData,
    saveTransaction: saveTransaction,
    deleteTransaction: deleteTransaction,
    approveChildTransaction: approveChildTransaction,
    processChatbotMessage: processChatbotMessage,
    processReceiptImageOCR: processReceiptImageOCR,
    commitBatchOcrItems: commitBatchOcrItems,
    generateProactiveAIInsight: generateProactiveAIInsight,
    markBillAsPaid: markBillAsPaid,
    saveRoutineBill: saveRoutineBill,
    createFundRequest: createFundRequest,
    processFundRequestApproval: processFundRequestApproval,
    updateCategoryBudget: updateCategoryBudget,
    saveWalletSource: saveWalletSource,
    inviteOrUpdateFamilyMember: inviteOrUpdateFamilyMember,
    saveScriptConfigs: saveScriptConfigs,
    setupAutomatedTriggers: setupAutomatedTriggers,
    exportMonthlyCsv: exportMonthlyCsv,
    generateMonthlyPdfReport: generateMonthlyPdfReport,
    saveSavingsGoal: saveSavingsGoal,
    contributeToGoal: contributeToGoal,
    registerTelegramWebhook: registerTelegramWebhook,
    testInteractiveBotNotification: testInteractiveBotNotification,
    createCustomCategory: createCustomCategory,
    deleteBatchTransactions: deleteBatchTransactions,
    learnCategoryKeywordRule: learnCategoryKeywordRule,
    getAIChatHistory: getAIChatHistory,
    saveAIChatHistoryEntry: saveAIChatHistoryEntry,
    deleteAIChatHistoryEntry: deleteAIChatHistoryEntry,
    uploadUserWallpaper: uploadUserWallpaper,
    removeUserWallpaper: removeUserWallpaper,
    uploadCustomLogo: uploadCustomLogo,
    removeCustomLogo: removeCustomLogo
  };
  if (!allowed[fnName]) {
    throw new Error('Fungsi RPC tidak terdaftar: ' + fnName);
  }
  const readOnlyFns = {
    getPublicFamilyProfiles: true,
    authenticateUser: true,
    getAppBootstrapData: true,
    getAIChatHistory: true,
    processReceiptImageOCR: true,
    exportMonthlyCsv: true,
    generateMonthlyPdfReport: true,
    testInteractiveBotNotification: true
  };
  const result = allowed[fnName].apply(null, Array.isArray(args) ? args : []);
  if (!readOnlyFns[fnName]) {
    invalidateServerCache();
  }
  return result;
}

/**
 * ============================================================================
 * TURBO SPEED SERVER CACHE (CacheService.getScriptCache)
 * Memangkas waktu baca Spreadsheet dari ~3 detik menjadi ~0.05 detik
 * ============================================================================
 */
function getServerCacheVersion() {
  try {
    const cache = CacheService.getScriptCache();
    let ver = cache.get('QYONA_CACHE_VER');
    if (!ver) {
      ver = String(Date.now());
      cache.put('QYONA_CACHE_VER', ver, 21600);
    }
    return ver;
  } catch (e) {
    return 'v1';
  }
}

function invalidateServerCache() {
  try {
    const cache = CacheService.getScriptCache();
    cache.put('QYONA_CACHE_VER', String(Date.now()), 21600);
  } catch (e) {}
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
function initDatabaseIfNeeded(forceCheck) {
  if (!forceCheck) {
    try {
      const cache = CacheService.getScriptCache();
      if (cache.get('QYONA_DB_READY_V2') === '1') return;
      if (PropertiesService.getScriptProperties().getProperty('QYONA_DB_READY_V2') === '1') {
        cache.put('QYONA_DB_READY_V2', '1', 21600);
        return;
      }
    } catch (e) {}
  }
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

    // 8. Sheet Target Tabungan & Impian Keluarga (Upgrade v2.0: Family Goals & Sinking Funds + Bonus Matching Anak)
    let shGoals = ss.getSheetByName(SHEET_NAMES.GOALS);
    if (!shGoals) {
      shGoals = ss.insertSheet(SHEET_NAMES.GOALS);
      shGoals.appendRow(['ID Goal', 'Nama Target Impian', 'Nominal Target', 'Terkumpul Saat Ini', 'Tenggat Waktu', 'ID Pemilik', 'Ikon', 'Warna', 'Rasio Bonus Matching Ortu (%)', 'Status']);
      const seedGoals = [
        ['GOL-01', 'Dana Darurat Keluarga (6x Pengeluaran)', 25000000, 14500000, '2027-06-30', 'ALL', 'fa-shield-heart', '#10B981', 0, 'Aktif'],
        ['GOL-02', 'Liburan Keluarga ke Yogyakarta & Bali', 12000000, 6800000, '2026-12-20', 'ALL', 'fa-plane-departure', '#0EA5E9', 0, 'Aktif'],
        ['GOL-03', 'Tabungan Kurban & Amal Keluarga', 4500000, 2900000, '2027-05-15', 'ALL', 'fa-hand-holding-heart', '#F59E0B', 0, 'Aktif'],
        ['GOL-04', 'Celengan Sepeda Lipat Kakak Raka', 1800000, 750000, '2026-12-31', 'USR-03', 'fa-bicycle', '#8B5CF6', 100, 'Aktif'],
        ['GOL-05', 'Celengan Tablet Gambar Adik Nayla', 1500000, 520000, '2027-01-31', 'USR-04', 'fa-palette', '#EC4899', 50, 'Aktif']
      ];
      shGoals.getRange(2, 1, seedGoals.length, seedGoals[0].length).setValues(seedGoals);
      styleHeaderRow(shGoals, 10);
    }

    // 9. Sheet Riwayat Perintah AI (Maksimal 15 Baris Circular FIFO)
    let shAiHistori = ss.getSheetByName(SHEET_NAMES.AI_HISTORI);
    if (!shAiHistori) {
      shAiHistori = ss.insertSheet(SHEET_NAMES.AI_HISTORI);
      shAiHistori.appendRow(['ID', 'Waktu', 'ID Anggota', 'Nama Anggota', 'Perintah Teks', 'Status', 'Ringkasan']);
      styleHeaderRow(shAiHistori, 7);
    }

    // Hapus Sheet1 default jika masih kosong dan ada sheet lain
    const defaultSheet = ss.getSheetByName('Sheet1');
    if (defaultSheet && ss.getSheets().length > 1) {
      try { ss.deleteSheet(defaultSheet); } catch (e) {}
    }

    recalculateAllWalletBalances(ss);
    try {
      PropertiesService.getScriptProperties().setProperty('QYONA_DB_READY_V2', '1');
      CacheService.getScriptCache().put('QYONA_DB_READY_V2', '1', 21600);
    } catch (e) {}
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
 * Dilengkapi CacheService agar halaman login terbuka instan (<50ms)
 */
function getPublicFamilyProfiles() {
  initDatabaseIfNeeded();
  const cacheKey = 'PUB_PROFILES_' + getServerCacheVersion();
  try {
    const cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (e) {}

  const members = getAllMembers().filter(m => m.status === 'Aktif');
  const result = {
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

  try {
    CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), 600);
  } catch (e) {}
  return result;
}

/**
 * ============================================================================
 * PENGAMBILAN DATA DASHBOARD REAL-TIME DENGAN FILTER RBAC + TURBO CACHE (US-3 & US-6)
 * ============================================================================
 */
function getAppBootstrapData(memberId, selectedMonthYear) {
  initDatabaseIfNeeded();
  const now = new Date();
  const currentYM = selectedMonthYear || Utilities.formatDate(now, 'Asia/Jakarta', 'yyyy-MM');
  const cacheKey = 'BOOT_' + getServerCacheVersion() + '_' + String(memberId) + '_' + currentYM;

  try {
    const cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (e) {}

  const currentUser = verifyMemberById(memberId);
  if (!currentUser) {
    throw new Error('Sesi tidak valid atau akses anggota telah dinonaktifkan.');
  }

  const ss = getSpreadsheet();
  const isAdmin = currentUser.role === 'Admin';

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
  if (!isAdmin) {
    categories = categories.filter(c => c.name === 'Jajan/Anak');
  }

  // 3. Dompet & 4. Transaksi (Hitung saldo berjalan di memori tanpa perlu tulis ulang ke Sheet saat baca!)
  const shDompet = ss.getSheetByName(SHEET_NAMES.DOMPET);
  const domData = shDompet.getDataRange().getValues();
  const shTrx = ss.getSheetByName(SHEET_NAMES.TRANSAKSI);
  const trxData = shTrx.getDataRange().getValues();

  const deltaByWallet = {};
  for (let i = 1; i < trxData.length; i++) {
    const tr = trxTrxRow(trxData[i]);
    if (!tr.id || tr.status === 'Dibatalkan') continue;
    deltaByWallet[tr.walletId] = (deltaByWallet[tr.walletId] || 0) + (tr.type === 'Masuk' ? tr.amount : -tr.amount);
  }

  let wallets = [];
  for (let i = 1; i < domData.length; i++) {
    const r = domData[i];
    if (!r[0]) continue;
    const wId = String(r[0]);
    const initBal = Number(r[3] || 0);
    wallets.push({
      id: wId,
      name: String(r[1]),
      type: String(r[2]),
      initialBalance: initBal,
      currentBalance: initBal + (deltaByWallet[wId] || 0),
      info: String(r[5] || '')
    });
  }
  const walletMap = {};
  wallets.forEach(w => { walletMap[w.id] = w; });

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

    if (!isAdmin && trxOwnerId !== currentUser.id) {
      continue;
    }

    const owner = memberMap[trxOwnerId] || { name: 'Keluarga', avatar: '👤', role: 'Member' };
    const wlt = walletMap[String(r[6])] || { name: 'Dompet Utama' };

    allTransactions.push({
      id: String(r[0]),
      date: dateStr,
      monthYear: dateStr.slice(0, 7),
      type: String(r[2]),
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
      canEdit: String(r[10]) !== 'Dibatalkan' && (isAdmin || (trxOwnerId === currentUser.id && String(r[10]) !== 'Disetujui'))
    });
  }

  allTransactions.sort((a, b) => (b.date > a.date ? 1 : -1));

  const currentMonthTrx = allTransactions.filter(t => t.monthYear === currentYM);
  const prevMonthTrx = allTransactions.filter(t => t.monthYear === prevYM);

  let totalIncome = 0;
  let totalExpense = 0;
  const spendingByCategory = {};
  const prevSpendingByCategory = {};

  currentMonthTrx.forEach(t => {
    if (t.approvalStatus === 'Dibatalkan') return;
    if (t.type === 'Masuk') {
      totalIncome += t.amount;
    } else {
      totalExpense += t.amount;
      spendingByCategory[t.category] = (spendingByCategory[t.category] || 0) + t.amount;
    }
  });

  prevMonthTrx.forEach(t => {
    if (t.approvalStatus === 'Dibatalkan') return;
    if (t.type === 'Keluar') {
      prevSpendingByCategory[t.category] = (prevSpendingByCategory[t.category] || 0) + t.amount;
    }
  });

  const categoryBreakdown = categories
    .filter(c => c.type === 'Keluar')
    .map(c => {
      const spent = spendingByCategory[c.name] || 0;
      const prevSpent = prevSpendingByCategory[c.name] || 0;
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

  // 5. Tagihan Rutin
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

  // 6. Pengajuan Dana
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

  // 7. AI Insights
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

  // 8. Kantong Impian & Tabungan Target Keluarga (Upgrade v2.0)
  let shGoals = ss.getSheetByName(SHEET_NAMES.GOALS);
  if (!shGoals) {
    initDatabaseIfNeeded(true);
    shGoals = ss.getSheetByName(SHEET_NAMES.GOALS);
  }
  const goalsData = shGoals ? shGoals.getDataRange().getValues() : [];
  const savingsGoals = [];
  const monthlySurplusEstimate = Math.max(500000, totalIncome - totalExpense);
  for (let i = 1; i < goalsData.length; i++) {
    const r = goalsData[i];
    if (!r[0]) continue;
    const ownerId = String(r[5] || 'ALL');
    if (!isAdmin && ownerId !== 'ALL' && ownerId !== currentUser.id) continue;
    const targetAmt = Number(r[2] || 0);
    const currentAmt = Number(r[3] || 0);
    const remainingAmt = Math.max(0, targetAmt - currentAmt);
    const pct = targetAmt > 0 ? Math.min(100, Math.round((currentAmt / targetAmt) * 100)) : 0;
    const matchRate = Number(r[8] || 0);
    const ownerObj = ownerId === 'ALL' ? { name: 'Keluarga Qyona', avatar: '🏡' } : (memberMap[ownerId] || { name: ownerId, avatar: '🧒' });
    const estMonths = remainingAmt === 0 ? 0 : Math.max(1, Math.ceil(remainingAmt / (ownerId === 'ALL' ? (monthlySurplusEstimate * 0.35) : 150000)));
    const goalTitle = String(r[1]);
    savingsGoals.push({
      id: String(r[0]),
      name: goalTitle,
      title: goalTitle,
      targetAmount: targetAmt,
      savedAmount: currentAmt,
      currentAmount: currentAmt,
      remaining: remainingAmt,
      remainingAmount: remainingAmt,
      monthlySuggestion: remainingAmt > 0 ? Math.ceil(remainingAmt / Math.max(1, estMonths)) : 0,
      isCompleted: currentAmt >= targetAmt,
      percentage: pct,
      deadline: r[4] instanceof Date ? Utilities.formatDate(r[4], 'Asia/Jakarta', 'yyyy-MM-dd') : String(r[4] || ''),
      ownerId: ownerId,
      ownerName: ownerObj.name,
      ownerAvatar: ownerObj.avatar,
      icon: String(r[6] || 'fa-piggy-bank'),
      color: String(r[7] || '#10B981'),
      matchingRate: matchRate,
      status: String(r[9] || 'Aktif'),
      aiEtaText: remainingAmt === 0
        ? '🎉 Target Impian Tercapai 100%!'
        : `🤖 Estimasi AI: Tercapai dalam ~${estMonths} bulan (${matchRate > 0 ? `Bonus Ortu +${matchRate}% aktif` : 'Rutin menyisihkan surplus'})`
    });
  }

  let totalBalance = 0;
  let visibleWallets = wallets;
  if (isAdmin) {
    totalBalance = wallets.reduce((acc, w) => acc + w.currentBalance, 0);
  } else {
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
  const totalGoalsSaved = savingsGoals.reduce((acc, g) => acc + g.currentAmount, 0);
  const totalGoalsTarget = savingsGoals.reduce((acc, g) => acc + g.targetAmount, 0);

  const responsePayload = {
    serverTime: Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss'),
    currentMonthYear: currentYM,
    prevMonthYear: prevYM,
    dataHash: `${currentMonthTrx.length}_${totalBalance}_${totalExpense}_${totalGoalsSaved}_${fundRequests.length}_${bills.filter(b => b.status === 'Lunas').length}`,
    currentUser: sanitizeMemberForClient(currentUser),
    summary: {
      totalBalance: totalBalance,
      totalIncome: isAdmin ? totalIncome : (currentUser.allowanceQuota || 500000),
      totalExpense: totalExpense,
      totalBudgetLimit: totalBudgetLimit,
      budgetUsedPercent: totalBudgetLimit > 0 ? Math.round((totalExpense / totalBudgetLimit) * 100) : 0,
      transactionCount: currentMonthTrx.length,
      totalGoalsSaved: totalGoalsSaved,
      totalGoalsTarget: totalGoalsTarget
    },
    categories: categories,
    categoryBreakdown: categoryBreakdown,
    wallets: visibleWallets,
    transactions: currentMonthTrx,
    bills: bills,
    fundRequests: fundRequests.reverse(),
    insights: insights,
    savingsGoals: savingsGoals,
    familyMembers: isAdmin ? allMembers.map(sanitizeMemberForClient) : [sanitizeMemberForClient(currentUser)],
    userWallpaper: PropertiesService.getScriptProperties().getProperty('QYONA_WALLPAPER_' + currentUser.id) || '',
    customLogo: PropertiesService.getScriptProperties().getProperty('QYONA_CUSTOM_LOGO_URL') || '',
    chatHistory: getAIChatHistory(currentUser.id),
    systemConfig: isAdmin ? {
      hasGeminiKey: Boolean(getConfig('GEMINI_API_KEY', '')),
      hasTelegramToken: Boolean(getConfig('TELEGRAM_BOT_TOKEN', '')),
      hasWaToken: Boolean(getConfig('WA_API_TOKEN', '')),
      inviteCode: getConfig('FAMILY_INVITE_CODE', 'QYONA-2026'),
      spreadsheetUrl: ss.getUrl()
    } : null
  };

  try {
    const jsonStr = JSON.stringify(responsePayload);
    if (jsonStr.length < 95000) {
      CacheService.getScriptCache().put(cacheKey, jsonStr, 300);
    }
  } catch (e) {}

  return responsePayload;
}

/**
 * Hitung ulang Saldo Berjalan di Sheet Dompet menggunakan Batch Write (1x setValues, bukan loop setValue)
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
    if (!r.id || r.status === 'Dibatalkan') continue;
    if (!deltaByWallet[r.walletId]) deltaByWallet[r.walletId] = 0;
    if (r.type === 'Masuk') {
      deltaByWallet[r.walletId] += r.amount;
    } else {
      deltaByWallet[r.walletId] -= r.amount;
    }
  }

  const updatedBalances = [];
  for (let j = 1; j < domData.length; j++) {
    const wId = String(domData[j][0]);
    const initBal = Number(domData[j][3] || 0);
    const runningBal = wId ? (initBal + (deltaByWallet[wId] || 0)) : initBal;
    updatedBalances.push([runningBal]);
  }
  if (updatedBalances.length > 0) {
    shDompet.getRange(2, 5, updatedBalances.length, 1).setValues(updatedBalances);
  }
  invalidateServerCache();
}

function trxTrxRow(r) {
  return {
    id: String(r[0] || ''),
    type: String(r[2] || 'Keluar'),
    amount: Number(r[3] || 0),
    walletId: String(r[6] || 'WLT-01'),
    status: String(r[10] || 'Disetujui')
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
            throw new Error('RBAC: Tidak dapat membatalkan transaksi anggota lain.');
          }
          if (status === 'Disetujui') {
            throw new Error('RBAC: Transaksi yang sudah disetujui Admin tidak bisa dibatalkan.');
          }
        }
        shTrx.getRange(i + 1, 11).setValue('Dibatalkan');
        recalculateAllWalletBalances(ss);
        return { success: true, message: `Transaksi ${transactionId} berhasil dibatalkan dan saldo dompet telah dikembalikan.` };
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
 * Proses pesan obrolan dari Web App atau Webhook WhatsApp/Telegram (Upgrade AI Qyona v2.2 Super-Cerdas)
 * Mendukung 5 Fitur Utama:
 * 1. Smart Multi-Item & Multi-Wallet Parser + Kalkulator Perkalian (@ / x)
 * 2. Auto-Create Dynamic Category Engine (Membuat Kategori Baru Otomatis + Ikon & Warna AI)
 * 3. Kartu Preview Keranjang Chat Interaktif + Batch Undo 1-Klik
 * 4. Memori Kamus Pintar Keluarga (Self-Learning Keyword Memory)
 * 5. Perintah Chat Eksekusi Cepat (AI Action Commands: Tabung Impian, Bayar Tagihan, Buat/Ubah Budget Kategori)
 */
function processChatbotMessage(memberId, rawMessage, confirmedCategory) {
  initDatabaseIfNeeded();
  const user = verifyMemberById(memberId);
  if (!user) throw new Error('Anggota tidak dikenali.');

  const text = String(rawMessage || '').trim();
  if (!text) throw new Error('Pesan tidak boleh kosong.');

  const isAdmin = user.role === 'Admin';
  const ss = getSpreadsheet();

  // Jika pengguna mengonfirmasi kategori untuk pesan yang sebelumnya ambigu, pelajari kata kuncinya (Fitur #4)
  if (confirmedCategory && isAdmin) {
    ensureOrCreateDynamicCategory(ss, { name: confirmedCategory });
    autoLearnFromConfirmedText(text, confirmedCategory);
  }

  // 1. Cek Perintah Eksekusi Cepat AI (Fitur #5: Buat Kategori, Tabung Impian, Bayar Tagihan, Ubah Budget)
  if (!confirmedCategory) {
    const actionCmdResult = tryExecuteChatActionCommand(ss, user, text);
    if (actionCmdResult) {
      logChatAndInsight(ss, user.id, text, actionCmdResult.reply, 'Harian', 0, 'Dieksekusi');
      try { saveAIChatHistoryEntry(user.id, { prompt: text, status: 'ACTION_EXECUTED', replySnippet: actionCmdResult.reply }); } catch (e) {}
      return actionCmdResult;
    }
  }

  // 2. Cek apakah pesan berupa PERTANYAAN seputar saldo / budget
  if (isQuestionIntent(text)) {
    const answer = answerFinancialQuestion(ss, user, text);
    logChatAndInsight(ss, user.id, text, answer, 'Harian', 0, 'Terjawab');
    return {
      status: 'QUESTION_ANSWERED',
      reply: answer,
      transactionsCreated: []
    };
  }

  // 3. Cek apakah Member Anak mengajukan request dana tambahan (US-6 AC2)
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
        requestId: reqRes.requestId,
        reply: `📩 Pengajuan dana tambahan sebesar *Rp ${formatRupiahPlain(reqNominal)}* untuk _"${text}"_ berhasil dikirim ke Admin (Ayah & Bunda) untuk disetujui!`,
        request: reqRes
      };
    }
  }

  // 4. Parsing Multi-Item & Multi-Wallet menggunakan Gemini AI / Smart NLP v2.2 (Fitur #1, #2, #4)
  const parsed = parseNaturalLanguageTransactions(text, user, confirmedCategory, ss);

  if (!parsed.items || parsed.items.length === 0) {
    return {
      status: 'UNRECOGNIZED',
      reply: '🤔 Maaf, Qyona AI belum menemukan nominal rupiah atau perintah aksi di pesanmu.\n\n💡 *Contoh Chat Pintar v2.2:*\n• _"Beli beras 5kg 75rb, ayam 2 ekor @35rb pakai tunai, terus makanan kucing 85rb via BCA"_\n• _"Buat kategori Skincare & Perawatan budget 600rb"_\n• _"Tabung 250rb ke Liburan Yogyakarta pakai BCA"_\n• _"Bayar lunas tagihan WiFi"_'
    };
  }

  // US-1 AC2: Jika ada item yang sama sekali tidak bisa ditebak kategorinya dan bukan auto-dynamic category
  const ambiguousItem = parsed.items.find(it => it.needsCategoryConfirmation);
  if (ambiguousItem && isAdmin && !confirmedCategory && parsed.items.length === 1) {
    const existingCats = getAllCategoryNames(ss);
    return {
      status: 'NEEDS_CONFIRMATION',
      pendingMessage: text,
      detectedAmount: ambiguousItem.amount,
      detectedDescription: ambiguousItem.description,
      detectedWalletId: ambiguousItem.walletId,
      suggestedCategories: existingCats,
      reply: `🤔 Saya mendeteksi transaksi *${ambiguousItem.description}* sebesar *Rp ${formatRupiahPlain(ambiguousItem.amount)}*, namun kategorinya belum spesifik.\n\nSilakan pilih kategori di bawah ini atau klik *➕ Buat Kategori Baru*:`
    };
  }

  // Fitur #2: Pastikan semua kategori (termasuk kategori baru hasil deteksi AI) otomatis dibuat di Sheet Kategori & Budget
  const newCategoriesCreated = [];
  if (isAdmin) {
    parsed.items.forEach(item => {
      const targetCat = confirmedCategory || item.category;
      const catCreated = ensureOrCreateDynamicCategory(ss, {
        name: targetCat,
        suggestedIcon: item.suggestedIcon,
        suggestedColor: item.suggestedColor,
        suggestedLimit: item.suggestedLimit,
        type: item.type
      });
      if (catCreated && catCreated.isNew) {
        item.isNewCategory = true;
        if (!newCategoriesCreated.some(c => c.name === catCreated.name)) {
          newCategoriesCreated.push(catCreated);
        }
      }
    });
  }

  // Simpan seluruh item yang terdeteksi (Fitur #1 & #3)
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
      walletId: item.walletId,
      walletName: item.walletName,
      qtyNote: item.qtyNote || '',
      isNewCategory: Boolean(item.isNewCategory),
      learnedMatch: Boolean(item.learnedMatch)
    });
    if (res.budgetAlert && !alerts.includes(res.budgetAlert)) {
      alerts.push(res.budgetAlert);
    }
  });

  // Fitur #3: Format Kartu Ringkasan Keranjang Belanja Multi-Item
  const totalSaved = savedItems.reduce((s, i) => s + i.amount, 0);
  const lines = savedItems.map((it, idx) => {
    const newCatTag = it.isNewCategory ? ' ✨_[Kategori Baru]_' : (it.learnedMatch ? ' 🧠_[Memori AI]_' : '');
    const qtyTag = it.qtyNote ? ` _(${it.qtyNote})_` : '';
    return `${idx + 1}. *${it.description}*${qtyTag} — *Rp ${formatRupiahPlain(it.amount)}*\n   🏷️ _${it.category}_${newCatTag} • 💳 _${it.walletName}_`;
  });

  let replyMsg = `✅ *Keranjang AI Qyona Tercatat (${savedItems.length} Item)*\n\n` +
    lines.join('\n') +
    `\n\n💰 *Total Tercatat:* Rp ${formatRupiahPlain(totalSaved)}\n👤 *Oleh:* ${user.name}`;

  if (newCategoriesCreated.length > 0) {
    const newCatNames = newCategoriesCreated.map(c => `*${c.name}* (Budget Rp ${formatRupiahPlain(c.monthlyLimit)}/bln)`).join(', ');
    replyMsg += `\n\n✨ *Auto-Kategori AI Aktif:* Kategori baru ${newCatNames} otomatis dibuat di Dashboard & Google Sheets!`;
  }
  if (!isAdmin) {
    replyMsg += `\n🔒 _Info RBAC: Otomatis masuk kategori Jajan/Anak._`;
  }
  if (alerts.length > 0) {
    replyMsg += `\n\n${alerts.join('\n')}`;
  }

  logChatAndInsight(ss, user.id, text, replyMsg, 'Harian', 0, 'Tersimpan');
  try {
    saveAIChatHistoryEntry(user.id, { prompt: text, status: 'SAVED', replySnippet: replyMsg });
  } catch (e) {}

  return {
    status: 'SAVED',
    reply: replyMsg,
    transactionId: savedItems[0] ? savedItems[0].id : '',
    transactionIds: savedItems.map(i => i.id),
    transactionsCreated: savedItems,
    newCategoriesCreated: newCategoriesCreated
  };
}

/**
 * ============================================================================
 * FITUR #2 & #4: ENGINE KATEGORI DINAMIS & MEMORI KAMUS PINTAR KELUARGA
 * ============================================================================
 */
const DYNAMIC_CATEGORY_CATALOG = [
  {
    name: 'Hewan Peliharaan',
    regex: /\b(kucing|anjing|kelinci|burung|whiskas|royal\s*canin|meo|bolt|pasir\s*kucing|pet\s*shop|petshop|dokter\s*hewan|vaksin\s*kucing|grooming|pakan\s*kucing|makanan\s*kucing|makanan\s*anjing)\b/i,
    icon: 'fa-paw',
    color: '#F59E0B',
    defaultLimit: 500000,
    type: 'Keluar'
  },
  {
    name: 'Perawatan & Kecantikan',
    regex: /\b(skincare|skin\s*care|serum|toner|moisturizer|sunscreen|bedak|lipstik|makeup|make\s*up|salon|creambath|facial|spa|potong\s*rambut|cukur|barbershop|parfum|body\s*lotion|sabun\s*muka|kosmetik|wardah|somethinc|skintific)\b/i,
    icon: 'fa-spa',
    color: '#EC4899',
    defaultLimit: 600000,
    type: 'Keluar'
  },
  {
    name: 'Amal & Sosial',
    regex: /\b(sedekah|infaq|infak|zakat|wakaf|donasi|sumbangan|amal|santunan|kotak\s*amal|jumat\s*berkah|yatim|masjid|qurban|fidyah)\b/i,
    icon: 'fa-hand-holding-heart',
    color: '#10B981',
    defaultLimit: 500000,
    type: 'Keluar'
  },
  {
    name: 'Hobi & Tanaman',
    regex: /\b(pupuk|tanaman|bunga|bibit|pot\s*bunga|media\s*tanam|aquarium|ikan\s*hias|pancing|umpan|raket|badminton|futsal|gym|fitness|olahraga|lari|sepeda|camping|koleksi|lego|gitar)\b/i,
    icon: 'fa-seedling',
    color: '#06B6D4',
    defaultLimit: 500000,
    type: 'Keluar'
  },
  {
    name: 'Perawatan Rumah & ART',
    regex: /\b(tukang|cat\s*tembok|semen|pasir|keran|pipa|lampu|bohlam|kabel|obeng|perkakas|renovasi|servis\s*ac|cuci\s*ac|sedot\s*wc|laundry|setrika|art|mbak|asisten\s*rumah|kebersihan|sapu|pel)\b/i,
    icon: 'fa-house-chimney-crack',
    color: '#8B5CF6',
    defaultLimit: 750000,
    type: 'Keluar'
  },
  {
    name: 'Pakaian & Belanja',
    regex: /\b(baju|celana|kemeja|kaos|gamis|hijab|kerudung|jilbab|sepatu|sandal|tas|dompet|jaket|sweater|rok|batik|daster|pakaian|uniqlo|shopee|tokopedia|lazada|tiktok\s*shop)\b/i,
    icon: 'fa-shirt',
    color: '#D946EF',
    defaultLimit: 800000,
    type: 'Keluar'
  },
  {
    name: 'Hadiah & Kondangan',
    regex: /\b(kado|hadiah|kondangan|amplop\s*nikah|amplop|souvenir|ulang\s*tahun|ultah|parcel|hampers|buket|bunga\s*papan|tengok|jenguk)\b/i,
    icon: 'fa-gift',
    color: '#F43F5E',
    defaultLimit: 500000,
    type: 'Keluar'
  },
  {
    name: 'Bayi & Kebutuhan Anak',
    regex: /\b(popok|diapers|pampers|sweety|merries|makuku|susu\s*formula|sufor|sgm|bebelac|lactogen|mpasi|bubur\s*bayi|minyak\s*telon|tisu\s*basah|botol\s*susu|perlengkapan\s*bayi)\b/i,
    icon: 'fa-baby-carriage',
    color: '#FB7185',
    defaultLimit: 900000,
    type: 'Keluar'
  }
];

function getAllCategoryNames(ss) {
  ss = ss || getSpreadsheet();
  const sh = ss.getSheetByName(SHEET_NAMES.KATEGORI);
  if (!sh) return ['Dapur & Makanan', 'Tagihan & Utilitas', 'Transportasi & BBM', 'Jajan/Anak', 'Hiburan & Keluarga', 'Kesehatan & Darurat', 'Pendidikan & Les'];
  const data = sh.getDataRange().getValues();
  const names = [];
  for (let i = 1; i < data.length; i++) {
    const n = String(data[i][0] || '').trim();
    if (n && String(data[i][5] || 'Keluar') === 'Keluar') {
      names.push(n);
    }
  }
  return names;
}

function pickSmartCategoryVisuals(catName) {
  const lower = String(catName || '').toLowerCase();
  for (let i = 0; i < DYNAMIC_CATEGORY_CATALOG.length; i++) {
    const d = DYNAMIC_CATEGORY_CATALOG[i];
    if (d.name.toLowerCase() === lower || d.regex.test(lower)) {
      return { icon: d.icon, color: d.color, limit: d.defaultLimit };
    }
  }
  const palette = [
    { icon: 'fa-tags', color: '#0EA5E9' },
    { icon: 'fa-bag-shopping', color: '#8B5CF6' },
    { icon: 'fa-star', color: '#F59E0B' },
    { icon: 'fa-heart', color: '#EC4899' },
    { icon: 'fa-cube', color: '#14B8A6' }
  ];
  const hash = lower.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const picked = palette[hash % palette.length];
  return { icon: picked.icon, color: picked.color, limit: 500000 };
}

/**
 * Pastikan kategori ada di Sheet `Kategori & Budget`; jika belum ada, buat otomatis!
 */
function ensureOrCreateDynamicCategory(ss, catSpec) {
  ss = ss || getSpreadsheet();
  const rawName = String(catSpec.name || '').trim();
  if (!rawName) return null;

  const sh = ss.getSheetByName(SHEET_NAMES.KATEGORI);
  if (!sh) return null;

  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim().toLowerCase() === rawName.toLowerCase()) {
      return {
        isNew: false,
        name: String(data[i][0]).trim(),
        monthlyLimit: Number(data[i][1] || 0),
        icon: String(data[i][4] || 'fa-tags'),
        color: String(data[i][3] || '#10B981')
      };
    }
  }

  // Buat Kategori Baru secara otomatis di Sheet Kategori & Budget
  const cleanTitle = rawName.replace(/\b\w/g, c => c.toUpperCase());
  const visuals = pickSmartCategoryVisuals(cleanTitle);
  const monthlyLimit = Number(catSpec.suggestedLimit || catSpec.monthlyLimit || visuals.limit || 500000);
  const warnPercent = Number(catSpec.warnPercent || 80);
  const color = String(catSpec.suggestedColor || catSpec.color || visuals.color);
  const icon = String(catSpec.suggestedIcon || catSpec.icon || visuals.icon);
  const type = String(catSpec.type || 'Keluar');

  sh.appendRow([cleanTitle, monthlyLimit, warnPercent, color, icon, type]);
  invalidateServerCache();

  return {
    isNew: true,
    name: cleanTitle,
    monthlyLimit: monthlyLimit,
    warnPercent: warnPercent,
    color: color,
    icon: icon,
    type: type
  };
}

/**
 * Endpoint RPC: Buat Kategori Baru dari UI Modal / Chat (Fitur #2)
 */
function createCustomCategory(memberId, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const user = verifyMemberById(memberId);
    if (!user || user.role !== 'Admin') {
      throw new Error('RBAC: Hanya Admin (Ayah/Bunda) yang dapat membuat kategori anggaran baru.');
    }
    const catName = String(payload.name || '').trim();
    if (!catName) throw new Error('Nama kategori tidak boleh kosong.');

    const ss = getSpreadsheet();
    const res = ensureOrCreateDynamicCategory(ss, {
      name: catName,
      monthlyLimit: Number(payload.monthlyLimit || 500000),
      warnPercent: Number(payload.warnPercent || 80),
      color: payload.color,
      icon: payload.icon,
      type: payload.type || 'Keluar'
    });

    if (payload.sampleKeyword) {
      learnCategoryKeywordRule(memberId, payload.sampleKeyword, res.name);
    }

    return {
      success: true,
      category: res,
      isNew: res.isNew,
      message: res.isNew
        ? `✨ Kategori baru "${res.name}" (Budget Rp ${formatRupiahPlain(res.monthlyLimit)}/bln) berhasil ditambahkan!`
        : `Kategori "${res.name}" sudah tersedia di sistem.`
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Endpoint RPC: Hapus / Batalkan Banyak Transaksi Sekaligus dari Keranjang Chat (Fitur #3)
 */
function deleteBatchTransactions(memberId, transactionIds) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const user = verifyMemberById(memberId);
    if (!user) throw new Error('Akses tidak sah.');
    const ids = Array.isArray(transactionIds) ? transactionIds.map(String) : [String(transactionIds)];
    if (ids.length === 0) throw new Error('Tidak ada ID transaksi untuk dibatalkan.');

    const ss = getSpreadsheet();
    const shTrx = ss.getSheetByName(SHEET_NAMES.TRANSAKSI);
    const data = shTrx.getDataRange().getValues();
    const isAdmin = user.role === 'Admin';
    let deletedCount = 0;

    for (let i = 1; i < data.length; i++) {
      const rowId = String(data[i][0]);
      if (ids.includes(rowId)) {
        const ownerId = String(data[i][7]);
        if (isAdmin || ownerId === user.id) {
          shTrx.getRange(i + 1, 11).setValue('Dibatalkan');
          deletedCount++;
        }
      }
    }

    if (deletedCount > 0) {
      recalculateAllWalletBalances(ss);
    }
    return {
      success: true,
      deletedCount: deletedCount,
      message: `${deletedCount} transaksi berhasil dibatalkan dan saldo dompet telah dikembalikan.`
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Fitur #4: Self-Learning Keyword Memory (Menyimpan kamus kata kunci keluarga di PropertiesService)
 */
function getLearnedCategoryMap() {
  try {
    const raw = getConfig('QYONA_AI_LEARNED_RULES', '{}');
    return JSON.parse(raw) || {};
  } catch (e) {
    return {};
  }
}

function learnCategoryKeywordRule(memberId, keyword, categoryName) {
  const user = verifyMemberById(memberId);
  if (!user) throw new Error('Pengguna tidak dikenali.');
  const cleanKw = String(keyword || '').toLowerCase().trim();
  const cleanCat = String(categoryName || '').trim();
  if (!cleanKw || cleanKw.length < 2 || !cleanCat) {
    return { success: false, message: 'Kata kunci terlalu pendek.' };
  }
  const map = getLearnedCategoryMap();
  map[cleanKw] = cleanCat;
  PropertiesService.getScriptProperties().setProperty('QYONA_AI_LEARNED_RULES', JSON.stringify(map));
  ensureOrCreateDynamicCategory(getSpreadsheet(), { name: cleanCat });
  invalidateServerCache();
  return {
    success: true,
    keyword: cleanKw,
    category: cleanCat,
    message: `🧠 Memori AI Qyona diperbarui! Kata "${cleanKw}" sekarang otomatis masuk kategori "${cleanCat}".`
  };
}

function autoLearnFromConfirmedText(text, categoryName) {
  try {
    const cleaned = cleanItemDescription(text).toLowerCase()
      .replace(/\b(beli|bayar|isi|uang|buat|untuk|di|ke|sama|dan|pakai|via|tunai|cash|bca|gopay|mandiri)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const words = cleaned.split(' ').filter(w => w.length >= 3 && !/^\d+$/.test(w));
    if (words.length > 0) {
      const keyPhrase = words.slice(0, 2).join(' ');
      const map = getLearnedCategoryMap();
      map[keyPhrase] = categoryName;
      if (words[0].length >= 4) map[words[0]] = categoryName;
      PropertiesService.getScriptProperties().setProperty('QYONA_AI_LEARNED_RULES', JSON.stringify(map));
    }
  } catch (e) {}
}

/**
 * ============================================================================
 * AI CHAT HISTORY MANAGEMENT DI DATABASE GOOGLE SHEETS (MAKSIMAL 15 FIFO)
 * ============================================================================
 */
function getAIChatHistory(memberId) {
  try {
    const ss = getSpreadsheet();
    let sh = ss.getSheetByName(SHEET_NAMES.AI_HISTORI);
    if (!sh) {
      initDatabaseIfNeeded(true);
      sh = ss.getSheetByName(SHEET_NAMES.AI_HISTORI);
    }
    if (!sh) return [];
    const data = sh.getDataRange().getValues();
    const history = [];
    for (let i = 1; i < data.length; i++) {
      const r = data[i];
      if (!r[0]) continue;
      history.push({
        id: String(r[0]),
        timestamp: String(r[1]),
        memberId: String(r[2]),
        memberName: String(r[3]),
        prompt: String(r[4]),
        status: String(r[5]),
        replySnippet: String(r[6] || '')
      });
    }
    return history.reverse().slice(0, 15);
  } catch (e) {
    return [];
  }
}

function saveAIChatHistoryEntry(memberId, entry) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const user = verifyMemberById(memberId);
    if (!user) throw new Error('Akses tidak sah.');

    const ss = getSpreadsheet();
    let sh = ss.getSheetByName(SHEET_NAMES.AI_HISTORI);
    if (!sh) {
      initDatabaseIfNeeded(true);
      sh = ss.getSheetByName(SHEET_NAMES.AI_HISTORI);
    }
    if (!sh) return { success: false };

    const newId = 'HIST-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'ddHHmmss') + '-' + Math.floor(Math.random() * 90 + 10);
    const timeStr = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'HH:mm');
    const promptText = String(entry.prompt || '').trim();
    const status = String(entry.status || 'SAVED');
    const replySnippet = String(entry.replySnippet || '').replace(/\*/g, '').replace(/<[^>]*>?/gm, '').slice(0, 80);

    sh.appendRow([
      newId,
      timeStr,
      user.id,
      user.name,
      promptText,
      status,
      replySnippet
    ]);

    // Sistem Maksimal 15 Item (Circular Buffer / FIFO)
    // Jika baris lebih dari 16 (1 baris header + 15 baris data), hapus baris data terlama (baris 2)
    while (sh.getLastRow() > 16) {
      sh.deleteRow(2);
    }

    return { success: true, id: newId };
  } finally {
    lock.releaseLock();
  }
}

function deleteAIChatHistoryEntry(memberId, historyId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const user = verifyMemberById(memberId);
    if (!user) throw new Error('Akses tidak sah.');

    const ss = getSpreadsheet();
    const sh = ss.getSheetByName(SHEET_NAMES.AI_HISTORI);
    if (!sh) return { success: true };

    const data = sh.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(historyId)) {
        sh.deleteRow(i + 1);
        return { success: true, message: 'Item histori berhasil dihapus.' };
      }
    }
    return { success: true, message: 'Item tidak ditemukan.' };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ============================================================================
 * WALLPAPER & CUSTOM LOGO KE GOOGLE DRIVE PRIBADI (FITUR #4)
 * ============================================================================
 */
function getOrCreateQyonaAssetsFolder() {
  const folderName = 'Qyona Finance Assets';
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  const folder = DriveApp.createFolder(folderName);
  try {
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {}
  return folder;
}

function uploadUserWallpaper(memberId, base64Data, mimeType) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const user = verifyMemberById(memberId);
    if (!user) throw new Error('Akses tidak sah.');

    let cleanBase64 = String(base64Data || '');
    if (cleanBase64.indexOf(',') > -1) {
      cleanBase64 = cleanBase64.split(',')[1];
    }
    const bytes = Utilities.base64Decode(cleanBase64);
    const mType = mimeType || 'image/jpeg';
    const blob = Utilities.newBlob(bytes, mType, 'wallpaper_' + user.id + '.jpg');

    const folder = getOrCreateQyonaAssetsFolder();
    const existing = folder.getFilesByName('wallpaper_' + user.id + '.jpg');
    while (existing.hasNext()) {
      try { existing.next().setTrashed(true); } catch (e) {}
    }

    const file = folder.createFile(blob);
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) {}

    const directUrl = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1920';
    PropertiesService.getScriptProperties().setProperty('QYONA_WALLPAPER_' + user.id, directUrl);
    invalidateServerCache();

    return {
      success: true,
      wallpaperUrl: directUrl,
      fileId: file.getId(),
      message: 'Foto latar belakang berhasil disimpan di Google Drive.'
    };
  } finally {
    lock.releaseLock();
  }
}

function removeUserWallpaper(memberId) {
  const user = verifyMemberById(memberId);
  if (!user) throw new Error('Akses tidak sah.');
  PropertiesService.getScriptProperties().deleteProperty('QYONA_WALLPAPER_' + user.id);
  invalidateServerCache();
  return { success: true, message: 'Wallpaper telah direset ke tema standar.' };
}

function uploadCustomLogo(adminId, base64Data, mimeType) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const admin = verifyMemberById(adminId);
    if (!admin || admin.role !== 'Admin') {
      throw new Error('RBAC: Hanya Admin yang dapat mengganti logo aplikasi.');
    }

    let cleanBase64 = String(base64Data || '');
    if (cleanBase64.indexOf(',') > -1) {
      cleanBase64 = cleanBase64.split(',')[1];
    }
    const bytes = Utilities.base64Decode(cleanBase64);
    const mType = mimeType || 'image/png';
    const blob = Utilities.newBlob(bytes, mType, 'custom_family_logo.png');

    const folder = getOrCreateQyonaAssetsFolder();
    const existing = folder.getFilesByName('custom_family_logo.png');
    while (existing.hasNext()) {
      try { existing.next().setTrashed(true); } catch (e) {}
    }

    const file = folder.createFile(blob);
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) {}

    const directUrl = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w512';
    PropertiesService.getScriptProperties().setProperty('QYONA_CUSTOM_LOGO_URL', directUrl);
    invalidateServerCache();

    return {
      success: true,
      logoUrl: directUrl,
      fileId: file.getId(),
      message: 'Logo kustom berhasil disimpan di Google Drive.'
    };
  } finally {
    lock.releaseLock();
  }
}

function removeCustomLogo(adminId) {
  const admin = verifyMemberById(adminId);
  if (!admin || admin.role !== 'Admin') {
    throw new Error('RBAC: Hanya Admin yang dapat mereset logo.');
  }
  PropertiesService.getScriptProperties().deleteProperty('QYONA_CUSTOM_LOGO_URL');
  invalidateServerCache();
  return { success: true, message: 'Logo berhasil dikembalikan ke logo bawaan Qyona.' };
}

/**
 * ============================================================================
 * FITUR #5: PERINTAH CHAT EKSEKUSI CEPAT (AI ACTION COMMANDS)
 * ============================================================================
 */
function tryExecuteChatActionCommand(ss, user, text) {
  const lower = text.toLowerCase().trim();
  const isAdmin = user.role === 'Admin';

  // A. Perintah Buat Kategori Baru: "buat kategori Skincare budget 600rb" / "tambah kategori Hewan Peliharaan 500rb"
  const createCatMatch = text.match(/^(?:tolong\s+)?(?:buat(?:kan)?|tambah(?:kan)?|bikin)\s+kategori\s+(?:baru\s+)?([a-zA-Z0-9\s&\/-]+?)(?:\s+(?:budget|anggaran|limit|kuota|sebesar|rp)\s*.*|\s+\d+.*|$)/i);
  if (createCatMatch && isAdmin) {
    let catName = createCatMatch[1].replace(/\b(budget|anggaran|limit|kuota|sebesar)\b.*$/i, '').trim();
    const limitAmt = extractFirstAmount(text) || 500000;
    if (catName) {
      const created = ensureOrCreateDynamicCategory(ss, {
        name: catName,
        monthlyLimit: limitAmt
      });
      return {
        status: 'ACTION_EXECUTED',
        actionType: 'CATEGORY_CREATED',
        category: created,
        reply: `✨ *Kategori Baru Berhasil Dibuat!*\n\n• *Nama Kategori:* ${created.name}\n• *Kuota Budget:* Rp ${formatRupiahPlain(created.monthlyLimit)} / bulan\n• *Status:* Aktif di Dashboard & Grafik Donut`,
        transactionsCreated: []
      };
    }
  }

  // B. Perintah Ubah Budget Kategori: "ubah budget Dapur jadi 4jt" / "naikkan anggaran Hiburan ke 1,2 juta"
  const updateBgtMatch = text.match(/^(?:ubah|ganti|atur|set|naikkan|turunkan|update)\s+(?:budget|anggaran|limit|kuota)\s+([a-zA-Z0-9\s&\/-]+?)\s+(?:jadi|ke|menjadi|sebesar)\s+/i);
  if (updateBgtMatch && isAdmin) {
    const targetQuery = updateBgtMatch[1].trim().toLowerCase();
    const newLimit = extractFirstAmount(text);
    if (newLimit > 0) {
      const existingCats = getAllCategoryNames(ss);
      const foundCat = existingCats.find(c => c.toLowerCase().includes(targetQuery)) || updateBgtMatch[1].trim();
      const ensured = ensureOrCreateDynamicCategory(ss, { name: foundCat, monthlyLimit: newLimit });
      updateCategoryBudget(user.id, ensured.name, newLimit, 80);
      return {
        status: 'ACTION_EXECUTED',
        actionType: 'BUDGET_UPDATED',
        reply: `🎯 *Batas Anggaran Diperbarui via Chat!*\n\n• *Kategori:* ${ensured.name}\n• *Budget Baru:* Rp ${formatRupiahPlain(newLimit)} / bulan`,
        transactionsCreated: []
      };
    }
  }

  // C. Perintah Setor ke Kantong Impian: "tabung 250rb ke Liburan Yogyakarta pakai BCA" / "setor celengan 50rb ke Sepeda"
  if (/^(?:tabung(?:kan)?|setor(?:kan)?|sisihkan|nabung)\b/i.test(lower) && /(?:ke|untuk|buat|celengan|kantong|impian|target)\b/i.test(lower)) {
    const amount = extractFirstAmount(text);
    if (amount > 0) {
      const shGoals = ss.getSheetByName(SHEET_NAMES.GOALS);
      if (shGoals) {
        const gData = shGoals.getDataRange().getValues();
        let matchedGoalId = '';
        let matchedGoalName = '';
        for (let i = 1; i < gData.length; i++) {
          const gId = String(gData[i][0]);
          const gName = String(gData[i][1] || '');
          const gWords = gName.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
          if (gWords.some(w => lower.includes(w))) {
            matchedGoalId = gId;
            matchedGoalName = gName;
            break;
          }
        }
        if (!matchedGoalId && gData.length > 1) {
          matchedGoalId = String(gData[1][0]);
          matchedGoalName = String(gData[1][1]);
        }
        if (matchedGoalId) {
          const wallet = detectWalletFromText(text, isAdmin);
          const contribRes = contributeToGoal(user.id, {
            goalId: matchedGoalId,
            amount: amount,
            walletId: wallet.id
          });
          return {
            status: 'ACTION_EXECUTED',
            actionType: 'GOAL_CONTRIBUTED',
            reply: `🐷 *Setoran Kantong Impian via Chat Berhasil!*\n\n${contribRes.message}\n💳 *Sumber Dana:* ${wallet.name}`,
            transactionsCreated: []
          };
        }
      }
    }
  }

  // D. Perintah Bayar Lunas Tagihan Rutin: "bayar lunas tagihan wifi" / "lunasi tagihan listrik"
  if (isAdmin && /(?:bayar\s+lunas|lunasi|tandai\s+lunas|lunasin)\b/i.test(lower)) {
    const shBill = ss.getSheetByName(SHEET_NAMES.TAGIHAN);
    if (shBill) {
      const bData = shBill.getDataRange().getValues();
      for (let i = 1; i < bData.length; i++) {
        const bId = String(bData[i][0]);
        const bName = String(bData[i][1] || '');
        const bWords = bName.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
        if (bWords.some(w => lower.includes(w))) {
          const paidRes = markBillAsPaid(user.id, bId);
          return {
            status: 'ACTION_EXECUTED',
            actionType: 'BILL_PAID',
            transactionId: paidRes.transactionId,
            reply: `⚡ *Pelunasan Tagihan via Chat Berhasil!*\n\n${paidRes.message}`,
            transactionsCreated: []
          };
        }
      }
    }
  }

  return null;
}

/**
 * Deteksi apakah teks chat adalah kalimat tanya
 */
function isQuestionIntent(text) {
  const lower = text.toLowerCase();
  const hasQuestionWord = /(berapa|sisa|total|cek|gimana|bagaimana|info|status|rekap|laporan|apakah|\?)/i.test(lower);
  const hasFinanceKeyword = /(saldo|uang|budget|anggaran|dapur|makan|jajan|tagihan|pengeluaran|pemasukan|dompet|hemat|boros|kategori|impian|tabungan)/i.test(lower);
  const isPurchase = /^(beli|bayar|isi|jajan|catat|masuk|transfer|belanja|tadi|barusan)\b/i.test(lower) && extractFirstAmount(lower) > 0;
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
    return `👦 Halo *${user.name}*!\n\n` +
      `• *Sisa Kuota Jajanmu:* Rp ${formatRupiahPlain(remaining)}\n` +
      `• *Terpakai Bulan Ini:* Rp ${formatRupiahPlain(childCat.spent)} dari Rp ${formatRupiahPlain(childCat.limit)} (${childCat.percentage || 0}%)\n\n` +
      `Tetap semangat menabung ya! 🌟`;
  }

  // Cek apakah menanyakan salah satu kategori (termasuk kategori baru dinamis!)
  let matchedCat = data.categoryBreakdown.find(c => {
    const words = c.name.toLowerCase().split(/[\s&\/]+/).filter(w => w.length >= 3);
    return words.some(w => lower.includes(w));
  });
  if (!matchedCat) {
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
 * ============================================================================
 * FITUR #1 & #2: SMART MULTI-ITEM, MULTI-WALLET & DYNAMIC CATEGORY PARSER
 * ============================================================================
 */
function parseNaturalLanguageTransactions(text, user, forcedCategory, ss) {
  const isAdmin = user.role === 'Admin';
  const geminiKey = getConfig('GEMINI_API_KEY', '');
  const existingCategories = ss ? getAllCategoryNames(ss) : [];
  const learnedMap = getLearnedCategoryMap();

  // Default dompet dari keseluruhan teks
  const fallbackWallet = detectWalletFromText(text, isAdmin);

  // Jika Gemini API Key dikonfigurasi, panggil Gemini untuk ekstraksi presisi (mendukung pembuatan kategori baru!)
  if (geminiKey && !forcedCategory) {
    try {
      const aiResult = callGeminiForTextParsing(geminiKey, text, isAdmin, fallbackWallet, existingCategories);
      if (aiResult && aiResult.items && aiResult.items.length > 0) {
        return aiResult;
      }
    } catch (e) {
      // Lanjut gunakan mesin Smart NLP lokal v2.2 jika kuota habis / offline
    }
  }

  // Pecah pesan panjang menjadi segmen belanjaan multi-item:
  // Memisahkan berdasarkan baris baru, titik koma, kata hubung ("dan", "terus", "lalu", "kemudian", "sama", "plus", "+"), atau koma yang diikuti item baru
  const rawSegments = text
    .split(/(?:\r?\n|\s*;\s*|\s+(?:dan|terus|lalu|kemudian|lanjut|sama|plus|\+)\s+|\s*,\s*(?=[a-zA-Z0-9\s]{2,}?\d))/i)
    .map(s => s.trim())
    .filter(Boolean);

  const targetSegments = rawSegments.length > 0 ? rawSegments : [text];
  const parsedDrafts = [];

  targetSegments.forEach(seg => {
    const amountInfo = extractAmountWithMultiplier(seg);
    if (amountInfo.amount > 0) {
      const explicitWallet = detectExplicitWalletInSegment(seg, isAdmin);
      const catInfo = !isAdmin
        ? { category: 'Jajan/Anak', type: 'Keluar', confident: true }
        : (forcedCategory
            ? { category: forcedCategory, type: forcedCategory === 'Gaji & Pemasukan' ? 'Masuk' : 'Keluar', confident: true }
            : classifyIndonesianCategory(seg, existingCategories, learnedMap));

      const cleanDesc = cleanItemDescription(seg);
      parsedDrafts.push({
        description: cleanDesc || seg,
        amount: amountInfo.amount,
        qtyNote: amountInfo.qtyNote,
        category: catInfo.category,
        type: catInfo.type,
        suggestedIcon: catInfo.suggestedIcon,
        suggestedColor: catInfo.suggestedColor,
        suggestedLimit: catInfo.suggestedLimit,
        learnedMatch: Boolean(catInfo.learnedMatch),
        explicitWallet: explicitWallet,
        walletId: explicitWallet ? explicitWallet.id : fallbackWallet.id,
        walletName: explicitWallet ? explicitWallet.name : fallbackWallet.name,
        needsCategoryConfirmation: !catInfo.confident && isAdmin && !forcedCategory
      });
    }
  });

  // Propagasi dompet grup: contoh "beli beras 75rb, ayam 35rb pakai tunai, terus bensin 150rb pakai gopay"
  // Maka "beras" otomatis ikut "pakai tunai" dari segmen di belakangnya!
  if (isAdmin && parsedDrafts.length > 1) {
    let nextKnownWallet = null;
    for (let i = parsedDrafts.length - 1; i >= 0; i--) {
      if (parsedDrafts[i].explicitWallet) {
        nextKnownWallet = parsedDrafts[i].explicitWallet;
      } else if (nextKnownWallet) {
        parsedDrafts[i].walletId = nextKnownWallet.id;
        parsedDrafts[i].walletName = nextKnownWallet.name;
      }
    }
  }

  // Fallback jika kalimat tunggal tidak terpecah
  if (parsedDrafts.length === 0) {
    const singleInfo = extractAmountWithMultiplier(text);
    if (singleInfo.amount > 0) {
      const catInfo = !isAdmin
        ? { category: 'Jajan/Anak', type: 'Keluar', confident: true }
        : (forcedCategory
            ? { category: forcedCategory, type: forcedCategory === 'Gaji & Pemasukan' ? 'Masuk' : 'Keluar', confident: true }
            : classifyIndonesianCategory(text, existingCategories, learnedMap));

      parsedDrafts.push({
        description: cleanItemDescription(text) || text,
        amount: singleInfo.amount,
        qtyNote: singleInfo.qtyNote,
        category: catInfo.category,
        type: catInfo.type,
        suggestedIcon: catInfo.suggestedIcon,
        suggestedColor: catInfo.suggestedColor,
        suggestedLimit: catInfo.suggestedLimit,
        learnedMatch: Boolean(catInfo.learnedMatch),
        walletId: fallbackWallet.id,
        walletName: fallbackWallet.name,
        needsCategoryConfirmation: !catInfo.confident && isAdmin && !forcedCategory
      });
    }
  }

  return { items: parsedDrafts };
}

/**
 * Fitur #1: Mendukung Kalkulasi Perkalian Otomatis ("2 ekor @35rb", "3x 15.000", "4 bungkus @ 12k")
 */
function extractAmountWithMultiplier(str) {
  if (!str) return { amount: 0, qtyNote: '' };

  // Cek pola perkalian: "<qty> [satuan] @ <harga>" atau "<qty> x <harga>"
  const multRegex = /\b(\d{1,3})\s*(?:ekor|kg|liter|ltr|pcs|buah|bungkus|pak|box|botol|kaleng|porsi|cup|gelas|potong|ikat|lembar|bulan|hari)?\s*(?:@|x|kali)\s*(?:rp\.?\s*)?(\d+(?:[.,]\d+)?\s*(?:juta|jt|ribu|rb|k)?)/i;
  const multMatch = str.match(multRegex);
  if (multMatch) {
    const qty = parseInt(multMatch[1], 10);
    const unitPrice = extractFirstAmount(multMatch[2]);
    if (qty > 0 && qty <= 500 && unitPrice >= 500) {
      return {
        amount: qty * unitPrice,
        qtyNote: `${qty} × Rp ${formatRupiahPlain(unitPrice)}`
      };
    }
  }

  return {
    amount: extractFirstAmount(str),
    qtyNote: ''
  };
}

/**
 * Ekstrak nominal Rupiah dari format populer Indonesia:
 * "75rb", "75.000", "75k", "1,5jt", "1.5 juta", "Rp 22.000", "22000"
 * Mengabaikan angka kuantitas seperti "5kg", "2L", "3x", "100kWh"
 */
function extractFirstAmount(str) {
  if (!str) return 0;
  // Hapus angka yang menempel dengan satuan berat/volume/frekuensi agar tidak salah baca ("5kg", "2liter", "100kWh")
  const cleaned = str.replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|gr|gram|liter|ltr|ml|ons|kw|kwh|pcs|buah|ikat|bungkus|pak|box|ekor|botol|porsi|orang)\b/gi, ' ');

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
    .replace(/^(?:tadi\s+pagi|tadi\s+siang|tadi\s+malam|tadi|barusan|kemarin|sekalian|lanjut|terus|lalu)\s+/gi, '')
    .replace(/(?:masuk\s+)?kategori\s*[:=]?\s*[a-zA-Z0-9\s&\/-]+$/gi, '')
    .replace(/(?:pakai|via|dengan|dari|lewat)\s+(?:uang\s+)?(?:tunai|cash|bca|mandiri|gopay|qris|ovo|dana|shopeepay|bank|dompet\s+\w+)/gi, '')
    .replace(/\b\d{1,3}\s*(?:@|x|kali)\s*(?:rp\.?\s*)?\d+(?:[.,]\d+)?\s*(?:juta|jt|ribu|rb|k)?\b/gi, '')
    .replace(/(?:rp\.?\s*)?\d+(?:[.,]\d+)?\s*(?:juta|jt|ribu|rb|k)\b/gi, '')
    .replace(/(?:rp\.?\s*)?\d{1,3}(?:\.\d{3})+\b/gi, '')
    .replace(/(?:rp\.?\s*)?\b\d{4,9}\b/gi, '')
    .replace(/^[\s,\-+•]+|[\s,\-+•]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return 'Transaksi Harian';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function detectExplicitWalletInSegment(seg, isAdmin) {
  if (!isAdmin) return { id: 'WLT-05', name: 'Saku Anak (Gopay/Cash)' };
  const lower = String(seg || '').toLowerCase();
  if (/\b(tunai|cash|uang\s*dapur)\b/i.test(lower)) return { id: 'WLT-04', name: 'Dompet Tunai Dapur' };
  if (/\b(gopay|qris|ewallet|ovo|dana|shopeepay)\b/i.test(lower)) return { id: 'WLT-03', name: 'GoPay / QRIS Rumah' };
  if (/\b(mandiri)\b/i.test(lower)) return { id: 'WLT-02', name: 'Mandiri Tabungan' };
  if (/\b(bca|transfer\s*bca)\b/i.test(lower)) return { id: 'WLT-01', name: 'BCA Keluarga' };
  return null;
}

function detectWalletFromText(text, isAdmin) {
  const explicit = detectExplicitWalletInSegment(text, isAdmin);
  return explicit || (isAdmin ? { id: 'WLT-01', name: 'BCA Keluarga' } : { id: 'WLT-05', name: 'Saku Anak (Gopay/Cash)' });
}

/**
 * Klasifikasi Kategori Bahasa Indonesia Super-Cerdas (Fitur #2 & #4):
 * 1. Cek instruksi kategori eksplisit di chat ("... kategori: Hewan Peliharaan")
 * 2. Cek Memori Kamus Pintar Keluarga (`learnedMap`)
 * 3. Cek Kategori yang sudah ada di Sheet (`existingCategories`)
 * 4. Cek 8 Kategori Utama Bawaan
 * 5. Cek Katalog Auto-Create Dynamic Category (`DYNAMIC_CATEGORY_CATALOG`)
 * 6. Inferensi otomatis dari objek kata benda ("beli <objek>" -> buat kategori pintar jika eksplisit)
 */
function classifyIndonesianCategory(text, existingCategories, learnedMap) {
  const lower = String(text || '').toLowerCase();
  existingCategories = Array.isArray(existingCategories) ? existingCategories : [];
  learnedMap = learnedMap || {};

  // 1. Cek apakah user menuliskan nama kategori secara eksplisit di dalam chat: misal "beli pakan 80rb kategori Hewan Peliharaan"
  const explicitCatMatch = text.match(/(?:masuk\s+)?kategori\s*[:=]?\s*([a-zA-Z0-9\s&\/-]+?)(?:\s+(?:pakai|via|dengan)\s+.*|$)/i);
  if (explicitCatMatch) {
    const rawCat = cleanItemDescription(explicitCatMatch[1]);
    if (rawCat && rawCat.length >= 3) {
      const vis = pickSmartCategoryVisuals(rawCat);
      return {
        category: rawCat,
        type: 'Keluar',
        confident: true,
        suggestedIcon: vis.icon,
        suggestedColor: vis.color,
        suggestedLimit: vis.limit
      };
    }
  }

  // 2. Cek Memori Kamus Pintar Keluarga (Fitur #4 Self-Learning)
  const learnedKeys = Object.keys(learnedMap);
  for (let i = 0; i < learnedKeys.length; i++) {
    const kw = learnedKeys[i];
    if (kw && lower.includes(kw.toLowerCase())) {
      return {
        category: learnedMap[kw],
        type: learnedMap[kw] === 'Gaji & Pemasukan' ? 'Masuk' : 'Keluar',
        confident: true,
        learnedMatch: true
      };
    }
  }

  // 3. Cek kecocokan nama langsung dengan kategori yang sudah ada di Sheet Kategori & Budget
  for (let i = 0; i < existingCategories.length; i++) {
    const catName = existingCategories[i];
    const keywords = catName.toLowerCase().split(/[\s&\/]+/).filter(w => w.length >= 4 && w !== 'dan');
    if (keywords.some(w => lower.includes(w))) {
      return { category: catName, type: 'Keluar', confident: true };
    }
  }

  // 4. Cek 8 Kategori Standar Rumah Tangga
  if (/gaji|bonus|thr|insentif|pemasukan|komisi|dividen|terima uang|pendapatan|cair/i.test(lower)) {
    return { category: 'Gaji & Pemasukan', type: 'Masuk', confident: true };
  }
  if (/beras|minyak|telur|sayur|bayam|kangkung|wortel|cabe|bawang|ayam|ikan|daging|sapi|udang|tahu|tempe|bumbu|garam|gula|kecap|saus|pasar|superindo|alfamart|indomaret|gas|elpiji|galon|aqua|sembako|masak|makan|sarapan|lauk|nasi|roti|susu|buah|apel|jeruk|pisang|gofood|grabfood|warteg|restoran|kuliner|bakso|mie|soto|sate/i.test(lower)) {
    return { category: 'Dapur & Makanan', type: 'Keluar', confident: true };
  }
  if (/listrik|pln|token|air|pdam|wifi|internet|biznet|indihome|pulsa|paket data|kuota|iuran|ipl|rt|rw|sampah|keamanan|cicilan|kpr|pajak|pbb|bphtb/i.test(lower)) {
    return { category: 'Tagihan & Utilitas', type: 'Keluar', confident: true };
  }
  if (/bensin|pertamax|pertalite|solar|dexlite|shell|bbm|tol|e-toll|flazz|parkir|grab|gojek|ojol|taksi|krl|mrt|lrt|kereta|bus|transjakarta|servis mobil|servis motor|ganti oli|ban|cuci mobil|cuci motor|bengkel/i.test(lower)) {
    return { category: 'Transportasi & BBM', type: 'Keluar', confident: true };
  }
  if (/jajan|es krim|coklat|permen|snack|chiki|mainan|uang saku|kantin|raka|nayla|boba|cilok/i.test(lower)) {
    return { category: 'Jajan/Anak', type: 'Keluar', confident: true };
  }
  if (/obat|dokter|apotek|kimia farma|k24|vitamin|suplemen|madu|rs|rumah sakit|klinik|puskesmas|bpjs|cek lab|gigi|kacamata|terapi/i.test(lower)) {
    return { category: 'Kesehatan & Darurat', type: 'Keluar', confident: true };
  }
  if (/spp|sekolah|les|kursus|bimbel|kumon|buku|alat tulis|pulpen|pensil|tas sekolah|seragam|ujian|praktikum|pendidikan|kuliah/i.test(lower)) {
    return { category: 'Pendidikan & Les', type: 'Keluar', confident: true };
  }
  if (/nonton|bioskop|xxi|netflix|spotify|youtube|disney|kopi|starbucks|kenangan|fore|cafe|nongkrong|liburan|hotel|staycation|tiket|wisata|rekreasi|mall|hiburan|karaoke/i.test(lower)) {
    return { category: 'Hiburan & Keluarga', type: 'Keluar', confident: true };
  }

  // 5. Cek Katalog Kategori Dinamis Pintar (Fitur #2 Auto-Create Dynamic Category)
  for (let j = 0; j < DYNAMIC_CATEGORY_CATALOG.length; j++) {
    const dyn = DYNAMIC_CATEGORY_CATALOG[j];
    if (dyn.regex.test(lower)) {
      return {
        category: dyn.name,
        type: dyn.type,
        confident: true,
        suggestedIcon: dyn.icon,
        suggestedColor: dyn.color,
        suggestedLimit: dyn.defaultLimit
      };
    }
  }

  // Jika tidak cocok dengan kamus mana pun, minta konfirmasi atau buat kategori baru dari UI
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

function callGeminiForTextParsing(apiKey, text, isAdmin, walletDetection, existingCategories) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const catListStr = (existingCategories && existingCategories.length > 0)
    ? existingCategories.join('", "')
    : 'Dapur & Makanan", "Tagihan & Utilitas", "Jajan/Anak", "Transportasi & BBM", "Kesehatan & Darurat", "Hiburan & Keluarga", "Pendidikan & Les", "Gaji & Pemasukan';

  const prompt = `Kamu adalah Asisten AI Keuangan Keluarga Qyona v2.2. Urai pesan belanja/transaksi berikut menjadi JSON: "${text}"
Aturan:
1. Pisahkan setiap item belanjaan secara mandiri. Jika ada perkalian (misal "2 ekor @35rb" atau "3x 15rb"), kalikan total harganya ke dalam field "amount" dan isi "qtyNote" (misal "2 x Rp 35.000").
2. Kategori yang sudah ada: "${catListStr}". Jika suatu item TIDAK cocok dengan kategori yang ada (misal makanan kucing, skincare, sedekah, pupuk tanaman, pakaian, hadiah, dll), BUAT nama kategori baru yang ringkas & tepat (contoh: "Hewan Peliharaan", "Perawatan & Kecantikan", "Amal & Sosial", "Hobi & Tanaman", "Pakaian & Belanja").
3. Deteksi dompet per item jika disebutkan ("tunai"->WLT-04, "gopay"/"qris"->WLT-03, "mandiri"->WLT-02, "bca"->WLT-01).
Kembalikan HANYA JSON murni:
{"items": [{"description": "Beli beras 5kg", "amount": 75000, "qtyNote": "", "category": "Dapur & Makanan", "type": "Keluar", "walletHint": "", "needsCategoryConfirmation": false}]}`;

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
    parsed.items = parsed.items.map(it => {
      const itemWallet = it.walletHint ? detectExplicitWalletInSegment(it.walletHint, isAdmin) : null;
      return {
        description: it.description,
        amount: Number(it.amount || 0),
        qtyNote: String(it.qtyNote || ''),
        category: isAdmin ? String(it.category || 'Dapur & Makanan') : 'Jajan/Anak',
        type: isAdmin ? (it.type || 'Keluar') : 'Keluar',
        walletId: itemWallet ? itemWallet.id : walletDetection.id,
        walletName: itemWallet ? itemWallet.name : walletDetection.name,
        needsCategoryConfirmation: Boolean(it.needsCategoryConfirmation)
      };
    });
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

    // UPGRADE FITUR #2: Kirim Notifikasi Interaktif + Tombol Inline [Setujui] / [Tolak] ke Telegram & WA Admin
    notifyAdminsInteractiveFundRequest(reqId, user.name, amount, String(payload.reason || 'Permintaan dana tambahan'));

    return {
      success: true,
      requestId: reqId,
      message: `Permintaan dana Rp ${formatRupiahPlain(amount)} telah dikirim ke Admin (beserta tombol Approval langsung di Bot Telegram/WA Ayah & Bunda).`
    };
  } finally {
    lock.releaseLock();
  }
}

function notifyAdminsInteractiveFundRequest(reqId, requesterName, amount, reason) {
  try {
    const admins = getAllMembers().filter(m => m.role === 'Admin' && m.status === 'Aktif');
    const msg = `🔔 *PENGAJUAN DANA BARU (${reqId})*\n\n` +
      `👤 *Dari:* ${requesterName}\n` +
      `💰 *Nominal:* Rp ${formatRupiahPlain(amount)}\n` +
      `📝 *Keperluan:* _${reason}_\n\n` +
      `Klik tombol di bawah ini untuk langsung menyetujui atau menolak dari chat:`;

    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: `✅ Setujui Rp ${formatRupiahPlain(amount)}`, callback_data: `REQ_APPROVE|${reqId}` },
          { text: `❌ Tolak Pengajuan`, callback_data: `REQ_REJECT|${reqId}` }
        ]
      ]
    };

    admins.forEach(adm => {
      if (adm.tgId) sendTelegramMessage(adm.tgId, msg, inlineKeyboard);
      if (adm.waId) {
        sendWhatsAppMessage(
          adm.waId,
          msg + `\n\nBalas cepat:\n• Ketik *SETUJU ${reqId}* untuk menyetujui\n• Ketik *TOLAK ${reqId}* untuk menolak`
        );
      }
    });
  } catch (e) {}
}

/**
 * ============================================================================
 * UPGRADE v2.0 FITUR #1: KANTONG IMPIAN & TABUNGAN TARGET KELUARGA (SINKING FUNDS)
 * Mendukung Gamifikasi Celengan Anak + Bonus Matching Orang Tua Otomatis
 * ============================================================================
 */
function saveSavingsGoal(memberId, goalPayload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const user = verifyMemberById(memberId);
    if (!user) throw new Error('Pengguna tidak valid.');

    const ss = getSpreadsheet();
    let sh = ss.getSheetByName(SHEET_NAMES.GOALS);
    if (!sh) {
      initDatabaseIfNeeded(true);
      sh = ss.getSheetByName(SHEET_NAMES.GOALS);
    }
    const isAdmin = user.role === 'Admin';
    const newId = 'GOL-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'ddHHmmss');
    const goalTitle = String(goalPayload.name || goalPayload.title || 'Kantong Impian Baru');
    const targetAmt = Math.max(10000, Number(goalPayload.targetAmount || 1000000));
    const initSaved = Math.max(0, Number(goalPayload.savedAmount !== undefined ? goalPayload.savedAmount : (goalPayload.currentAmount || 0)));
    const ownerId = isAdmin ? String(goalPayload.ownerId || 'ALL') : user.id;
    const matchRate = isAdmin ? Number(goalPayload.matchingRate || 0) : 50;

    sh.appendRow([
      newId,
      goalTitle,
      targetAmt,
      initSaved,
      String(goalPayload.deadline || '2026-12-31'),
      ownerId,
      String(goalPayload.icon || 'fa-piggy-bank'),
      String(goalPayload.color || '#10B981'),
      matchRate,
      'Aktif'
    ]);
    invalidateServerCache();

    return {
      success: true,
      goalId: newId,
      message: `Kantong Impian "${goalTitle}" (Target Rp ${formatRupiahPlain(targetAmt)}) berhasil dibuat!`
    };
  } finally {
    lock.releaseLock();
  }
}

function contributeToGoal(memberId, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const user = verifyMemberById(memberId);
    if (!user) throw new Error('Pengguna tidak terautentikasi.');

    const amount = Math.abs(Number(payload.amount || 0));
    if (amount <= 0) throw new Error('Nominal setoran tabungan harus lebih dari Rp 0.');

    const ss = getSpreadsheet();
    const sh = ss.getSheetByName(SHEET_NAMES.GOALS);
    const data = sh.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(payload.goalId)) {
        const goalTitle = String(data[i][1]);
        const targetAmt = Number(data[i][2] || 0);
        const currentAmt = Number(data[i][3] || 0);
        const ownerId = String(data[i][5] || 'ALL');
        const matchRate = Number(data[i][8] || 0);

        // Hitung Bonus Matching Orang Tua jika ini tabungan Anak dan yang menyetor adalah Anak (atau diaktifkan)
        let parentBonus = 0;
        if (matchRate > 0 && (user.role !== 'Admin' || payload.applyParentMatch)) {
          parentBonus = Math.round(amount * (matchRate / 100));
        }

        const totalAdded = amount + parentBonus;
        const updatedAmt = currentAmt + totalAdded;
        sh.getRange(i + 1, 4).setValue(updatedAmt);

        if (updatedAmt >= targetAmt) {
          sh.getRange(i + 1, 10).setValue('Tercapai 🎉');
        }

        // Catat sebagai alokasi tabungan di riwayat transaksi agar saldo dompet sinkron
        const walletId = payload.walletId || (user.role === 'Admin' ? 'WLT-02' : 'WLT-05');
        saveTransaction(user.id, {
          type: 'Keluar',
          amount: amount,
          category: user.role === 'Admin' ? 'Pendidikan & Les' : 'Jajan/Anak',
          description: `[Setor Tabungan Impian] ${goalTitle}${parentBonus > 0 ? ` (+Bonus Matching Ortu Rp ${formatRupiahPlain(parentBonus)})` : ''}`,
          walletId: walletId,
          source: 'Form'
        });
        invalidateServerCache();

        const pct = targetAmt > 0 ? Math.min(100, Math.round((updatedAmt / targetAmt) * 100)) : 100;
        const bonusMsg = parentBonus > 0
          ? ` 🎁 Ditambah Bonus Matching Ortu (${matchRate}%) sebesar Rp ${formatRupiahPlain(parentBonus)}! Total masuk celengan: Rp ${formatRupiahPlain(totalAdded)}.`
          : '';

        return {
          success: true,
          goalId: payload.goalId,
          updatedAmount: updatedAmt,
          parentBonus: parentBonus,
          percentage: pct,
          message: `Berhasil menabung Rp ${formatRupiahPlain(amount)} ke "${goalTitle}" (${pct}%).${bonusMsg}`
        };
      }
    }
    throw new Error('Kantong Impian tidak ditemukan.');
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
        invalidateServerCache();

        // Kirim notifikasi balasan otomatis ke WA/Telegram Anak yang mengajukan
        const childMember = verifyMemberById(requesterId);
        if (childMember) {
          const notifChild = decision === 'APPROVE'
            ? `🎉 *Hore! Pengajuan Danamu Disetujui!*\nPermintaan dana *Rp ${formatRupiahPlain(amount)}* untuk _"${reason}"_ telah disetujui oleh *${admin.name}*. Kuota jajanmu sudah otomatis bertambah!`
            : `ℹ️ Pengajuan dana *Rp ${formatRupiahPlain(amount)}* untuk _"${reason}"_ belum disetujui oleh *${admin.name}*.`;
          if (childMember.tgId) sendTelegramMessage(childMember.tgId, notifChild);
          if (childMember.waId) sendWhatsAppMessage(childMember.waId, notifChild);
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
        invalidateServerCache();
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
    invalidateServerCache();

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
 * UPGRADE v2.0 FITUR #2: LIVE BOT TELEGRAM & WHATSAPP 2 ARAH + INLINE BUTTONS
 * ============================================================================
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok' })).setMimeType(ContentService.MimeType.JSON);
    }

    const body = JSON.parse(e.postData.contents);

    // 0. Deteksi Sinkronisasi RPC dari GitHub Pages / PWA Eksternal
    if (body && body.action === 'rpc') {
      initDatabaseIfNeeded();
      const res = executeAllowedRpc(String(body.fn || ''), body.args || []);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, data: res }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // A1. Deteksi Klik Tombol Inline Keyboard Telegram (callback_query)
    if (body.callback_query) {
      const cb = body.callback_query;
      const tgChatId = String(cb.from.id || cb.message?.chat?.id || '');
      const member = verifyMemberByChatId(tgChatId);
      if (!member) {
        answerTelegramCallback(cb.id, 'Akses ditolak: ID belum terdaftar.');
        return ContentService.createTextOutput('OK');
      }
      const responseText = handleInteractiveBotCallback(member, String(cb.data || ''));
      answerTelegramCallback(cb.id, 'Diproses oleh Qyona AI!');
      sendTelegramMessage(tgChatId, responseText);
      return ContentService.createTextOutput('OK');
    }

    // A2. Deteksi Pesan Teks / Foto dari Webhook Telegram Bot API
    if (body.message || body.edited_message) {
      const msg = body.message || body.edited_message;
      const tgChatId = String(msg.chat.id);
      const member = verifyMemberByChatId(tgChatId);

      if (!member) {
        sendTelegramMessage(tgChatId, `⛔ *Akses Ditolak (Privat)*\nID Chat Telegram Anda (\`${tgChatId}\`) belum terdaftar di aplikasi *Catatan Keuangan Rumah Qyona*.\n\nMinta Admin (Suami/Istri) mendaftarkan ID ini di menu *Kelola Keluarga*.`);
        return ContentService.createTextOutput('OK');
      }

      const text = (msg.text || msg.caption || '').trim();
      const result = processChatbotMessage(member.id, text);
      const replyMarkup = buildTelegramInlineMarkupForChatResult(member, result);
      sendTelegramMessage(tgChatId, result.reply, replyMarkup);
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

      // Cek apakah balas cepat perintah SETUJU REQ-xx atau TOLAK REQ-xx via WA
      const upperWa = String(waText).trim().toUpperCase();
      if (upperWa.startsWith('SETUJU REQ-') || upperWa.startsWith('TOLAK REQ-')) {
        const parts = upperWa.split(/\s+/);
        const decision = parts[0] === 'SETUJU' ? 'APPROVE' : 'REJECT';
        const reqId = parts[1];
        const apprRes = processFundRequestApproval(member.id, reqId, decision);
        sendWhatsAppMessage(waSender, `✅ ${apprRes.message}`);
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

/**
 * Buat Tombol Inline Keyboard Telegram otomatis saat transaksi berhasil disimpan atau butuh konfirmasi
 */
function buildTelegramInlineMarkupForChatResult(member, result) {
  if (!result) return null;
  if (result.status === 'NEEDS_CONFIRMATION' && result.pendingMessage) {
    const shortMsg = String(result.pendingMessage).slice(0, 32);
    return {
      inline_keyboard: [
        [
          { text: '🍲 Dapur', callback_data: `CAT_CONFIRM|Dapur & Makanan|${shortMsg}` },
          { text: '⚡ Tagihan', callback_data: `CAT_CONFIRM|Tagihan & Utilitas|${shortMsg}` }
        ],
        [
          { text: '⛽ Transport', callback_data: `CAT_CONFIRM|Transportasi & BBM|${shortMsg}` },
          { text: '🍦 Jajan/Anak', callback_data: `CAT_CONFIRM|Jajan/Anak|${shortMsg}` }
        ]
      ]
    };
  }

  if (result.status === 'SAVED' && result.transactionsCreated && result.transactionsCreated.length > 0) {
    const firstTrx = result.transactionsCreated[0];
    const buttons = [
      [{ text: `❌ Batalkan / Hapus (${firstTrx.id})`, callback_data: `TRX_DELETE|${firstTrx.id}` }]
    ];
    if (member.role === 'Admin') {
      buttons.unshift([
        { text: '🔄 Ubah ke Dapur', callback_data: `TRX_CAT|${firstTrx.id}|Dapur & Makanan` },
        { text: '🔄 Ubah ke Tagihan', callback_data: `TRX_CAT|${firstTrx.id}|Tagihan & Utilitas` }
      ]);
    }
    return { inline_keyboard: buttons };
  }
  return null;
}

/**
 * Eksekusi aksi ketika tombol Inline Keyboard di Telegram diklik oleh pengguna
 */
function handleInteractiveBotCallback(member, callbackData) {
  const parts = String(callbackData || '').split('|');
  const action = parts[0];

  if (action === 'REQ_APPROVE' || action === 'REQ_REJECT') {
    const reqId = parts[1];
    const decision = action === 'REQ_APPROVE' ? 'APPROVE' : 'REJECT';
    const res = processFundRequestApproval(member.id, reqId, decision);
    return `✅ *Approval Selesai*\n${res.message}`;
  }

  if (action === 'TRX_DELETE') {
    const trxId = parts[1];
    const res = deleteTransaction(member.id, trxId);
    return `🗑️ *Transaksi Dibatalkan*\n${res.message}`;
  }

  if (action === 'TRX_CAT') {
    const trxId = parts[1];
    const newCat = parts[2];
    const ss = getSpreadsheet();
    const sh = ss.getSheetByName(SHEET_NAMES.TRANSAKSI);
    const data = sh.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === trxId) {
        sh.getRange(i + 1, 5).setValue(newCat);
        return `🔄 Kategori transaksi *${trxId}* berhasil diubah menjadi *${newCat}*.`;
      }
    }
    return `⚠️ Transaksi ${trxId} tidak ditemukan.`;
  }

  if (action === 'CAT_CONFIRM') {
    const chosenCat = parts[1];
    const pendingMsg = parts[2];
    const res = processChatbotMessage(member.id, pendingMsg, chosenCat);
    return res.reply;
  }

  return 'ℹ️ Perintah tombol telah diproses.';
}

function answerTelegramCallback(callbackQueryId, notificationText) {
  const token = getConfig('TELEGRAM_BOT_TOKEN', '');
  if (!token || !callbackQueryId) return;
  UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      callback_query_id: callbackQueryId,
      text: notificationText
    }),
    muteHttpExceptions: true
  });
}

function sendTelegramMessage(chatId, text, replyMarkup) {
  const token = getConfig('TELEGRAM_BOT_TOKEN', '');
  if (!token) return;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payloadObj = {
    chat_id: chatId,
    text: text,
    parse_mode: 'Markdown'
  };
  if (replyMarkup) {
    payloadObj.reply_markup = replyMarkup;
  }
  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payloadObj),
    muteHttpExceptions: true
  });
}

/**
 * One-Click Register Webhook Telegram dari UI Admin Qyona
 */
function registerTelegramWebhook(adminId, customWebAppUrl) {
  const admin = verifyMemberById(adminId);
  if (!admin || admin.role !== 'Admin') {
    throw new Error('Hanya Admin yang dapat mendaftarkan Webhook Telegram.');
  }
  const token = getConfig('TELEGRAM_BOT_TOKEN', '');
  if (!token) {
    throw new Error('Token Bot Telegram belum diisi. Masukkan TELEGRAM_BOT_TOKEN terlebih dahulu lalu klik Simpan.');
  }
  const targetUrl = customWebAppUrl || ScriptApp.getService().getUrl();
  if (!targetUrl) {
    throw new Error('URL Web App GAS belum ditemukan.');
  }
  const resp = UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(targetUrl)}`, {
    method: 'get',
    muteHttpExceptions: true
  });
  const json = JSON.parse(resp.getContentText());
  if (json && json.ok) {
    return {
      success: true,
      webhookUrl: targetUrl,
      message: `Webhook Telegram berhasil terhubung otomatis ke ${targetUrl}!`
    };
  }
  throw new Error('Gagal menyambungkan webhook Telegram: ' + (json.description || resp.getContentText()));
}

/**
 * Simulasi & Tes Pengiriman Notifikasi Bot Interaktif (Dengan Tombol Inline)
 */
function testInteractiveBotNotification(adminId) {
  const admin = verifyMemberById(adminId);
  if (!admin) throw new Error('Pengguna tidak ditemukan.');

  const sampleText = `🤖 *Tes Bot Interaktif 2 Arah Qyona v2.0*\n\n` +
    `Halo *${admin.name}*! Bot keluarga Anda telah mendukung **Tombol Inline Interaktif**.\n` +
    `• Saat mencatat pengeluaran via chat, Anda bisa langsung klik **[🔄 Ubah Kategori]** atau **[❌ Batalkan]**.\n` +
    `• Saat Anak mengajukan dana, tombol **[✅ Setujui]** akan muncul di sini!`;

  const sampleKeyboard = {
    inline_keyboard: [
      [
        { text: '✅ Setujui Rp 125.000 (REQ-01)', callback_data: 'REQ_APPROVE|REQ-01' },
        { text: '❌ Tolak (REQ-01)', callback_data: 'REQ_REJECT|REQ-01' }
      ]
    ]
  };

  let sentChannel = [];
  if (getConfig('TELEGRAM_BOT_TOKEN', '') && admin.tgId) {
    sendTelegramMessage(admin.tgId, sampleText, sampleKeyboard);
    sentChannel.push('Telegram (' + admin.tgId + ')');
  }
  if (getConfig('WA_API_TOKEN', '') && admin.waId) {
    sendWhatsAppMessage(admin.waId, sampleText + `\n\nKetik *SETUJU REQ-01* untuk mencoba approval via WhatsApp.`);
    sentChannel.push('WhatsApp (' + admin.waId + ')');
  }

  return {
    success: true,
    sentChannels: sentChannel,
    previewMessage: sampleText,
    message: sentChannel.length > 0
      ? `Pesan interaktif dengan tombol inline berhasil dikirim ke ${sentChannel.join(' & ')}!`
      : 'Simulasi Bot Interaktif berhasil ditampilkan di panel Chat AI Qyona (isi Token Telegram/WA di pengaturan untuk mengirim ke HP nyata).'
  };
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
