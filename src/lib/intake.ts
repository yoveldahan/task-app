/**
 * Turns external input (quick-capture text, URL parameters, webhook body) into a
 * ready task or meeting topic. Pure: used by the app and by the Netlify function.
 */
import type { AppData, MeetingTopic, Project, Task } from './types';
import { bestMatch, extractDateTime, isMeetingText, nameKeywords, parseQuickInput, roundToSlot } from './parser';
import { addDays, formatShortDate, toISODate } from './dates';
import { blankTask, blankTopic } from './seed';
import { newId } from './id';
import { MEETING_PREFIX, REMINDER_TIMES } from './constants';

export interface IntakeInput {
  /** Free text, parsed like the quick-capture bar (client, person, dates, "נושא לישיבה:"). */
  text: string;
  /** Force a meeting topic even without the "נושא לישיבה:" prefix. */
  type?: 'task' | 'topic';
  /** Explicit fields override what was parsed from the text. */
  client?: string;
  project?: string;
  due?: string;
  reminderDate?: string;
  reminderTime?: string;
  stuckWith?: string;
  stuckReason?: string;
}

export interface IntakeResult {
  kind: 'task' | 'topic';
  task: Task | null;
  topic: MeetingTopic | null;
  newProject: Project | null;
  /** Explicit values that could not be resolved (e.g. unknown client name). */
  warnings: string[];
}

export const MAX_TEXT_LENGTH = 2000;

export function matchClientId(name: string, data: AppData): string | null {
  const q = name.trim().toLowerCase();
  if (!q) return null;
  const exact = data.clients.find((c) => nameKeywords(c.name).includes(q));
  if (exact) return exact.id;
  return bestMatch(q, data.clients.map((c) => ({ id: c.id, keywords: nameKeywords(c.name) })))?.id ?? null;
}

export function matchPersonId(name: string, data: AppData): string | null {
  const q = name.trim().toLowerCase();
  if (!q) return null;
  if (['me', 'אני', 'אצלי'].includes(q)) return data.settings.meId;
  const byId = data.people.find((p) => p.id === q);
  if (byId) return byId.id;
  return data.people.find((p) => nameKeywords(p.name).includes(q))?.id ?? null;
}

/** "2026-11-05", "5/11", "ב-5.11", "מחר", "יום ראשון" → YYYY-MM-DD */
export function parseDateInput(value: string, now: Date): string | null {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return extractDateTime(v, now).date ?? extractDateTime(`ב-${v}`, now).date;
}

export function parseTimeInput(value: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  const slot = roundToSlot(h, min);
  return REMINDER_TIMES.includes(slot) ? slot : null;
}

