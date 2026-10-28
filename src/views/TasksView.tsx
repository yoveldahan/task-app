import { useState } from 'react';
import type { ClientCategory, Task } from '../lib/types';
import { CATEGORIES, CATEGORY_LABELS } from '../lib/constants';
import { addDays, toISODate, today } from '../lib/dates';
import { addTask, useData } from '../lib/store';
import { isReminderActive } from '../lib/reminders';
import { AddTaskInline, TaskItem } from '../components/TaskItem';

type TimeFilter = 'all' | 'urgent' | 'week' | 'reminder';
type AssignFilter = 'all' | 'routine' | 'project';

const TIME_FILTERS: { key: TimeFilter; label: string }[] = [
  { key: 'all', label: 'הכל' },
  { key: 'urgent', label: 'להיום ובאיחור' },
  { key: 'week', label: 'לשבוע הקרוב' },
  { key: 'reminder', label: 'עם תזכורת פעילה' },
];

export function TasksView() {
  const data = useData();
  const meId = data.settings.meId;
  const [time, setTime] = useState<TimeFilter>('all');
  const [stuck, setStuck] = useState<string>('all'); // 'all' | 'others' | person id
  const [category, setCategory] = useState<'all' | ClientCategory>('all');
  const [clientId, setClientId] = useState<string>('all');
  const [assign, setAssign] = useState<AssignFilter>('all');
  const [showDone, setShowDone] = useState(false);
  const [search, setSearch] = useState('');

  const t0 = today();
  const weekEnd = toISODate(addDays(new Date(), 7));
  const clientOf = (task: Task) => data.clients.find((c) => c.id === task.clientId);

  const filtered = data.tasks.filter((task) => {
    if (!showDone && task.done) return false;
    if (time === 'urgent' && !(task.dueDate && task.dueDate <= t0)) return false;
    if (time === 'week' && !(task.dueDate && task.dueDate <= weekEnd)) return false;
    if (time === 'reminder' && !isReminderActive(task, task.done)) return false;
    if (stuck === 'others' && task.stuckWithId === meId) return false;
    if (stuck !== 'all' && stuck !== 'others' && task.stuckWithId !== stuck) return false;
    if (category !== 'all' && clientOf(task)?.category !== category) return false;
    if (clientId !== 'all' && (task.clientId ?? 'none') !== clientId) return false;
    if (assign === 'routine' && task.projectId) return false;
    if (assign === 'project' && !task.projectId) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = `${task.description} ${task.stuckReason} ${clientOf(task)?.name ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Open before done, then by due date (undated last), then newest first.
  const sorted = [...filtered].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.dueDate !== b.dueDate) {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate < b.dueDate ? -1 : 1;
    }
    return a.createdAt < b.createdAt ? 1 : -1;
  });

  const open = data.tasks.filter((t) => !t.done);
  const stats = {
    urgent: open.filter((t) => t.dueDate && t.dueDate <= t0).length,
    others: open.filter((t) => t.stuckWithId !== meId).length,
    mine: open.filter((t) => t.stuckWithId === meId).length,
  };

  const filtersActive =
    time !== 'all' || stuck !== 'all' || category !== 'all' || clientId !== 'all' || assign !== 'all' || search !== '';

  return (
    <div className="view">
      <div className="stats-row">
        <button type="button" className="stat-tile stat-urgent" onClick={() => setTime('urgent')}>
          <span className="stat-num">{stats.urgent}</span>
          <span className="stat-label">להיום ובאיחור</span>
        </button>
        <button type="button" className="stat-tile" onClick={() => setStuck(meId)}>
          <span className="stat-num">{stats.mine}</span>
          <span className="stat-label">אצלי</span>
        </button>
        <button type="button" className="stat-tile stat-others" onClick={() => setStuck('others')}>
          <span className="stat-num">{stats.others}</span>
          <span className="stat-label">תקוע אצל אחרים</span>
        </button>
      </div>

      <div className="toolbar card">
        <div className="pills">
          {TIME_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`pill ${time === f.key ? 'pill-on' : ''}`}
              onClick={() => setTime(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="filter-grid">
          <select className="select" value={stuck} onChange={(e) => setStuck(e.target.value)} aria-label="אצל מי זה תקוע">
            <option value="all">אצל מי: הכל</option>
            <option value={meId}>אצלי (יובל)</option>
            <option value="others">תקוע אצל אחרים (בבקרה שלי)</option>
            {data.people
              .filter((p) => p.id !== meId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <select
            className="select"
            value={category}
            onChange={(e) => setCategory(e.target.value as 'all' | ClientCategory)}
            aria-label="סוג לקוח"
          >
            <option value="all">סוג לקוח: הכל</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <select className="select" value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="לקוח">
            <option value="all">לקוח: הכל</option>
            <option value="none">ללא לקוח</option>
            {data.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select className="select" value={assign} onChange={(e) => setAssign(e.target.value as AssignFilter)} aria-label="שיוך">
            <option value="all">שיוך: הכל</option>
            <option value="routine">משימות שוטפות</option>
            <option value="project">פרויקטים</option>
          </select>
          <input
            className="input"
            type="search"
            placeholder="🔎 חיפוש חופשי"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="toolbar-row">
          <label className="switch">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            <span>הצג משימות שבוצעו</span>
          </label>
          <span className="result-count">{sorted.length} משימות</span>
          {filtersActive && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setTime('all');
                setStuck('all');
                setCategory('all');
                setClientId('all');
                setAssign('all');
                setSearch('');
              }}
            >
              נקה סינון
            </button>
          )}
        </div>
      </div>

      <AddTaskInline
        placeholder="+ משימה חדשה (בחר לקוח ושיוך בשורה שתיווצר)"
        onAdd={(text) => addTask({ description: text, clientId: clientId !== 'all' && clientId !== 'none' ? clientId : null })}
      />

      <div className="task-list master-list">
        {sorted.map((t) => (
          <TaskItem key={t.id} task={t} context="master" />
        ))}
        {!sorted.length && <p className="empty-state">אין משימות שתואמות לסינון 👌</p>}
      </div>
    </div>
  );
}
