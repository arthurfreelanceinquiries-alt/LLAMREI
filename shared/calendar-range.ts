export function shiftCalendarEnd(previousStart: string, previousEnd: string | null, nextStart: string): string | null {
  if (!previousEnd) return null;
  const duration = Date.parse(previousEnd) - Date.parse(previousStart);
  const shiftedEnd = new Date(Date.parse(nextStart) + Math.max(0, duration));
  return Number.isFinite(shiftedEnd.valueOf()) ? shiftedEnd.toISOString() : null;
}