export function intake(input: IntakeInput, data: AppData, now: Date = new Date()): IntakeResult {
  const warnings: string[] = [];
  let text = input.text.trim().slice(0, MAX_TEXT_LENGTH);
  if (input.type === 'topic' && !isMeetingText(text)) text = `${MEETING_PREFIX} ${text}`;
  const p = parseQuickInput(text, data, now);

  let description = p.text;
  let clientId = p.clientId;
  let projectId = p.projectId;
  let newProjectName = p.newProjectName;
  let personId = p.personId;
  let dueDate = p.dueDate;
  let reminderDate = p.reminderDate;
  let reminderTime = p.reminderTime;

  if (input.client?.trim()) {
    const id = matchClientId(input.client, data);
    if (id) {
      if (id !== clientId) projectId = null;
      clientId = id;
    } else {
      warnings.push(`הלקוח "${input.client.trim()}" לא נמצא`);
      description = `${description} (לקוח: ${input.client.trim()})`;
    }
  }

  if (input.project?.trim()) {
    const q = input.project.trim().toLowerCase();
    const own = data.projects.filter((x) => x.clientId === clientId && !x.closed);
    const found = own.find((x) => {
      const n = x.name.toLowerCase();
      return n.includes(q) || q.includes(n.replace(/^\s*פרויקט\s+/, ''));
    });
    if (found) {
      projectId = found.id;
      newProjectName = null;
    } else if (clientId) {
      projectId = null;
      newProjectName = input.project.trim();
    } else {
      warnings.push('לא ניתן לשייך פרויקט בלי לקוח');
    }
  }

  if (input.stuckWith?.trim()) {
    const id = matchPersonId(input.stuckWith, data);
    if (id) personId = id;
    else warnings.push(`"${input.stuckWith.trim()}" לא נמצא ברשימת "אצל מי זה תקוע"`);
  }

  if (input.due?.trim()) {
    const d = parseDateInput(input.due, now);
    if (d) dueDate = d;
    else warnings.push(`תאריך לא מזוהה: ${input.due.trim()}`);
  }

  if (input.reminderDate?.trim()) {
    const d = parseDateInput(input.reminderDate, now);
    if (d) reminderDate = d;
    else warnings.push(`תאריך תזכורת לא מזוהה: ${input.reminderDate.trim()}`);
  }
  if (input.reminderTime?.trim()) {
    const t = parseTimeInput(input.reminderTime);
    if (t) reminderTime = t;
    else warnings.push(`שעת תזכורת לא מזוהה: ${input.reminderTime.trim()}`);
  }
  // Same rules as the reminder field in the app.
  if (reminderTime && !reminderDate) {
    const [h, m] = reminderTime.split(':').map(Number);
    const passed = now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
    reminderDate = dueDate ?? toISODate(passed ? addDays(now, 1) : now);
  }
  if (reminderDate && !reminderTime) reminderTime = '09:00';

  const createdAt = now.toISOString();
  let newProject: Project | null = null;
  if (newProjectName && clientId) {
    newProject = { id: newId(), clientId, name: newProjectName, closed: false, createdAt };
    projectId = newProject.id;
  }

  const meId = data.settings.meId;
  if (p.kind === 'topic') {
    return {
      kind: 'topic',
      task: null,
      newProject,
      warnings,
      topic: blankTopic({
        topic: description,
        meetingDate: p.meetingDate!,
        clientId,
        projectId,
        withWhomId: personId ?? meId,
        background: input.stuckReason?.trim() ?? '',
        reminderDate,
        reminderTime,
        createdAt,
      }),
    };
  }
  return {
    kind: 'task',
    topic: null,
    newProject,
    warnings,
    task: blankTask({
      description,
      clientId,
      projectId,
      stuckWithId: personId ?? meId,
      stuckReason: input.stuckReason?.trim() ?? '',
      dueDate,
      reminderDate,
      reminderTime,
      createdAt,
    }),
  };
}

export interface DescribeFields {
  kind: 'task' | 'topic';
  clientId: string | null;
  projectId: string | null;
  newProjectName?: string | null;
  personId: string | null;
  dueDate: string | null;
  reminderDate: string | null;
  reminderTime: string | null;
  meetingDate: string | null;
}

export function describeFields(f: DescribeFields, data: AppData, extraProjects: Project[] = []): string[] {
  const parts: string[] = [];
  const client = data.clients.find((c) => c.id === f.clientId);
  const project = [...data.projects, ...extraProjects].find((x) => x.id === f.projectId);
  const person = data.people.find((x) => x.id === f.personId);
  parts.push(f.kind === 'topic' ? `🗓 נושא לישיבה (${formatShortDate(f.meetingDate!)})` : '✅ משימה');
  if (client) parts.push(`👤 ${client.name}`);
  if (project) parts.push(`📁 ${project.name}`);
  if (f.newProjectName) parts.push(`📁 פרויקט חדש: ${f.newProjectName}`);
  if (person) parts.push(`⏳ ${person.name}`);
  if (f.dueDate) parts.push(`📆 ${formatShortDate(f.dueDate)}`);
  if (f.reminderTime && f.reminderDate) parts.push(`🔔 ${formatShortDate(f.reminderDate)} ${f.reminderTime}`);
  return parts;
}

export function describeResult(r: IntakeResult, data: AppData): string[] {
  const item = r.task ?? r.topic!;
  return describeFields(
    {
      kind: r.kind,
      clientId: item.clientId,
      projectId: item.projectId,
      personId: r.task ? r.task.stuckWithId : r.topic!.withWhomId,
      dueDate: r.task?.dueDate ?? null,
      reminderDate: item.reminderDate,
      reminderTime: item.reminderTime,
      meetingDate: r.topic?.meetingDate ?? null,
    },
    data,
    r.newProject ? [r.newProject] : [],
  );
}
