import crypto from 'node:crypto';
import { initDatabase, getDb } from '../server/db/connection.ts';
import { sseBus } from '../server/lib/sse.ts';

initDatabase();
const db = getDb();

// Schedule definitions from SISFO - UKRIDA
const courses = [
  {
    code: 'MN0PP003',
    name: 'Studi Kelayakan Bisnis (Responsi)',
    dayOfWeek: 1, // Senin
    startTime: '17:00:00',
    endTime: '19:30:00',
    room: 'A708',
    lecturer: 'Michelle Angela',
    classType: '7MMNK / Responsi',
    credits: 3.0,
    attendance: '10 / 14',
    color: '#06b6d4', // Cyan
  },
  {
    code: 'MN0PP001',
    name: 'Manajemen Jasa',
    dayOfWeek: 1, // Senin
    startTime: '19:30:00',
    endTime: '22:00:00',
    room: 'A708',
    lecturer: 'Y B Andre Marvianta',
    classType: '7MMNK / Kuliah',
    credits: 3.0,
    attendance: '9 / 14',
    color: '#f59e0b', // Amber
  },
  {
    code: 'MN0PP014',
    name: 'Manajemen Kompensasi & Audit SDM',
    dayOfWeek: 2, // Selasa
    startTime: '17:00:00',
    endTime: '19:30:00',
    room: 'A607',
    lecturer: 'Bernardus Wishman Simbora Siregar',
    classType: '7MMNK / Kuliah',
    credits: 3.0,
    attendance: '7 / 14',
    color: '#ec4899', // Rose/Pink
  },
  {
    code: 'MN0PP011',
    name: 'Ekonomi Manajerial (Blok Online)',
    dayOfWeek: 3, // Rabu (Reminder modul & forum diskusi online)
    startTime: '19:00:00',
    endTime: '20:30:00',
    room: 'Online (Moodle/Zoom)',
    lecturer: 'Bernardus Wishman Simbora Siregar',
    classType: '7MMNX / Kuliah',
    credits: 3.0,
    attendance: '13 / 14',
    color: '#6366f1', // Indigo
  },
  {
    code: 'MN0PP003',
    name: 'Studi Kelayakan Bisnis (Kuliah)',
    dayOfWeek: 4, // Kamis
    startTime: '19:30:00',
    endTime: '22:00:00',
    room: 'A605',
    lecturer: 'Y B Andre Marvianta',
    classType: '7MMNK / Kuliah',
    credits: 3.0,
    attendance: '8 / 14',
    color: '#10b981', // Emerald
  },
  {
    code: 'MN0WP027',
    name: 'Skripsi (Konsultasi & Progres MRA)',
    dayOfWeek: 6, // Sabtu
    startTime: '08:00:00',
    endTime: '10:30:00',
    room: 'FEB UKRIDA / Daring',
    lecturer: 'Dr. Fredella Colline',
    classType: '7PMNA / Kuliah',
    credits: 6.0,
    attendance: '0 / 14 (Mandiri & Bimbingan)',
    color: '#8b5cf6', // Purple
  },
];

// Date range: 19 November 2026 to 31 January 2027
const startDate = new Date('2026-11-19T00:00:00+07:00');
const endDate = new Date('2027-01-31T23:59:59+07:00');

const insertEventStmt = db.prepare(`
  INSERT INTO calendar_events (id, source, title, start_at, end_at, all_day, color, has_hard_alarm, location, notes)
  VALUES (?, 'local', ?, ?, ?, 0, ?, 0, ?, ?)
`);

const insertReminderStmt = db.prepare(`
  INSERT INTO task_alarms_reminders (id, calendar_event_id, title, subtitle, kind, trigger_at, offset_minutes, sound_preset, ring_phone_nectarlink, enabled, status)
  VALUES (?, ?, ?, ?, 'soft_reminder', ?, 30, 'zen_chime', 1, 1, 'armed')
`);

let createdEvents = 0;
let createdReminders = 0;

// Loop day by day
const cur = new Date(startDate);
while (cur <= endDate) {
  const dayOfWeek = cur.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const yyyy = cur.getFullYear();
  const mm = String(cur.getMonth() + 1).padStart(2, '0');
  const dd = String(cur.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  for (const course of courses) {
    if (course.dayOfWeek === dayOfWeek) {
      const startAt = `${dateStr}T${course.startTime}+07:00`;
      const endAt = `${dateStr}T${course.endTime}+07:00`;
      const eventId = `cal_ukrida_${course.code.toLowerCase()}_${dateStr.replace(/-/g, '')}`;

      const title = `[${course.code}] ${course.name} · Ruang ${course.room}`;
      const notes = `Mata Kuliah SISFO UKRIDA:\n` +
        `• Kode & Nama: [${course.code}] ${course.name}\n` +
        `• Kelas / Tipe: ${course.classType} (${course.credits} SKS)\n` +
        `• Dosen: ${course.lecturer}\n` +
        `• Ruangan: ${course.room}\n` +
        `• Status Kehadiran SISFO: ${course.attendance}`;

      // Check if already exists
      const exists = db.prepare('SELECT id FROM calendar_events WHERE id = ?').get(eventId);
      if (!exists) {
        insertEventStmt.run(
          eventId,
          title,
          startAt,
          endAt,
          course.color,
          `Ruang ${course.room}, Kampus UKRIDA`,
          notes
        );
        createdEvents++;

        // Calculate soft reminder 30 minutes before class
        const startMs = Date.parse(startAt);
        const reminderMs = startMs - 30 * 60_000;
        const triggerAt = new Date(reminderMs).toISOString();
        const reminderId = `alm_cal_${eventId}_30m`;

        insertReminderStmt.run(
          reminderId,
          eventId,
          `🔔 Kuliah: ${course.name} (H-30m)`,
          `Ruang ${course.room} · Dosen: ${course.lecturer}`,
          triggerAt
        );
        createdReminders++;
      }
    }
  }

  // Advance by 1 day
  cur.setDate(cur.getDate() + 1);
}

console.log(`✅ Sukses memasukkan jadwal SISFO UKRIDA ke Kalender Llamrei:`);
console.log(`• Total Agenda Kuliah dibuat: ${createdEvents} sesi`);
console.log(`• Total Soft Reminder (H-30m) dipasang: ${createdReminders} pengingat`);
console.log(`• Rentang Waktu: 19 November 2026 s/d 31 Januari 2027`);
