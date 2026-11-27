import type { AlarmReminderItem } from '../types/llamrei';

export const alarmStatusLabels = {
  armed: 'Terjadwal',
  ringing: 'Berdering',
  snoozed: 'Ditunda',
  dismissed: 'Dihentikan',
  completed: 'Selesai',
} satisfies Record<AlarmReminderItem['status'], string>;

export function isActiveAlarm(alarm: AlarmReminderItem): boolean {
  return alarm.enabled === 1 && (alarm.status === 'armed' || alarm.status === 'ringing' || alarm.status === 'snoozed');
}

export function alarmTime(alarm: AlarmReminderItem): string {
  return alarm.status === 'snoozed' ? alarm.snoozed_until ?? alarm.trigger_at : alarm.trigger_at;
}
