import { useLayoutEffect, useRef } from 'react';
import type { Reminder } from '../lib/types';
import { REMINDER_TIMES } from '../lib/constants';
import { dueUrgency, formatShortDate, today, upcomingSunday, addDays, toISODate, URGENCY_LABEL } from '../lib/dates';
import { useStore } from '../lib/store';
import { downloadIcs, googleCalendarUrl, isReminderActive, notifyReminderSet } from '../lib/reminders';
import { showToast } from '../lib/toast';

/** Textarea that grows with its content – keeps long descriptions readable on phones. */
export function AutoTextarea({
  value,
  onChange,
  className = '',
  ...rest
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> & {
  value: string;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={`auto-textarea ${className}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
    />
  );
}

export function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function PersonSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
}) {
  const people = useStore((s) => s.people);
  const meId = useStore((s) => s.settings.meId);
  return (
    <select
      className={`select person-select ${value === meId ? 'is-me' : 'is-other'}`}
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    >
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
      {!people.some((p) => p.id === value) && <option value={value}>(נמחק)</option>}
    </select>
  );
}

export function DueDateField({
  value,
  done,
  onChange,
}: {
  value: string | null;
  done: boolean;
  onChange: (v: string | null) => void;
}) {
  const urgency = dueUrgency(value, done);
  return (
    <div className={`due-field urgency-${urgency}`}>
      <input
        type="date"
        className="input date-input"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label="מועד לביצוע"
      />
      {urgency !== 'none' && <span className="urgency-pill">{URGENCY_LABEL[urgency]}</span>}
    </div>
  );
}

/** Reminder date + half-hour dropdown + quick chips + calendar sync buttons. */
export function ReminderField({
  item,
  closed,
  text,
  clientId,
  onChange,
}: {
  item: Reminder & { id: string };
  closed: boolean;
  text: string;
  clientId: string | null;
  onChange: (patch: Partial<Reminder>) => void;
}) {
  const clientName = useStore((s) => s.clients.find((c) => c.id === clientId)?.name ?? '');
  const active = isReminderActive(item, closed);
  const fired = !!item.reminderDate && !!item.reminderTime && item.reminderFiredFor === `${item.reminderDate} ${item.reminderTime}`;

  const set = (date: string | null, time: string | null) => {
    const patch: Partial<Reminder> = { reminderDate: date, reminderTime: time };
    onChange(patch);
    if (date && time && !closed) {
      notifyReminderSet({ id: item.id, text, clientId, date, time });
      showToast(`🔔 תזכורת נקבעה ל-${formatShortDate(date)} בשעה ${time}`, { kind: 'success', duration: 2500 });
    }
  };

  // Picking only a date defaults the time to 09:00 so the reminder is armed immediately.
  const setDate = (date: string | null) => set(date, date ? (item.reminderTime ?? '09:00') : null);
  const setTime = (time: string | null) => set(time ? (item.reminderDate ?? today()) : item.reminderDate, time);

  const now = new Date();
  const quick = [
    { label: 'היום', date: today(now) },
    { label: 'מחר', date: toISODate(addDays(now, 1)) },
    { label: "יום א'", date: now.getDay() === 0 ? toISODate(addDays(now, 7)) : upcomingSunday(now) },
  ];

  const title = clientName ? `${clientName}: ${text}` : text;

  return (
    <div className={`reminder-field ${active ? 'is-active' : ''} ${fired ? 'is-fired' : ''}`}>
      <div className="reminder-inputs">
        <span className="reminder-bell" title={active ? 'תזכורת פעילה' : fired ? 'התזכורת הופעלה' : 'אין תזכורת'}>
          {active ? '🔔' : fired ? '✔️' : '🔕'}
        </span>
        <input
          type="date"
          className="input date-input"
          value={item.reminderDate ?? ''}
          onChange={(e) => setDate(e.target.value || null)}
          aria-label="תאריך תזכורת"
        />
        <select
          className="select time-select"
          value={item.reminderTime ?? ''}
          onChange={(e) => setTime(e.target.value || null)}
          aria-label="שעת תזכורת"
        >
          <option value="">שעה</option>
          {REMINDER_TIMES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="reminder-actions">
        {quick.map((q) => (
          <button
            key={q.label}
            type="button"
            className={`chip ${item.reminderDate === q.date ? 'chip-on' : ''}`}
            onClick={() => setDate(q.date)}
          >
            {q.label}
          </button>
        ))}
        {item.reminderDate && item.reminderTime && (
          <>
            <a
              className="chip chip-icon"
              href={googleCalendarUrl(title, 'נוצר מאפליקציית ראס – ניהול משימות', item.reminderDate, item.reminderTime)}
              target="_blank"
              rel="noreferrer"
              title="הוסף ליומן Google"
            >
              📅 Google
            </a>
            <button
              type="button"
              className="chip chip-icon"
              title="הורד תזכורת ליומן הטלפון (ics)"
              onClick={() => downloadIcs(item.id, title, 'נוצר מאפליקציית ראס – ניהול משימות', item.reminderDate!, item.reminderTime!)}
            >
              📲 יומן
            </button>
            <button type="button" className="chip chip-icon chip-clear" title="נקה תזכורת" onClick={() => set(null, null)}>
              ✕
            </button>
          </>
        )}
      </div>
    </div>
  );
}
