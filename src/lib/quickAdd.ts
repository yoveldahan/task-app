import type { ParsedInput } from './parser';
import { getState, update } from './store';
import { showToast } from './toast';
import { notifyReminderSet } from './reminders';
import { describeFields, describeResult, intake, type IntakeInput } from './intake';

/** Live preview chips for the quick-capture bar. */
export function describeParsed(p: ParsedInput): string[] {
  return describeFields(p, getState());
}

/** Creates a task or meeting topic from text and/or structured fields. Returns what was created, or null for empty input. */
export function quickAddInput(input: IntakeInput): 'task' | 'topic' | null {
  if (!input.text.trim()) return null;
  const data = getState();
  const r = intake(input, data);
  const summary = describeResult(r, data).join(' · ');

  update((d) => {
    if (r.newProject) d.projects.push(r.newProject);
    if (r.task) d.tasks.push(r.task);
    if (r.topic) d.topics.push(r.topic);
  });

  const item = r.task ?? r.topic!;
  if (item.reminderDate && item.reminderTime) {
    notifyReminderSet({
      id: item.id,
      text: r.task ? r.task.description : r.topic!.topic,
      clientId: item.clientId,
      date: item.reminderDate,
      time: item.reminderTime,
    });
  }

  const isTopic = r.kind === 'topic';
  showToast(`${isTopic ? 'נוסף לישיבה' : 'נוספה'}: ${summary}${r.warnings.length ? ` ⚠️ ${r.warnings.join('; ')}` : ''}`, {
    kind: r.warnings.length ? 'info' : 'success',
    duration: r.warnings.length ? 8000 : 4000,
    action: isTopic
      ? { label: 'לנושאים', onClick: () => (window.location.hash = '#meeting') }
      : { label: 'למשימות', onClick: () => (window.location.hash = '#tasks') },
  });
  return r.kind;
}

export function quickAdd(raw: string): 'task' | 'topic' | null {
  return quickAddInput({ text: raw });
}
