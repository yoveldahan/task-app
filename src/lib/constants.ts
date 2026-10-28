import type { ClientCategory } from './types';

export const CATEGORY_LABELS: Record<ClientCategory, string> = {
  big: 'לקוחות גדולים',
  small: 'לקוחות קטנים',
  lead: 'לידים חדשים',
};

/** Singular badge label shown on client cards. */
export const CATEGORY_BADGE: Record<ClientCategory, string> = {
  big: 'לקוח גדול',
  small: 'לקוח קטן',
  lead: 'ליד חדש',
};

export const CATEGORIES: ClientCategory[] = ['big', 'small', 'lead'];

/** Every half hour from 08:00 to 20:00. */
export const REMINDER_TIMES: string[] = Array.from({ length: 25 }, (_, i) => {
  const minutes = 8 * 60 + i * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

export const MEETING_PREFIX = 'נושא לישיבה:';
export const STORAGE_KEY = 'ras-task-manager-v1';
