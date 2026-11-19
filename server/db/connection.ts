import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

let activeDb: DatabaseSync | null = null;

export function todayWibIsoDate(now = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(now);
}

export function wibOffsetIso(dayOffset: number, hour: number, minute: number): string {
  const base = new Date();
  const dateStr = todayWibIsoDate(new Date(base.getTime() + dayOffset * 86_400_000));
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${dateStr}T${hh}:${mm}:00+07:00`;
}

export function initDatabase(dbPath?: string): DatabaseSync {
  const target = dbPath ?? process.env.LLAMREI_DB_PATH ?? path.resolve(process.cwd(), 'data', 'llamrei.db');
  if (target !== ':memory:') {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  const db = new DatabaseSync(target);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const appliedSet = new Set(
    (db.prepare('SELECT filename FROM schema_migrations').all() as Array<{ filename: string }>).map((r) => r.filename),
  );

  const migrationFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const recordMigration = db.prepare('INSERT INTO schema_migrations (filename) VALUES (?)');
  for (const file of migrationFiles) {
    if (appliedSet.has(file)) continue;
    // Legacy compatibility if 001 was already applied before schema_migrations existed
    if (file === '001_llamrei_v2_core.sql') {
      const hasSpaces = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='spaces'").get();
      if (hasSpaces) {
        recordMigration.run(file);
        continue;
      }
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.exec(sql);
    recordMigration.run(file);
  }

  seedInitialData(db);
  activeDb = db;
  return db;
}

export function getDb(): DatabaseSync {
  if (!activeDb) {
    return initDatabase();
  }
  return activeDb;
}

export function closeDb(): void {
  if (activeDb) {
    activeDb.close();
    activeDb = null;
  }
}

function seedInitialData(db: DatabaseSync): void {
  const existing = db.prepare('SELECT COUNT(*) AS cnt FROM spaces').get() as { cnt: number };
  if (existing.cnt > 0) return;

  const insGoal = db.prepare(
    `INSERT INTO macro_goals (id, title, category, target_date, target_metric_label, progress_percent, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  insGoal.run('goal_skripsi', 'Lulus Skripsi S1 FEB UKRIDA (2-Stage MRA)', 'academic', wibOffsetIso(45, 17, 0), 'Bab 1-5 & Sidang', 65, 'active');
  insGoal.run('goal_trading', 'Disiplin Eksekusi Trading Tanpa Overtrade', 'trading', wibOffsetIso(30, 23, 0), 'Zero Tilt Days', 75, 'active');
  insGoal.run('goal_lkfeb', 'Rilis & Stabilitas Portal BEM FEB UKRIDA', 'organization', wibOffsetIso(14, 18, 0), 'Audit RLS & Vercel', 80, 'active');

  const insSpace = db.prepare('INSERT INTO spaces (id, name, color, icon, sort_order) VALUES (?, ?, ?, ?, ?)');
  insSpace.run('space_kuliah', 'Kuliah UKRIDA', '#818cf8', 'GraduationCap', 1);
  insSpace.run('space_trading', 'Trading & Riset', '#f59e0b', 'TrendingUp', 2);
  insSpace.run('space_lkfeb', 'LK-FEB & Portal', '#06b6d4', 'Building2', 3);

  const insFolder = db.prepare('INSERT INTO folders (id, space_id, name, sort_order) VALUES (?, ?, ?, ?)');
  insFolder.run('folder_skripsi', 'space_kuliah', 'Skripsi S1 (MRA)', 1);
  insFolder.run('folder_market', 'space_trading', 'Market Prep & Watchlist', 1);

  const insList = db.prepare('INSERT INTO lists (id, space_id, folder_id, name, sort_order) VALUES (?, ?, ?, ?, ?)');
  insList.run('list_bab4', 'space_kuliah', 'folder_skripsi', 'Bab 4 & Olah Data', 1);
  insList.run('list_tugas_kuliah', 'space_kuliah', null, 'Tugas Kuliah Umum', 2);
  insList.run('list_jurnal', 'space_trading', 'folder_market', 'Sesi & Rilis Data', 1);
  insList.run('list_portal', 'space_lkfeb', null, 'Portal BEM & Pitch Deck', 1);

  const insTask = db.prepare(
    `INSERT INTO tasks (id, list_id, parent_task_id, goal_id, title, description_md, status, priority, start_at, due_at, reminder_offsets_json, hard_alarm_enabled, hard_alarm_at, time_estimate_minutes, time_spent_seconds, postponed_count, tags_json, checklist_json, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const t1Start = wibOffsetIso(0, 13, 0);
  const t1Due = wibOffsetIso(0, 17, 0);
  insTask.run(
    'task_bab4',
    'list_bab4',
    null,
    'goal_skripsi',
    'Bab 4: Interpretasi Output 2-Stage MRA (Pokémon TCG)',
    'Lengkapi tabel koefisien interaksi Self-Control (M) dan uji asumsi klasik sebelum bimbingan Dr. Fredella.',
    'In Progress',
    'urgent',
    t1Start,
    t1Due,
    '[15,30]',
    1,
    t1Start,
    120,
    5040,
    0,
    '["Skripsi","MRA"]',
    JSON.stringify([
      { id: 'c1', text: 'Verifikasi mean-centering X1, X2, X3 & M', done: true },
      { id: 'c2', text: 'Tulis interpretasi koefisien moderasi tahap 2', done: false },
      { id: 'c3', text: 'Ekspor tabel ke format APA BAB 4', done: false },
    ]),
    1,
  );

  // Subtasks of task_bab4
  insTask.run('task_bab4_sub1', 'list_bab4', 'task_bab4', 'goal_skripsi', 'Cek validitas & reliabilitas kuesioner responden', '', 'Done', 'high', null, t1Due, '[15]', 0, null, 30, 1800, 0, '["Skripsi"]', '[]', 1);
  insTask.run('task_bab4_sub2', 'list_bab4', 'task_bab4', 'goal_skripsi', 'Finalisasi grafik moderasi simple slope', '', 'To Do', 'high', null, t1Due, '[15]', 0, null, 45, 0, 0, '["Skripsi"]', '[]', 2);

  const t2Start = wibOffsetIso(0, 19, 30);
  const t2Due = wibOffsetIso(0, 20, 30);
  insTask.run(
    'task_cpi',
    'list_jurnal',
    null,
    'goal_trading',
    'Evaluasi Sesi London & Siapkan Skenario Rilis US CPI',
    'Catat level likuiditas XAUUSD & DXY sebelum jendela rilis berita high-impact.',
    'To Do',
    'high',
    t2Start,
    t2Due,
    '[15]',
    1,
    t2Start,
    45,
    0,
    0,
    '["XAUUSD","CPI"]',
    JSON.stringify([{ id: 'c4', text: 'Tandai High/Low sesi Asia & London', done: false }]),
    2,
  );

  const t3Start = wibOffsetIso(1, 10, 0);
  const t3Due = wibOffsetIso(1, 12, 0);
  insTask.run(
    'task_rls',
    'list_portal',
    null,
    'goal_lkfeb',
    'Audit RLS Supabase & Deployment Portal BEM FEB',
    'Pastikan kebijakan Row-Level Security aktif pada tabel pendaftaran & cek deploy Vercel.',
    'In Progress',
    'high',
    t3Start,
    t3Due,
    '[15]',
    0,
    null,
    60,
    2400,
    1,
    '["Portal","Security"]',
    '[]',
    3,
  );

  insTask.run(
    'task_xau_done',
    'list_jurnal',
    null,
    'goal_trading',
    'Catat Level Likuiditas XAUUSD H4 & Jurnal Pagi',
    'Sudah dicatat di watchlist pagi.',
    'Done',
    'normal',
    wibOffsetIso(0, 8, 0),
    wibOffsetIso(0, 9, 0),
    '[15]',
    0,
    null,
    20,
    1200,
    0,
    '["XAUUSD"]',
    '[]',
    4,
  );

  // Calendar projections & 2-tier alarms for seeded tasks
  const insCal = db.prepare(
    `INSERT INTO calendar_events (id, source, linked_task_id, title, start_at, end_at, color, has_hard_alarm, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insCal.run('cal_task_bab4', 'clickup_task', 'task_bab4', 'Bab 4: Interpretasi Output 2-Stage MRA (Pokémon TCG)', t1Start, t1Due, '#818cf8', 1, 'ClickUp Task · URGENT');
  insCal.run('cal_task_cpi', 'clickup_task', 'task_cpi', 'Evaluasi Sesi London & Siapkan Skenario Rilis US CPI', t2Start, t2Due, '#f59e0b', 1, 'ClickUp Task · HIGH');
  insCal.run('cal_task_rls', 'clickup_task', 'task_rls', 'Audit RLS Supabase & Deployment Portal BEM FEB', t3Start, t3Due, '#06b6d4', 0, 'ClickUp Task · HIGH');
  insCal.run('cal_notion_bimbingan', 'notion', null, 'Bimbingan Skripsi Dr. Fredella Colline (Notion)', wibOffsetIso(0, 15, 0), wibOffsetIso(0, 16, 0), '#a855f7', 0, 'Synced from Notion Database');

  const insAlarm = db.prepare(
    `INSERT INTO task_alarms_reminders (id, task_id, calendar_event_id, title, subtitle, kind, trigger_at, offset_minutes, sound_preset, ring_phone_nectarlink, enabled, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const t1Soft = new Date(Date.parse(t1Start) - 15 * 60_000).toISOString();
  insAlarm.run('alm_soft_bab4', 'task_bab4', 'cal_task_bab4', 'Reminder: Bab 4 Skripsi (H-15m)', 'Kuliah UKRIDA · URGENT', 'soft_reminder', t1Soft, 15, 'zen_chime', 1, 1, 'armed');
  insAlarm.run('alm_hard_bab4', 'task_bab4', 'cal_task_bab4', 'Bab 4: Interpretasi Output 2-Stage MRA', 'Hard Alarm · Kuliah UKRIDA', 'hard_alarm', t1Start, 0, 'tactical_pulse', 1, 1, 'armed');
  const t2Soft = new Date(Date.parse(t2Start) - 15 * 60_000).toISOString();
  insAlarm.run('alm_soft_cpi', 'task_cpi', 'cal_task_cpi', 'Reminder: Skenario US CPI (H-15m)', 'Trading & Riset · HIGH', 'soft_reminder', t2Soft, 15, 'zen_chime', 1, 1, 'armed');
  insAlarm.run('alm_hard_cpi', 'task_cpi', 'cal_task_cpi', 'Evaluasi Sesi London & Rilis US CPI', 'Hard Alarm · Trading & Riset', 'hard_alarm', t2Start, 0, 'siren_urgent', 1, 1, 'armed');

  // Contacts & Scheduled Messages
  const insContact = db.prepare(
    `INSERT INTO contacts (id, name, aliases_json, phone_e164, timezone, active_hours_note, preferred_channel)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  insContact.run('cnt_raka', 'Raka Pratama', '["Raka","Mas Raka"]', '6281200008821', 'Asia/Jakarta', '09:00-21:00 WIB', 'nectarlink_bridge');
  insContact.run('cnt_fredella', 'Dr. Fredella Colline', '["Bu Fredella","Dosen Pembimbing","Fredella"]', '6281100003344', 'Asia/Jakarta', '08:00-17:00 WIB hari kerja', 'wa_me_manual');
  insContact.run('cnt_budi', 'Budi Santoso', '["Budi"]', '6281300005566', 'Asia/Jakarta', '10:00-20:00 WIB', 'wa_gateway');

  const insMsg = db.prepare(
    `INSERT INTO scheduled_messages (id, contact_id, recipient_name, recipient_address, channel, purpose, message_body, scheduled_at, status, approved_at, linked_task_id, created_by_prompt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insMsg.run(
    'msg_seed_1',
    'cnt_raka',
    'Raka Pratama',
    '6281200008821',
    'nectarlink_bridge',
    'Revisi slide pitch deck',
    'Halo Raka, mengingatkan untuk kirim revisi slide pitch deck malam ini ya agar langsung kita finalisasi. Terima kasih!',
    wibOffsetIso(0, 19, 0),
    'pending_approval',
    null,
    'task_rls',
    'Jadwalkan chat ke Raka jam 19:00 ingatkan revisi slide pitch deck',
  );
  insMsg.run(
    'msg_seed_2',
    'cnt_fredella',
    'Dr. Fredella Colline',
    '6281100003344',
    'wa_me_manual',
    'Konfirmasi bimbingan Bab 4',
    'Selamat pagi Ibu Fredella, izin mengonfirmasi kesiapan draf Bab 4 Skripsi untuk bimbingan hari ini pukul 15.00 WIB. Terima kasih Ibu.',
    wibOffsetIso(0, 14, 0),
    'approved',
    new Date().toISOString(),
    'task_bab4',
    'Konfirmasi bimbingan ke Ibu Fredella jam 14:00',
  );

  // Habits
  const insHabit = db.prepare('INSERT INTO habits (id, title, icon, target_days_per_week, current_streak, best_streak, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insHabit.run('hab_skripsi', 'Deep Work Skripsi >= 60 menit', 'BookOpen', 6, 5, 11, 1);
  insHabit.run('hab_jurnal', 'Evaluasi Chart Tanpa Overtrade', 'ShieldCheck', 5, 4, 9, 2);
  insHabit.run('hab_tidur', 'Tidur >= 7 Jam Sebelum Sesi London', 'Moon', 6, 3, 7, 3);
  db.prepare('INSERT INTO habit_logs (habit_id, date_wib, completed) VALUES (?, ?, 1)').run('hab_jurnal', todayWibIsoDate());

  // Paired NectarLink Device (demo baseline updated live when NectarLink responds)
  db.prepare(
    `INSERT INTO paired_devices (id, name, platform, android_version, online, link_type, lan_ip, tailscale_ip, active_transport, latency_ms, battery_level, battery_charging, dnd_enabled, auto_dnd_on_deepwork, media_title, media_artist, media_playing)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('dev_infinix_note30', 'Infinix NOTE 30 Pro', 'android', 'Android 14', 0, 'lan', '192.168.1.24', null, 'lan', 4, 84, 0, 0, 1, 'Lofi Focus Beats', 'ChilledCow', 0);

  // Sample Phone Notifications (real-time WA tag detection preview)
  const insNotif = db.prepare(
    `INSERT INTO phone_notifications (id, device_id, app_package, app_name, sender_or_title, conversation_group, body_text, otp_code, can_reply, is_mention_tag, ai_intent, ai_urgency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insNotif.run('notif_wa_1', 'dev_infinix_note30', 'com.whatsapp', 'WhatsApp', 'Raka Pratama', 'BEM FEB Inti', '@Arthur tolong cek bagian RLS Supabase sebelum rapat besok siang ya!', null, 1, 1, 'task_request', 'high');
  insNotif.run('notif_wa_2', 'dev_infinix_note30', 'com.whatsapp', 'WhatsApp', 'Sekretariat Prodi', 'Mahasiswa Akhir FEB', 'Arthur Reezan (312023002), jadwal pengumpulan form bimbingan paling lambat Jumat 16:00 WIB.', null, 1, 1, 'deadline', 'high');
  insNotif.run('notif_otp_1', 'dev_infinix_note30', 'com.google.android.apps.messaging', 'Messages', 'Bank BCA / OTP', null, 'Kode OTP Anda adalah 482910. Jangan berikan kepada siapa pun.', '482910', 0, 0, 'info', 'low');

  // Device Timeline
  const insTl = db.prepare(
    `INSERT INTO device_timeline (id, device_id, device_name, kind, direction, title, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  insTl.run('tl_1', 'dev_infinix_note30', 'Infinix NOTE 30 Pro', 'mirror_session', 'session', 'Screen mirroring (Screencast)', 'With Infinix NOTE 30 Pro · 864x1920 · 21s (No USB Debug)');
  insTl.run('tl_2', 'dev_infinix_note30', 'Infinix NOTE 30 Pro', 'scan', 'incoming', 'scan_kuesioner_mra.jpg', 'Continuity Camera Scan → Lampiran Skripsi');

  // Economic Events (Today & Tomorrow)
  const insEcon = db.prepare(
    `INSERT INTO economic_events (id, country, event_name, impact, scheduled_at, forecast_val, previous_val)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  insEcon.run('econ_cpi', 'USD', 'US Core CPI (YoY) & Initial Jobless Claims', 'high', wibOffsetIso(0, 20, 30), '3.3%', '3.3%');
  insEcon.run('econ_fomc', 'USD', 'FOMC Member Speech & Rate Expectations', 'medium', wibOffsetIso(0, 22, 0), '-', '-');
  insEcon.run('econ_pmi', 'EUR', 'Eurozone Flash Manufacturing PMI', 'high', wibOffsetIso(1, 15, 0), '46.0', '45.9');

  // Initial Finance & AI News
  const insNews = db.prepare(
    `INSERT INTO news_articles (id, source_name, category, title, url, published_at, summary_raw, ai_topics_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insNews.run('news_1', 'Finnhub / Reuters', 'forex', 'Gold (XAUUSD) stabilizes near 2,640 ahead of US inflation & Fed remarks', 'https://example.local/news/xauusd-cpi', wibOffsetIso(0, 7, 30), 'Spot gold held steady as traders await US macro data and Treasury yield direction.', '["XAUUSD","USD","FED"]');
  insNews.run('news_2', 'Finnhub / Bloomberg', 'finance', 'Dollar Index (DXY) holds firm above 106 ahead of US session overlap', 'https://example.local/news/dxy-106', wibOffsetIso(0, 6, 45), 'G10 FX volatility remains compressed before London-NY overlap.', '["DXY","USD"]');
  insNews.run('news_3', 'AI Engineering RSS', 'ai', 'Gemini Tool-Calling & Structured Streaming latency drops in local desktop agents', 'https://example.local/news/gemini-tools', wibOffsetIso(0, 5, 15), 'Developer benchmarks highlight faster function execution for local-first copilots.', '["AI","LLM","AGENT"]');

  // Seed Chat Session
  db.prepare('INSERT INTO chat_sessions (id, title) VALUES (?, ?)').run('sess_main', 'Llamrei Co-Commander Main Thread');
  db.prepare(
    `INSERT INTO chat_messages (id, session_id, role, content, model_used)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    'cmsg_welcome',
    'sess_main',
    'assistant',
    'Selamat datang di **Llamrei Co-Commander**. Anda bisa menyuruh saya membuat tugas ClickUp, memasang Hard Alarm & jadwal kalender, menyusun jadwal kerja harian (*Auto-Schedule*), atau menjadwalkan chat ke kontak Anda (mis. *"Jadwalkan chat ke Budi jam 19:00 soal data skripsi"*).',
    'llamrei-core',
  );

  // Default Settings
  const insSetting = db.prepare('INSERT INTO app_settings (key, value_json) VALUES (?, ?)');
  insSetting.run('theme', JSON.stringify('tactical'));
  insSetting.run('ai_model', JSON.stringify('gemini-2.5-flash'));
  insSetting.run('ai_monthly_budget_usd', JSON.stringify(10.0));
  insSetting.run('paid_billing_verified', JSON.stringify(false));
  insSetting.run('deep_work_window', JSON.stringify({ startHour: 8, endHour: 22 }));
  insSetting.run('watchlist', JSON.stringify(['OANDA:XAUUSD', 'FX:EURUSD', 'BINANCE:BTCUSDT', 'TVC:DXY']));
  insSetting.run('notion_database_id', JSON.stringify(''));

  // Fase 3 Seed: Linked Workspace Doc
  try {
    const hasDocs = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_docs'").get();
    if (hasDocs) {
      db.prepare(
        `INSERT OR IGNORE INTO workspace_docs (id, space_id, linked_task_id, title, content_md)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        'doc_mra_notes',
        'space_kuliah',
        'task_bab4',
        'Catatan Uji Asumsi Klasik & 2-Stage MRA',
        '## Checklist Statistik Bab 4\n- Mean centering X1 (Hedonic), X2 (Completeness), X3 (Speculative), dan M (Self-Control)\n- Cek VIF < 10 setelah centering\n- Uji F & R-Square Tahap 1 vs Tahap 2 (Moderasi)',
      );
    }
  } catch {
    // Ignore if table schema not ready
  }
}
