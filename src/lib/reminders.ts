import type { AppData, MeetingTopic, Reminder, Task } from './types';
import { reminderDateTime } from './dates';
import { getState, update } from './store';
import { postWebhook } from './storage';
import { showToast } from './toast';

let swRegistration: ServiceWorkerRegistration | null = null;

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swRegistration = await navigator.serviceWorker.register('./sw.js');
  } catch {
    swRegistration = null;
  }
}

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

async function systemNotify(title: string, body: string) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  const options: NotificationOptions = { body, icon: './icon.svg', badge: './icon.svg', lang: 'he', dir: 'rtl' };
  try {
    // Android Chrome only allows notifications through a service worker.
    if (swRegistration) await swRegistration.showNotification(title, options);
    else new Notification(title, options);
  } catch {
    /* in-app toast is still shown */
  }
}

let audioCtx: AudioContext | null = null;
function beep() {
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    [0, 0.25].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.22);
    });
  } catch {
    /* audio blocked until first user interaction */
  }
}

export function reminderKey(r: Reminder): string | null {
  return r.reminderDate && r.reminderTime ? `${r.reminderDate} ${r.reminderTime}` : null;
}

export function isReminderActive(r: Reminder, closed: boolean): boolean {
  const key = reminderKey(r);
  return !!key && !closed && r.reminderFiredFor !== key;
}

function clientName(data: AppData, id: string | null): string {
  return data.clients.find((c) => c.id === id)?.name ?? 'כללי';
}

/** Checks all tasks and topics and fires reminders whose time has come. */
export function checkReminders(now: Date = new Date()) {
  const data = getState();
  const due: { kind: 'task' | 'topic'; id: string; key: string; title: string; body: string }[] = [];

  const consider = (item: Task | MeetingTopic, kind: 'task' | 'topic', closed: boolean, text: string) => {
    const key = reminderKey(item);
    if (!key || closed || item.reminderFiredFor === key) return;
    if (reminderDateTime(item.reminderDate!, item.reminderTime!) > now) return;
    due.push({
      kind,
      id: item.id,
      key,
      title: kind === 'task' ? `⏰ תזכורת: ${clientName(data, item.clientId)}` : '⏰ נושא לישיבה',
      body: text || '(ללא תיאור)',
    });
  };

  for (const t of data.tasks) consider(t, 'task', t.done, t.description);
  for (const t of data.topics) consider(t, 'topic', t.discussed, t.topic);
  if (!due.length) return;

  update((d) => {
    for (const r of due) {
      const item = r.kind === 'task' ? d.tasks.find((x) => x.id === r.id) : d.topics.find((x) => x.id === r.id);
      if (item) item.reminderFiredFor = r.key;
    }
  });

  beep();
  for (const r of due) {
    showToast(`${r.title} — ${r.body}`, {
      kind: 'reminder',
      duration: 0,
      action: {
        label: 'פתח',
        onClick: () => (window.location.hash = r.kind === 'task' ? '#tasks' : '#meeting'),
      },
    });
    systemNotify(r.title, r.body);
  }
}

export function startReminderLoop(): () => void {
  checkReminders();
  const timer = setInterval(() => checkReminders(), 20_000);
  // Phones throttle background timers; check as soon as the app is visible again.
  const onVisible = () => document.visibilityState === 'visible' && checkReminders();
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** Called whenever a reminder date/time is set, so external automations (e.g. Google Tasks via Make) can mirror it. */
export function notifyReminderSet(item: { id: string; text: string; clientId: string | null; date: string; time: string }) {
  const { webhookUrl, webhookSendReminders } = getState().settings;
  if (!webhookUrl || !webhookSendReminders) return;
  postWebhook(webhookUrl, {
    event: 'reminder-set',
    sentAt: new Date().toISOString(),
    reminder: {
      id: item.id,
      title: item.text,
      client: clientName(getState(), item.clientId),
      due: reminderDateTime(item.date, item.time).toISOString(),
      date: item.date,
      time: item.time,
    },
  });
}

// ---------- Calendar / Tasks export ----------

function compact(date: string, time: string, addMinutes = 0): string {
  const d = reminderDateTime(date, time);
  d.setMinutes(d.getMinutes() + addMinutes);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
}

export function googleCalendarUrl(title: string, details: string, date: string, time: string): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    details,
    dates: `${compact(date, time)}/${compact(date, time, 15)}`,
    ctz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jerusalem',
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);
}

/** Downloads an .ics event with an alarm; on phones this opens straight into the calendar app. */
export function downloadIcs(id: string, title: string, details: string, date: string, time: string) {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RAS//Task Manager//HE',
    'BEGIN:VEVENT',
    `UID:${id}-${compact(date, time)}@ras-tasks`,
    `DTSTAMP:${compact(new Date().toISOString().slice(0, 10), '00:00')}`,
    `DTSTART:${compact(date, time)}`,
    `DTEND:${compact(date, time, 15)}`,
    `SUMMARY:${icsEscape(title)}`,
    `DESCRIPTION:${icsEscape(details)}`,
    'BEGIN:VALARM',
    'TRIGGER:PT0M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'reminder.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
