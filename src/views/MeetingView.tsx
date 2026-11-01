import { useState } from 'react';
import type { MeetingTopic } from '../lib/types';
import { MEETING_PREFIX, SUMMARY_EMAIL } from '../lib/constants';
import { formatHebrewDate, formatShortDate, upcomingSunday } from '../lib/dates';
import { convertTopicToTask, deleteTopic, setMeetingSummary, update, updateTopic, useData } from '../lib/store';
import { postWebhook } from '../lib/storage';
import { quickAdd } from '../lib/quickAdd';
import { showToast } from '../lib/toast';
import { AutoTextarea, Field, PersonSelect, ReminderField } from '../components/fields';
import { AddTaskInline } from '../components/TaskItem';

function TopicItem({
  topic,
  nextSunday,
  minimized,
  onMinimizedChange,
}: {
  topic: MeetingTopic;
  nextSunday: string;
  minimized: boolean;
  onMinimizedChange: (minimized: boolean) => void;
}) {
  const data = useData();
  const set = (patch: Partial<MeetingTopic>) => updateTopic(topic.id, patch);
  const projects = data.projects.filter((p) => p.clientId === topic.clientId && (!p.closed || p.id === topic.projectId));
  const carriedOver = !topic.discussed && topic.meetingDate < nextSunday;

  if (minimized) {
    return (
      <div className={`task-item topic-item topic-item-min ${topic.discussed ? 'is-done' : ''}`}>
        <div className="task-main-row">
          <label className="check" title="נדון בישיבה">
            <input type="checkbox" checked={topic.discussed} onChange={(e) => set({ discussed: e.target.checked })} />
            <span className="check-box" aria-hidden />
          </label>
          <button
            type="button"
            className="topic-title"
            title="הרחב נושא"
            onClick={() => onMinimizedChange(false)}
          >
            {topic.topic.trim() || 'נושא ללא כותרת'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`task-item topic-item ${topic.discussed ? 'is-done' : ''}`}>
      <div className="task-main-row">
        <label className="check" title="נדון בישיבה">
          <input type="checkbox" checked={topic.discussed} onChange={(e) => set({ discussed: e.target.checked })} />
          <span className="check-box" aria-hidden />
        </label>
        <AutoTextarea
          className="task-desc"
          value={topic.topic}
          placeholder="נושא לישיבה / פירוט"
          aria-label="נושא לישיבה"
          onChange={(v) => set({ topic: v })}
        />
        <button
          type="button"
          className="icon-btn"
          title="מזער לנושא בלבד"
          aria-label="מזער לנושא בלבד"
          onClick={() => onMinimizedChange(true)}
        >
          ⊟
        </button>
        <button
          type="button"
          className="icon-btn danger"
          title="מחק נושא"
          onClick={() => {
            deleteTopic(topic.id);
            showToast('הנושא נמחק', {
              action: { label: 'בטל', onClick: () => update((d) => void d.topics.push(topic)) },
              duration: 6000,
            });
          }}
        >
          🗑
        </button>
      </div>

      <div className="task-fields">
        <Field label="תאריך ישיבה (יום א')">
          <div className="inline-row">
            <input
              type="date"
              className="input date-input"
              value={topic.meetingDate}
              onChange={(e) => e.target.value && set({ meetingDate: e.target.value })}
            />
            {carriedOver && (
              <button type="button" className="chip" onClick={() => set({ meetingDate: nextSunday })}>
                ← לישיבה הקרובה
              </button>
            )}
          </div>
        </Field>
        <Field label="לקוח / פרויקט קשור">
          <div className="inline-row">
            <select
              className="select"
              value={topic.clientId ?? ''}
              onChange={(e) => set({ clientId: e.target.value || null })}
            >
              <option value="">כללי / חברה</option>
              {data.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {projects.length > 0 && (
              <select
                className="select"
                value={topic.projectId ?? ''}
                onChange={(e) => set({ projectId: e.target.value || null })}
                aria-label="פרויקט קשור"
              >
                <option value="">ללא פרויקט</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    📁 {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </Field>
        <Field label="מול מי בישיבה / אצל מי זה תקוע">
          <PersonSelect value={topic.withWhomId} onChange={(id) => set({ withWhomId: id })} />
        </Field>
        <Field label="תזכורת" className="field-reminder">
          <ReminderField
            item={topic}
            closed={topic.discussed}
            text={`${MEETING_PREFIX} ${topic.topic}`}
            clientId={topic.clientId}
            onChange={(patch) => set(patch)}
          />
        </Field>
        <Field label="למה זה תקוע / רקע לדיון" className="field-wide">
          <AutoTextarea
            className="input"
            value={topic.background}
            placeholder="רקע קצר לדיון"
            onChange={(v) => set({ background: v })}
          />
        </Field>
        <Field label="סיכום החלטה מהישיבה" className="field-wide field-decision">
          <AutoTextarea
            className="input decision-input"
            value={topic.decision}
            placeholder="מה הוחלט בישיבה?"
            onChange={(v) => set({ decision: v })}
          />
        </Field>
      </div>

      <div className="topic-footer">
        {topic.convertedTaskId && data.tasks.some((t) => t.id === topic.convertedTaskId) ? (
          <span className="converted-note">✓ הומר למשימה</span>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!topic.decision.trim() && !topic.topic.trim()}
            onClick={() => {
              const task = convertTopicToTask(topic.id);
              if (task) {
                showToast(`נוצרה משימה: ${task.description}`, {
                  kind: 'success',
                  action: { label: 'למשימות', onClick: () => (window.location.hash = '#tasks') },
                });
              }
            }}
          >
            ↩ הפוך למשימה
          </button>
        )}
      </div>
    </div>
  );
}

function agendaText(topics: MeetingTopic[], date: string, clientName: (id: string | null) => string, person: (id: string) => string) {
  const lines = [`סדר יום – ישיבת ${formatHebrewDate(date)}`, ''];
  topics.forEach((t, i) => {
    lines.push(`${i + 1}. ${t.topic} [${clientName(t.clientId)} | ${person(t.withWhomId)}]`);
    if (t.background.trim()) lines.push(`   רקע: ${t.background.trim()}`);
    if (t.decision.trim()) lines.push(`   החלטה: ${t.decision.trim()}`);
  });
  return lines.join('\n');
}

/** dd.mm.yyyy for the email subject. */
function dotDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function MeetingView() {
  const data = useData();
  const [showDiscussed, setShowDiscussed] = useState(false);
  const [minimized, setMinimized] = useState<Set<string>>(() => new Set());
  const nextSunday = upcomingSunday();
  const summaryText = data.summaries.find((s) => s.meetingDate === nextSunday)?.summary ?? '';
  const allMinimized = data.topics.length > 0 && data.topics.every((t) => minimized.has(t.id));

  const setTopicMinimized = (id: string, on: boolean) =>
    setMinimized((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const sendSummary = async () => {
    const ok = await postWebhook(data.settings.webhookUrl, {
      event: 'meeting-summary-email',
      sentAt: new Date().toISOString(),
      to: SUMMARY_EMAIL,
      subject: `ישיבה שבועית ${dotDate(nextSunday)}`,
      meetingDate: nextSunday,
      body: summaryText.trim(),
    });
    showToast(ok ? `הסיכום נשלח לאוטומציה למייל ${SUMMARY_EMAIL}` : 'השליחה נכשלה – בדוק את כתובת ה-webhook בהגדרות', {
      kind: ok ? 'success' : 'error',
    });
  };

  const open = data.topics.filter((t) => !t.discussed);
  const upcoming = open.filter((t) => t.meetingDate >= nextSunday).sort((a, b) => (a.meetingDate < b.meetingDate ? -1 : 1));
  const carried = open.filter((t) => t.meetingDate < nextSunday);
  const discussed = data.topics
    .filter((t) => t.discussed)
    .sort((a, b) => (a.meetingDate > b.meetingDate ? -1 : 1));

  const clientName = (id: string | null) => data.clients.find((c) => c.id === id)?.name ?? 'כללי / חברה';
  const person = (id: string) => data.people.find((p) => p.id === id)?.name ?? '';

  return (
    <div className="view">
      <div className="meeting-hero card">
        <div>
          <div className="meeting-kicker">הישיבה הקרובה</div>
          <h2 className="meeting-date">{formatHebrewDate(nextSunday)}</h2>
        </div>
        <div className="meeting-stats">
          <span className="stat-num">{open.length}</span>
          <span className="stat-label">נושאים פתוחים לדיון</span>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm meeting-copy"
          disabled={!open.length}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(agendaText([...carried, ...upcoming], nextSunday, clientName, person));
              showToast('סדר היום הועתק ללוח', { kind: 'success' });
            } catch {
              showToast('לא ניתן להעתיק בדפדפן זה', { kind: 'error' });
            }
          }}
        >
          📋 העתק סדר יום
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm meeting-copy"
          disabled={!data.topics.length}
          onClick={() => setMinimized(allMinimized ? new Set() : new Set(data.topics.map((t) => t.id)))}
        >
          {allMinimized ? '⊞ הרחב את כל הנושאים' : '⊟ מזער את כל הנושאים'}
        </button>
      </div>

      <section className="card meeting-summary">
        <div className="section-head">
          <h3>📝 סיכום הישיבה השבועית</h3>
          <span className="status-updated">נשמר אוטומטית</span>
        </div>
        <AutoTextarea
          className="input meeting-summary-input"
          value={summaryText}
          placeholder="הקלד כאן את הסיכום תוך כדי הישיבה…"
          aria-label="סיכום הישיבה השבועית"
          onChange={(v) => setMeetingSummary(nextSunday, v)}
        />
        <div className="meeting-summary-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!summaryText.trim() || !data.settings.webhookUrl}
            onClick={sendSummary}
          >
            ✉️ שלח את הסיכום למייל
          </button>
          {!data.settings.webhookUrl && (
            <span className="status-updated">כדי לשלוח: הגדר כתובת webhook בהגדרות (סנכרון ענן ואוטומציות)</span>
          )}
        </div>
      </section>

      <AddTaskInline
        placeholder="+ נושא חדש לישיבה (לקוח ואיש צוות מזוהים אוטומטית)"
        onAdd={(text) => quickAdd(`${MEETING_PREFIX} ${text}`)}
      />

      {carried.length > 0 && (
        <section className="topic-group">
          <h3 className="group-title warn">נושאים שלא נדונו מישיבות קודמות ({carried.length})</h3>
          <div className="task-list">
            {carried.map((t) => (
              <TopicItem
                key={t.id}
                topic={t}
                nextSunday={nextSunday}
                minimized={minimized.has(t.id)}
                onMinimizedChange={(on) => setTopicMinimized(t.id, on)}
              />
            ))}
          </div>
        </section>
      )}

      <section className="topic-group">
        <h3 className="group-title">לישיבה הקרובה ({upcoming.length})</h3>
        <div className="task-list">
          {upcoming.map((t) => (
            <TopicItem
              key={t.id}
              topic={t}
              nextSunday={nextSunday}
              minimized={minimized.has(t.id)}
              onMinimizedChange={(on) => setTopicMinimized(t.id, on)}
            />
          ))}
          {!upcoming.length && (
            <p className="empty-state">
              אין עדיין נושאים. כתוב בתיבת ההזנה המהירה <b>"{MEETING_PREFIX} …"</b> כדי להוסיף.
            </p>
          )}
        </div>
      </section>

      <section className="topic-group">
        <label className="switch">
          <input type="checkbox" checked={showDiscussed} onChange={(e) => setShowDiscussed(e.target.checked)} />
          <span>הצג נושאים שנדונו ({discussed.length})</span>
        </label>
        {showDiscussed && (
          <div className="task-list">
            {discussed.map((t, i) => (
              <div key={t.id}>
                {(i === 0 || discussed[i - 1].meetingDate !== t.meetingDate) && (
                  <div className="date-divider">ישיבת {formatShortDate(t.meetingDate)}</div>
                )}
                <TopicItem
                  topic={t}
                  nextSunday={nextSunday}
                  minimized={minimized.has(t.id)}
                  onMinimizedChange={(on) => setTopicMinimized(t.id, on)}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
