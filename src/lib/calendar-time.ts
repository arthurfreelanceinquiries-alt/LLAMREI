const wibOffset = 7 * 3_600_000;
const wib = { timeZone: 'Asia/Jakarta' } as const;
const dateLabel = new Intl.DateTimeFormat('id-ID', { ...wib, dateStyle: 'full' });
const timeLabel = new Intl.DateTimeFormat('id-ID', { ...wib, hour: '2-digit', minute: '2-digit' });
const stampLabel = new Intl.DateTimeFormat('id-ID', { ...wib, dateStyle: 'medium', timeStyle: 'short' });

export function wibDateTimeInput(value: string | Date): string {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time + wibOffset).toISOString().slice(0, 16) : '';
}

export function wibDateKey(value: string | Date = new Date()): string {
  return wibDateTimeInput(value).slice(0, 10);
}

export function wibDateTimeToIso(value: string): string | null {
  const date = new Date(`${value}:00+07:00`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function formatWibTime(value: string | Date): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? timeLabel.format(date) : '—';
}

export function formatWibStamp(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? `${stampLabel.format(date)} WIB` : 'Waktu tidak tersedia';
}

export function formatDay(key: string): string {
  return dateLabel.format(new Date(`${key}T00:00:00+07:00`));
}

export function addCalendarDays(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
