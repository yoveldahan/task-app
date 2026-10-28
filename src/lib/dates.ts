/** All dates are local calendar dates stored as YYYY-MM-DD strings. */

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + days);
  return r;
}

export function today(now: Date = new Date()): string {
  return toISODate(now);
}

/** Next occurrence of a weekday (0 = Sunday). If today is that day, returns today. */
export function upcomingWeekday(weekday: number, now: Date = new Date()): string {
  const diff = (weekday - now.getDay() + 7) % 7;
  return toISODate(addDays(now, diff));
}

/** The weekly meeting is on Sunday; on Sunday itself it is today's meeting. */
export function upcomingSunday(now: Date = new Date()): string {
  return upcomingWeekday(0, now);
}

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((parseISODate(toISO).getTime() - parseISODate(fromISO).getTime()) / 86_400_000);
}

export type Urgency = 'none' | 'overdue' | 'today' | 'soon' | 'future' | 'done';

export function dueUrgency(dueDate: string | null, done: boolean, now: Date = new Date()): Urgency {
  if (done) return 'done';
  if (!dueDate) return 'none';
  const diff = daysBetween(today(now), dueDate);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff <= 3) return 'soon';
  return 'future';
}

export const URGENCY_LABEL: Record<Urgency, string> = {
  none: '',
  overdue: 'באיחור',
  today: 'להיום',
  soon: 'בקרוב',
  future: 'עתידי',
  done: 'בוצע',
};

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** e.g. "יום ראשון, 2.11.2026" */
export function formatHebrewDate(iso: string, withYear = true): string {
  const d = parseISODate(iso);
  const date = `${d.getDate()}.${d.getMonth() + 1}${withYear ? `.${d.getFullYear()}` : ''}`;
  return `יום ${WEEKDAYS[d.getDay()]}, ${date}`;
}

export function formatShortDate(iso: string): string {
  const d = parseISODate(iso);
  return `${d.getDate()}.${d.getMonth() + 1}`;
}

export function reminderDateTime(date: string, time: string): Date {
  const d = parseISODate(date);
  const [h, m] = time.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}
