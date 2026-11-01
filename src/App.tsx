import { useEffect, useState } from 'react';
import { QuickCapture } from './components/QuickCapture';
import { DialogHost, Toasts } from './components/Shell';
import { SyncBadge } from './components/SyncCard';
import { ClientsView } from './views/ClientsView';
import { TasksView } from './views/TasksView';
import { MeetingView } from './views/MeetingView';
import { SettingsView } from './views/SettingsView';
import { useData } from './lib/store';
import { startReminderLoop } from './lib/reminders';
import { today, upcomingSunday } from './lib/dates';

type ViewKey = 'clients' | 'tasks' | 'meeting' | 'settings';

const VIEWS: { key: ViewKey; label: string; icon: string }[] = [
  { key: 'clients', label: 'לקוחות ומשימות', icon: '🏢' },
  { key: 'tasks', label: 'כל המשימות', icon: '✅' },
  { key: 'meeting', label: 'נושאים לישיבה', icon: '🗓' },
  { key: 'settings', label: 'הגדרות', icon: '⚙️' },
];

function viewFromHash(): ViewKey {
  const h = window.location.hash.replace('#', '');
  return (VIEWS.some((v) => v.key === h) ? h : 'clients') as ViewKey;
}

export function App() {
  const data = useData();
  const [view, setView] = useState<ViewKey>(viewFromHash);

  useEffect(() => {
    const onHash = () => {
      setView(viewFromHash());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => startReminderLoop(), []);

  // Opened from the Android app (widget or reminder): ?openTask=<id> shows that task in the tasks view.
  // Not "task=": that parameter already adds a task from a link (see lib/urlIntake.ts).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const taskId = params.get('openTask');
    if (!taskId) return;
    params.delete('openTask');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}#tasks`);
    setView('tasks');
    let attempts = 0;
    const reveal = () => {
      const el = document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(taskId)}"]`);
      if (!el) {
        // The list renders after this effect; retry briefly, then give up quietly (e.g. the task is done or filtered out).
        if (++attempts < 30) window.setTimeout(reveal, 100);
        return;
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('task-highlight');
      window.setTimeout(() => el.classList.remove('task-highlight'), 2500);
    };
    window.setTimeout(reveal, 50);
  }, []);

  const t0 = today();
  const badges: Record<ViewKey, number> = {
    clients: 0,
    tasks: data.tasks.filter((t) => !t.done && t.dueDate && t.dueDate <= t0).length,
    meeting: data.topics.filter((t) => !t.discussed && t.meetingDate <= upcomingSunday()).length,
    settings: 0,
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <div className="brand">
            <span className="brand-logo">RAS</span>
            <div className="brand-text">
              <span className="brand-title">ניהול משימות ולקוחות</span>
              <span className="brand-sub">ראס – פתרונות קמעונאות</span>
            </div>
            <SyncBadge />
          </div>
          <nav className="top-nav" aria-label="ניווט ראשי">
            {VIEWS.map((v) => (
              <a key={v.key} href={`#${v.key}`} className={`nav-link ${view === v.key ? 'is-active' : ''}`}>
                <span>{v.icon}</span> {v.label}
                {badges[v.key] > 0 && <span className="nav-badge">{badges[v.key]}</span>}
              </a>
            ))}
          </nav>
        </div>
        <div className="header-inner">
          <QuickCapture />
        </div>
      </header>

      <main className="main">
        {view === 'clients' && <ClientsView />}
        {view === 'tasks' && <TasksView />}
        {view === 'meeting' && <MeetingView />}
        {view === 'settings' && <SettingsView />}
      </main>

      <nav className="bottom-nav" aria-label="ניווט ראשי">
        {VIEWS.map((v) => (
          <a key={v.key} href={`#${v.key}`} className={`bnav-link ${view === v.key ? 'is-active' : ''}`}>
            <span className="bnav-icon">
              {v.icon}
              {badges[v.key] > 0 && <span className="nav-badge">{badges[v.key]}</span>}
            </span>
            <span className="bnav-label">{v.label}</span>
          </a>
        ))}
      </nav>

      <Toasts />
      <DialogHost />
    </div>
  );
}
