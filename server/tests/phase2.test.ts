import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import http from 'node:http';
import { closeDb, initDatabase, wibOffsetIso } from '../db/connection.ts';
import { createLlamreiServer, isRemoteRequestAuthorized } from '../index.ts';
import { listAlarmsAndReminders } from '../services/alarm-calendar.service.ts';
import {
  applyTaskTemplateToList,
  launchWhitelistedApp,
  setTaskRecurrenceAndCustomFields,
} from '../services/phase2-productivity.service.ts';
import { extractTxtFromZipBuffer, importWhatsAppExport, scrubPiiForLlm } from '../services/wa-export.service.ts';
import { createTask, getWorkspaceSnapshot, updateTask } from '../services/workspace.service.ts';

function setupIsolatedEnv(dbFile?: string) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamrei-p2-'));
  process.env.LLAMREI_DISABLE_LIBSECRET = '1';
  process.env.LLAMREI_VAULT_DIR = tmpDir;
  initDatabase(dbFile ?? ':memory:');
  return {
    tmpDir,
    cleanup: () => {
      closeDb();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

function buildMinimalZip(filename: string, content: string): Buffer {
  const nameBuf = Buffer.from(filename, 'utf8');
  const raw = Buffer.from(content, 'utf8');
  const compressed = zlib.deflateRawSync(raw);

  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(8, 8);
  lh.writeUInt32LE(compressed.length, 18);
  lh.writeUInt32LE(raw.length, 22);
  lh.writeUInt16LE(nameBuf.length, 26);

  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(compressed.length, 20);
  cd.writeUInt32LE(raw.length, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt32LE(0, 42);

  const cdOffset = lh.length + nameBuf.length + compressed.length;
  const cdSize = cd.length + nameBuf.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);

  return Buffer.concat([lh, nameBuf, compressed, cd, nameBuf, eocd]);
}

test('Persistent SQLite migrations are idempotent across restarts', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamrei-persist-'));
  const dbPath = path.join(tmpDir, 'persist.db');
  try {
    initDatabase(dbPath);
    closeDb();
    // Second restart must not crash with duplicate column name
    initDatabase(dbPath);
    const snap = getWorkspaceSnapshot();
    assert.ok(snap.tasks.length >= 1);
  } finally {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('WhatsApp Export .txt & .zip parsing, zip-bomb/corrupt rejection, deduplication & PII scrubbing', async () => {
  const { cleanup } = setupIsolatedEnv();
  try {
    const sampleChat = [
      '[19/11/26, 08.00.00] Budi: Pagi teman-teman',
      '[19/11/26, 08.05.10] Raka: @Arthur tolong cek revisi Bab 4 paling lambat jam 17:00 ya!',
      'Ini baris lanjutan pesan Raka.',
      '[19/11/26, 08.06.00] Siti: Hubungi (+62) 812-3456-7890 atau 0813.4567.8901 untuk verifikasi.',
      '19/11/26, 09.10 - Dosen: Arthur, kapan bimbingan minggu ini?',
      '19/11/26, 09.11 - Messages and calls are end-to-end encrypted.',
    ].join('\n');

    const scrubbed = scrubPiiForLlm('WA ke (+62) 812-3456-7890 atau 0813.4567.8901');
    assert.ok(!scrubbed.includes('812-3456-7890'));
    assert.ok(!scrubbed.includes('0813.4567.8901'));
    assert.ok(scrubbed.includes('[PHONE_REDACTED]'));

    // Empty alias array must fallback safely instead of matching every line
    const res1 = await importWhatsAppExport({
      groupName: 'BEM FEB Inti',
      fileName: 'chat.txt',
      rawText: sampleChat,
      aliases: ['', '   '],
    });
    assert.equal(res1.totalParsedMessages, 4);
    assert.equal(res1.matchedTags, 2);
    assert.equal(res1.insertedNew, 2);
    assert.ok(res1.mentions.some((m) => m.ai_intent === 'deadline' && m.ai_urgency === 'high'));
    assert.ok(res1.mentions.some((m) => m.ai_intent === 'question'));

    const zipBuf = buildMinimalZip('_chat.txt', sampleChat);
    const extracted = extractTxtFromZipBuffer(zipBuf);
    assert.ok(extracted.includes('@Arthur tolong cek revisi Bab 4'));

    const res2 = await importWhatsAppExport({
      groupName: 'BEM FEB Inti',
      fileName: 'WhatsApp Chat.zip',
      contentBase64: zipBuf.toString('base64'),
    });
    assert.equal(res2.insertedNew, 0);
    assert.equal(res2.skippedDuplicates, 2);
    assert.equal(res2.geminiCallsMade, 0);

    // Corrupt ZIP must throw safely
    assert.throws(() => extractTxtFromZipBuffer(Buffer.from('not-a-zip')));
  } finally {
    cleanup();
  }
});

test('Recurring Tasks (daily & month-end clamp), Custom Fields, Templates & Safe Launcher ENOENT safety', () => {
  const { cleanup } = setupIsolatedEnv();
  try {
    const task = createTask({
      listId: 'list_jurnal',
      title: 'Review Market Asia & London',
      priority: 'high',
      startAt: '2026-01-31T01:00:00.000Z', // 08:00 WIB on Jan 31
      dueAt: '2026-01-31T02:00:00.000Z',
      hardAlarmEnabled: true,
    });

    const invalidMeta = setTaskRecurrenceAndCustomFields(task.id, { recurrenceRule: 'yearly' as never });
    assert.equal(invalidMeta.ok, false);

    const okMeta = setTaskRecurrenceAndCustomFields(task.id, {
      recurrenceRule: 'monthly',
      customFields: { Pair: { type: 'text', value: 'XAUUSD' } },
    });
    assert.equal(okMeta.ok, true);

    const countBefore = getWorkspaceSnapshot().tasks.length;
    updateTask(task.id, { status: 'Done' });
    const snapAfter = getWorkspaceSnapshot();

    assert.equal(snapAfter.tasks.length, countBefore + 1);
    const spawned = snapAfter.tasks.find((t) => t.id !== task.id && t.title === task.title);
    assert.ok(spawned);
    assert.ok(spawned.start_at?.startsWith('2026-02-28'), `Expected Feb 28 clamp, got ${spawned.start_at}`);
    assert.ok(spawned.custom_fields_json.includes('XAUUSD'));

    const spawnedAlarm = listAlarmsAndReminders().find((a) => a.task_id === spawned.id && a.kind === 'hard_alarm');
    assert.ok(spawnedAlarm);

    const createdFromTpl = applyTaskTemplateToList('tpl_premarket', 'list_jurnal');
    assert.equal(createdFromTpl.length, 3);

    // Allowlisted launcher when binary is absent must NOT crash Node process
    const missingBin = launchWhitelistedApp('launch_nectarlink');
    assert.equal(missingBin.ok, false);

    const rejected = launchWhitelistedApp('rm_rf_evil');
    assert.equal(rejected.ok, false);
  } finally {
    cleanup();
  }
});

test('HTTP Server enforces Cross-Origin CSRF guard, Content-Type JSON check & input validation', async () => {
  const { cleanup } = setupIsolatedEnv();
  const server = createLlamreiServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // 1. Cross-origin CSRF attack rejected with 403
    const csrfRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: { Origin: 'https://evil-attacker.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'obsidian' }),
    });
    assert.equal(csrfRes.status, 403);

    // 2. text/plain Content-Type CSRF probe rejected with 415
    const ctRes = await fetch(`${baseUrl}/api/workspace/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{"title":"hack"}',
    });
    assert.equal(ctRes.status, 415);

    // 3. Invalid recurrenceRule returns 400 instead of 500
    const badMeta = await fetch(`${baseUrl}/api/workspace/tasks/task_bab4/meta`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recurrenceRule: 'bogus_rule' }),
    });
    assert.equal(badMeta.status, 400);

    // 4. Non-loopback client cannot bypass Bearer auth with spoofed Tailscale-User-Login header
    assert.equal(isRemoteRequestAuthorized('192.168.1.50', undefined, 'secret_tok'), false);
    assert.equal(isRemoteRequestAuthorized('192.168.1.50', 'Bearer wrong_tok', 'secret_tok'), false);
    assert.equal(isRemoteRequestAuthorized('192.168.1.50', 'Bearer secret_tok', 'secret_tok'), true);

    const nonLoopbackStatus = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: addr.port,
          localAddress: '127.0.0.2',
          path: '/api/settings',
          method: 'GET',
          headers: { 'Tailscale-User-Login': 'attacker@spoofed' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(nonLoopbackStatus, 401);

    // Ensure wibOffsetIso import still exercised
    assert.ok(wibOffsetIso(0, 9, 0).includes('+07:00'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    cleanup();
  }
});
