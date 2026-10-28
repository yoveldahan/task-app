import { parseQuickInput, type ParsedInput } from './parser';
import { addProject, addTask, addTopic, getState } from './store';
import { formatShortDate } from './dates';
import { showToast } from './toast';
import { notifyReminderSet } from './reminders';

/** Human-readable summary of what the parser recognised, used for the live preview and the toast. */
export function describeParsed(p: ParsedInput): string[] {
  const data = getState();
  const parts: string[] = [];
  const client = data.clients.find((c) => c.id === p.clientId);
  const project = data.projects.find((x) => x.id === p.projectId);
  const person = data.people.find((x) => x.id === p.personId);
  parts.push(p.kind === 'topic' ? `🗓 נושא לישיבה (${formatShortDate(p.meetingDate!)})` : '✅ משימה');
  if (client) parts.push(`👤 ${client.name}`);
  if (project) parts.push(`📁 ${project.name}`);
  if (p.newProjectName) parts.push(`📁 פרויקט חדש: ${p.newProjectName}`);
  if (person) parts.push(`⏳ ${person.name}`);
  if (p.dueDate) parts.push(`📆 ${formatShortDate(p.dueDate)}`);
  if (p.reminderTime && p.reminderDate) parts.push(`🔔 ${formatShortDate(p.reminderDate)} ${p.reminderTime}`);
  return parts;
}

/** Parses free text and creates a task or meeting topic. Returns what was created, or null for empty input. */
export function quickAdd(raw: string): 'task' | 'topic' | null {
  if (!raw.trim()) return null;
  const data = getState();
  const p = parseQuickInput(raw, data);
  const summary = describeParsed(p).join(' · ');

  if (p.kind === 'topic') {
    const topic = addTopic({
      topic: p.text,
      meetingDate: p.meetingDate!,
      clientId: p.clientId,
      projectId: p.projectId,
      withWhomId: p.personId ?? data.settings.meId,
      reminderDate: p.reminderDate,
      reminderTime: p.reminderTime,
    });
    if (topic.reminderDate && topic.reminderTime) {
      notifyReminderSet({ id: topic.id, text: topic.topic, clientId: topic.clientId, date: topic.reminderDate, time: topic.reminderTime });
    }
    showToast(`נוסף לישיבה: ${summary}`, {
      kind: 'success',
      action: { label: 'לנושאים', onClick: () => (window.location.hash = '#meeting') },
    });
    return 'topic';
  }

  const projectId = p.newProjectName && p.clientId ? addProject(p.clientId, p.newProjectName).id : p.projectId;
  const task = addTask({
    description: p.text,
    clientId: p.clientId,
    projectId,
    stuckWithId: p.personId ?? data.settings.meId,
    dueDate: p.dueDate,
    reminderDate: p.reminderDate,
    reminderTime: p.reminderTime,
  });
  if (task.reminderDate && task.reminderTime) {
    notifyReminderSet({ id: task.id, text: task.description, clientId: task.clientId, date: task.reminderDate, time: task.reminderTime });
  }
  showToast(`נוספה ${summary}`, {
    kind: 'success',
    action: { label: 'למשימות', onClick: () => (window.location.hash = '#tasks') },
  });
  return 'task';
}
