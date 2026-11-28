import { afterQuietHours, automationLimits, type AutomationDefinition, type AutomationPreview, type AutomationRule, type AutomationStep, type AutomationTrigger, type QuietHours } from '../../shared/automation.ts';
import { getDb } from '../db/connection.ts';
import { HttpBadRequestError } from '../lib/http.ts';
import { sseBus } from '../lib/sse.ts';

interface RuleRow {
  id: string;
  revision: number;
  definition_json: string;
  enabled: number;
}

export function inputRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpBadRequestError(400, 'Permintaan otomasi tidak valid.');
  return input as Record<string, unknown>;
}

function boundedText(value: unknown, maximum: number, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new HttpBadRequestError(400, `${field} harus diisi (maksimum ${maximum} karakter).`);
  return value.trim();
}

export function workspaceListExists(listId: string): boolean {
  return Boolean(getDb().prepare('SELECT 1 FROM lists WHERE id = ?').get(listId));
}

function listIdFrom(value: unknown): string {
  if (typeof value !== 'string' || !workspaceListExists(value)) throw new HttpBadRequestError(400, 'Pilih daftar tugas yang masih tersedia.');
  return value;
}

function readTrigger(raw: unknown): AutomationTrigger {
  const trigger = inputRecord(raw);
  if (trigger.kind === 'manual') return { kind: 'manual' };
  if (trigger.kind === 'task_completed') return { kind: 'task_completed', listId: listIdFrom(trigger.listId) };
  throw new HttpBadRequestError(400, 'Pemicu otomasi tidak didukung.');
}

function readStep(raw: unknown): AutomationStep {
  const step = inputRecord(raw);
  if (step.kind === 'record') return { kind: 'record', note: boundedText(step.note, 1000, 'Catatan') };
  if (step.kind === 'create_task') return { kind: 'create_task', listId: listIdFrom(step.listId), title: boundedText(step.title, 200, 'Judul tugas') };
  throw new HttpBadRequestError(400, 'Langkah misi tidak didukung.');
}

function readQuietHours(raw: unknown): QuietHours | null {
  if (raw == null) return null;
  const { start, end } = inputRecord(raw);
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (typeof start !== 'string' || typeof end !== 'string' || !time.test(start) || !time.test(end) || start === end) {
    throw new HttpBadRequestError(400, 'Pilih awal dan akhir jam hening yang berbeda.');
  }
  return { start, end };
}

function readDefinition(raw: unknown): AutomationDefinition {
  const input = inputRecord(raw);
  const maximum = automationLimits.durationMinutes;
  const maxMinutes = input.maxMinutes;
  const steps = input.steps;
  if (typeof maxMinutes !== 'number' || !Number.isInteger(maxMinutes) || maxMinutes < 1 || maxMinutes > maximum) {
    throw new HttpBadRequestError(400, `Batas waktu misi harus antara 1 dan ${maximum} menit.`);
  }
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > automationLimits.steps) {
    throw new HttpBadRequestError(400, `Misi harus berisi 1–${automationLimits.steps} langkah.`);
  }
  return {
    name: boundedText(input.name, 100, 'Nama aturan'),
    trigger: readTrigger(input.trigger),
    steps: steps.map(readStep),
    maxMinutes,
    quietHours: readQuietHours(input.quietHours),
  };
}

function ruleFrom(row: RuleRow): AutomationRule {
  return { ...JSON.parse(row.definition_json) as AutomationDefinition, id: row.id, revision: row.revision, enabled: Boolean(row.enabled) };
}

export function getAutomationRule(id: string): AutomationRule {
  const row = getDb().prepare('SELECT * FROM automation_rules WHERE id = ?').get(id) as unknown as RuleRow | undefined;
  if (!row) throw new HttpBadRequestError(404, 'Aturan tidak ditemukan.');
  return ruleFrom(row);
}

export function listAutomationRules(): AutomationRule[] {
  const rows = getDb().prepare('SELECT * FROM automation_rules ORDER BY lower(json_extract(definition_json, \'$.name\')), id').all() as unknown as RuleRow[];
  return rows.map(ruleFrom);
}

export function previewAutomation(raw: unknown, now = new Date()): AutomationPreview {
  const definition = readDefinition(raw);
  return {
    definition,
    earliestAt: afterQuietHours(now, definition.quietHours),
    deadlineAt: new Date(now.getTime() + definition.maxMinutes * 60_000).toISOString(),
    costUsd: 0,
  };
}

export function saveAutomationRule(raw: unknown, id?: string): AutomationRule {
  const input = inputRecord(raw);
  const current = id ? getAutomationRule(id) : undefined;
  if (current && current.revision !== input.revision) throw new HttpBadRequestError(409, 'Aturan sudah berubah. Muat ulang sebelum menyimpan.');
  const enabled = input.enabled ?? false;
  if (typeof enabled !== 'boolean') throw new HttpBadRequestError(400, 'Status aturan tidak valid.');
  const definition = readDefinition(raw);
  const triggerList = definition.trigger.kind === 'task_completed' ? definition.trigger.listId : null;
  const active = Number(Boolean(triggerList && enabled));
  const db = getDb();
  const draftId = id ?? crypto.randomUUID();
  if (current) {
    const result = db.prepare(`UPDATE automation_rules SET revision = revision + 1, definition_json = ?, trigger_list_id = ?, enabled = ?
      WHERE id = ? AND revision = ?`).run(JSON.stringify(definition), triggerList, active, draftId, current.revision);
    if (!result.changes) throw new HttpBadRequestError(409, 'Aturan sudah berubah. Muat ulang sebelum menyimpan.');
  } else {
    db.prepare('INSERT INTO automation_rules (id, revision, definition_json, trigger_list_id, enabled) VALUES (?, 1, ?, ?, ?)')
      .run(draftId, JSON.stringify(definition), triggerList, active);
  }
  sseBus.emit('automation:update', {});
  return getAutomationRule(draftId);
}
