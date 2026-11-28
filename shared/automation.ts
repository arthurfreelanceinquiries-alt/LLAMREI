export const automationLimits = { steps: 6, durationMinutes: 1440, defaultDurationMinutes: 60 };

export type AutomationTrigger = { kind: 'manual' } | { kind: 'task_completed'; listId: string };
export type AutomationStep = { kind: 'record'; note: string } | { kind: 'create_task'; listId: string; title: string };
export type QuietHours = { start: string; end: string };

export interface AutomationDefinition {
  name: string;
  trigger: AutomationTrigger;
  steps: AutomationStep[];
  maxMinutes: number;
  quietHours: QuietHours | null;
}

export interface AutomationRule extends AutomationDefinition {
  id: string;
  revision: number;
  enabled: boolean;
}

export type MissionState = 'queued' | 'waiting_approval' | 'completed' | 'cancelled' | 'expired' | 'failed';
export const activeMissionStates: readonly MissionState[] = ['queued', 'waiting_approval'];

export interface MissionSummary {
  id: string;
  name: string;
  status: MissionState;
  stepIndex: number;
  totalSteps: number;
  createdAt: string;
  deadlineAt: string;
  runAt: string;
  reason: string | null;
}

export interface MissionCheckpoint {
  stepIndex: number;
  approvedAt: string | null;
  finishedAt: string | null;
  taskId: string | null;
}

export interface MissionDetail extends MissionSummary {
  definition: AutomationDefinition;
  sourceTaskId: string | null;
  checkpoints: MissionCheckpoint[];
  approval: { id: string; expiresAt: string } | null;
}

export interface AutomationPreview {
  definition: AutomationDefinition;
  earliestAt: string;
  deadlineAt: string;
  costUsd: 0;
}

export interface AutomationEvent {
  id: number;
  ruleName: string;
  sourceTaskId: string;
  createdAt: string;
  status: 'pending' | 'handled' | 'skipped' | 'failed';
  reason: string | null;
  missionId: string | null;
}

export interface AutomationSnapshot {
  rules: AutomationRule[];
  missions: MissionSummary[];
  events: AutomationEvent[];
}

function minuteOfDay(clock: string): number {
  const [hours, minutes] = clock.split(':').map(Number);
  return hours * 60 + minutes;
}

export function afterQuietHours(time: Date, quietHours: QuietHours | null): string {
  if (!quietHours) return time.toISOString();
  const hourInWib = (time.getUTCHours() + 7) % 24;
  const minute = hourInWib * 60 + time.getUTCMinutes();
  const start = minuteOfDay(quietHours.start);
  const end = minuteOfDay(quietHours.end);
  const quiet = start < end ? minute >= start && minute < end : minute >= start || minute < end;
  if (!quiet) return time.toISOString();

  const minutesUntilEnd = (end - minute + 1440) % 1440;
  const minuteStart = Math.floor(time.getTime() / 60_000) * 60_000;
  return new Date(minuteStart + minutesUntilEnd * 60_000).toISOString();
}
