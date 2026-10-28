import type { AppData } from './types';
import { CATEGORY_LABELS } from './constants';

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

export function exportJson(data: AppData) {
  download(`ras-backup-${stamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
}

function csvCell(v: string | null | undefined): string {
  const s = v ?? '';
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: string[][]): string {
  // BOM so Excel opens Hebrew as UTF-8.
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function exportTasksCsv(data: AppData) {
  const client = (id: string | null) => data.clients.find((c) => c.id === id);
  const person = (id: string) => data.people.find((p) => p.id === id)?.name ?? '';
  const rows = [
    ['בוצע', 'שם הלקוח', 'סוג לקוח', 'שיוך', 'תיאור המשימה', 'מועד לביצוע', 'תאריך תזכורת', 'שעת תזכורת', 'אצל מי זה תקוע', 'למה זה תקוע'],
    ...data.tasks.map((t) => {
      const c = client(t.clientId);
      return [
        t.done ? 'כן' : 'לא',
        c?.name ?? '',
        c ? CATEGORY_LABELS[c.category] : '',
        data.projects.find((p) => p.id === t.projectId)?.name ?? 'משימה שוטפת',
        t.description,
        t.dueDate ?? '',
        t.reminderDate ?? '',
        t.reminderTime ?? '',
        person(t.stuckWithId),
        t.stuckReason,
      ];
    }),
  ];
  download(`ras-tasks-${stamp()}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
}

export function exportTopicsCsv(data: AppData) {
  const person = (id: string) => data.people.find((p) => p.id === id)?.name ?? '';
  const rows = [
    ['נדון בישיבה', 'תאריך ישיבה', 'נושא', 'לקוח', 'פרויקט', 'מול מי', 'רקע לדיון', 'תאריך תזכורת', 'שעת תזכורת', 'סיכום החלטה'],
    ...data.topics.map((t) => [
      t.discussed ? 'כן' : 'לא',
      t.meetingDate,
      t.topic,
      data.clients.find((c) => c.id === t.clientId)?.name ?? 'כללי / חברה',
      data.projects.find((p) => p.id === t.projectId)?.name ?? '',
      person(t.withWhomId),
      t.background,
      t.reminderDate ?? '',
      t.reminderTime ?? '',
      t.decision,
    ]),
  ];
  download(`ras-meeting-topics-${stamp()}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
}

export function exportClientsCsv(data: AppData) {
  const rows = [
    ['שם הלקוח', 'קטגוריה', 'סטטוס כללי', 'משימות פתוחות'],
    ...data.clients.map((c) => [
      c.name,
      CATEGORY_LABELS[c.category],
      c.status,
      String(data.tasks.filter((t) => t.clientId === c.id && !t.done).length),
    ]),
  ];
  download(`ras-clients-${stamp()}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
}

export function isValidBackup(x: unknown): x is AppData {
  const d = x as AppData;
  return !!d && Array.isArray(d.clients) && Array.isArray(d.tasks) && Array.isArray(d.people);
}
