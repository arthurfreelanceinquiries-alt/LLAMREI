import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDb, initDatabase } from '../db/connection.ts';
import { saveDailyCheckIn } from '../services/lifeos.service.ts';
import {
  createOrUpdateWorkspaceDoc,
  deleteWorkspaceDoc,
  exportWorkspaceAsCsv,
  exportWorkspaceAsMarkdown,
  getGanttAndWorkloadSummary,
  importTasksIntoList,
  listWorkspaceDocs,
} from '../services/phase3-docs-io.service.ts';
import {
  createTradingJournalEntry,
  deleteTradingJournalEntry,
  getTradingJournalState,
} from '../services/trading-journal.service.ts';
import { createTask, getWorkspaceSnapshot } from '../services/workspace.service.ts';

function setupIsolatedEnv() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamrei-p3-'));
  process.env.LLAMREI_DISABLE_LIBSECRET = '1';
  process.env.LLAMREI_VAULT_DIR = tmpDir;
  initDatabase(':memory:');
  return () => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };
}

test('Trading Journal tracks R-multiple, Win Rate, Calm vs Tilt patterns & Tilt Guard correlation', () => {
  const cleanup = setupIsolatedEnv();
  try {
    saveDailyCheckIn({ sleepHours: 4.5, energyLevel: 2, mentalState: 'tilted' });

    const invalid = createTradingJournalEntry({
      symbol: 'XAUUSD',
      direction: 'long' as never,
      session: 'london',
      entryPrice: 2640,
    });
    assert.equal(invalid.ok, false);

    const created = createTradingJournalEntry({
      symbol: 'XAUUSD',
      direction: 'sell',
      session: 'new_york',
      entryPrice: 2650,
      exitPrice: 2660,
      rMultiple: -1.0,
      pnlUsd: -100,
      outcome: 'loss',
      emotion: 'revenge',
      setupReason: 'Entry balas dendam',
    });
    assert.equal(created.ok, true);
    assert.ok(created.entry);

    const state = getTradingJournalState();
    assert.equal(state.stats.totalTrades, 3);
    assert.equal(state.stats.tiltLossCount, 2);
    assert.ok(state.stats.patternSummary.includes('Tilt Guard HIGH'));
    assert.ok(state.stats.patternSummary.includes('bukan saran investasi'));

    assert.equal(deleteTradingJournalEntry(created.entry.id), true);
  } finally {
    cleanup();
  }
});

test('Linked Docs, Gantt/Workload, CSV formula neutralization & CSV/Markdown Import/Export', () => {
  const cleanup = setupIsolatedEnv();
  try {
    // 1. Linked Docs
    const doc = createOrUpdateWorkspaceDoc({
      linkedTaskId: 'task_bab4',
      title: 'Ringkasan Revisi Pembimbing',
      contentMd: '- Perbaiki tabel koefisien',
    });
    const taskDocs = listWorkspaceDocs('task_bab4');
    assert.ok(taskDocs.some((d) => d.id === doc.id));
    assert.equal(deleteWorkspaceDoc(doc.id), true);

    // 2. CSV formula-injection neutralization
    const evilTask = createTask({
      listId: 'list_bab4',
      title: '=CMD("calc")',
      priority: 'normal',
    });
    const csv = exportWorkspaceAsCsv('list_bab4');
    assert.ok(csv.includes('"\'=CMD(""calc"")"'), `Expected neutralized CSV formula, got:\n${csv}`);

    const md = exportWorkspaceAsMarkdown('list_bab4');
    assert.ok(md.includes('=CMD("calc")'));
    assert.ok(evilTask.id);

    // 3. Import CSV & Markdown back into list_tugas_kuliah
    const countBefore = getWorkspaceSnapshot().tasks.length;
    const csvImp = importTasksIntoList({
      listId: 'list_tugas_kuliah',
      format: 'csv',
      content: 'title,priority,status\n"Slide Presentasi Bab 4",high,To Do\n"Latihan Sidang",urgent,In Progress',
    });
    assert.equal(csvImp.ok, true);
    assert.equal(csvImp.importedCount, 2);

    const mdImp = importTasksIntoList({
      listId: 'list_tugas_kuliah',
      format: 'markdown',
      content: '- [ ] **[HIGH]** Cetak Draft Skripsi\n- [x] **[NORMAL]** Isi KRS',
    });
    assert.equal(mdImp.ok, true);
    assert.equal(mdImp.importedCount, 2);
    assert.equal(getWorkspaceSnapshot().tasks.length, countBefore + 4);

    // 4. Gantt & Weekly Workload
    const gantt = getGanttAndWorkloadSummary();
    assert.ok(gantt.timelineTasks.length >= 4);
    assert.ok(gantt.weeklyWorkload.length >= 1);
  } finally {
    cleanup();
  }
});
