import { useState } from 'react';
import type { Client, ClientCategory, Project, Task } from '../lib/types';
import { CATEGORIES, CATEGORY_BADGE, CATEGORY_LABELS } from '../lib/constants';
import { addClient, addProject, addTask, deleteProject, updateClient, updateProject, useData } from '../lib/store';
import { askConfirm, askText } from '../lib/dialog';
import { AddTaskInline, TaskItem } from '../components/TaskItem';
import { AutoTextarea } from '../components/fields';

type Filter = 'all' | ClientCategory | 'open';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'כל הלקוחות' },
  { key: 'big', label: CATEGORY_LABELS.big },
  { key: 'small', label: CATEGORY_LABELS.small },
  { key: 'lead', label: CATEGORY_LABELS.lead },
  { key: 'open', label: 'עם משימות פתוחות' },
];

function formatUpdated(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `עודכן ${d.getDate()}.${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function ProjectBlock({ project, tasks, showDone }: { project: Project; tasks: Task[]; showDone: boolean }) {
  const doneCount = tasks.filter((t) => t.done).length;
  const pct = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;
  const visible = showDone ? tasks : tasks.filter((t) => !t.done);

  return (
    <div className={`project-block ${project.closed ? 'is-closed' : ''}`}>
      <div className="project-head">
        <span className="project-icon">📁</span>
        <input
          className="project-name"
          value={project.name}
          aria-label="שם הפרויקט"
          onChange={(e) => updateProject(project.id, { name: e.target.value })}
        />
        <div className="project-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => updateProject(project.id, { closed: !project.closed })}
          >
            {project.closed ? 'פתח מחדש' : 'סגור פרויקט'}
          </button>
          <button
            type="button"
            className="icon-btn danger"
            title="מחק פרויקט"
            onClick={async () => {
              if (await askConfirm(`למחוק את "${project.name}"?`, `יימחקו גם ${tasks.length} תתי-המשימות שלו.`)) {
                deleteProject(project.id);
              }
            }}
          >
            🗑
          </button>
        </div>
      </div>
      <div className="progress-row">
        <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="progress-label">
          {doneCount}/{tasks.length} תתי-משימות הושלמו
        </span>
      </div>
      <div className="task-list">
        {visible.map((t) => (
          <TaskItem key={t.id} task={t} context="project" />
        ))}
        {!visible.length && <p className="empty-note">{tasks.length ? 'כל תתי-המשימות הושלמו 🎉' : 'אין עדיין תתי-משימות'}</p>}
      </div>
      {!project.closed && (
        <AddTaskInline
          placeholder="+ תת-משימה לפרויקט"
          onAdd={(text) => addTask({ clientId: project.clientId, projectId: project.id, description: text })}
        />
      )}
    </div>
  );
}

/** Tasks that belong to no client (משימות כלליות) or to a lead (לידים), shown above the clients. */
function TaskGroupCard({
  tasks,
  showDone,
  addPlaceholder,
  onAdd,
}: {
  tasks: Task[];
  showDone: boolean;
  addPlaceholder: string;
  onAdd?: (text: string) => void;
}) {
  const visible = showDone ? tasks : tasks.filter((t) => !t.done);
  return (
    <article className="card task-group-card">
      <div className="task-list">
        {visible.map((t) => (
          <TaskItem key={t.id} task={t} context="master" />
        ))}
        {!visible.length && <p className="empty-note">אין משימות פתוחות</p>}
      </div>
      {onAdd && <AddTaskInline placeholder={addPlaceholder} onAdd={onAdd} />}
    </article>
  );
}

function ClientCard({
  client,
  showDone,
  minimized,
  onMinimizedChange,
}: {
  client: Client;
  showDone: boolean;
  minimized: boolean;
  onMinimizedChange: (minimized: boolean) => void;
}) {
  const data = useData();
  const [collapsed, setCollapsed] = useState(false);
  const tasks = data.tasks.filter((t) => t.clientId === client.id);
  const projects = data.projects.filter((p) => p.clientId === client.id && (showDone || !p.closed));
  const routine = tasks.filter((t) => !t.projectId);
  const visibleRoutine = showDone ? routine : routine.filter((t) => !t.done);
  const openTasks = tasks.filter((t) => !t.done).length;
  const openProjects = projects.filter((p) => !p.closed).length;

  if (minimized) {
    return (
      <article className="card client-card client-card-min" id={`client-${client.id}`}>
        <header className="client-head">
          <button
            type="button"
            className="collapse-btn"
            aria-expanded={false}
            aria-label="הרחב את הלקוח"
            onClick={() => onMinimizedChange(false)}
          >
            ◂
          </button>
          <h2 className="client-name">{client.name}</h2>
        </header>
      </article>
    );
  }

  return (
    <article className={`card client-card cat-${client.category}`} id={`client-${client.id}`}>
      <header className="client-head">
        <button
          type="button"
          className="collapse-btn"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'הרחב' : 'כווץ'}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? '◂' : '▾'}
        </button>
        <h2 className="client-name">{client.name}</h2>
        <span className={`badge badge-${client.category}`}>{CATEGORY_BADGE[client.category]}</span>
        <div className="client-counts">
          <span className={`count ${openTasks ? '' : 'count-zero'}`}>{openTasks} משימות פתוחות</span>
          <span className={`count ${openProjects ? '' : 'count-zero'}`}>{openProjects} פרויקטים</span>
        </div>
        <button
          type="button"
          className="icon-btn"
          title="מזער לשם הלקוח בלבד"
          aria-label="מזער לשם הלקוח בלבד"
          onClick={() => onMinimizedChange(true)}
        >
          ⊟
        </button>
      </header>

      <div className="status-box">
        <div className="status-label">
          <span>סטטוס כללי</span>
          <span className="status-updated">{formatUpdated(client.statusUpdatedAt)}</span>
        </div>
        <AutoTextarea
          className="status-input"
          value={client.status}
          placeholder="מה קורה כרגע עם הלקוח? (נשמר אוטומטית)"
          aria-label={`סטטוס כללי – ${client.name}`}
          onChange={(v) => updateClient(client.id, { status: v })}
        />
      </div>

      {!collapsed && (
        <>
          <section className="client-section">
            <div className="section-head">
              <h3>פרויקטים פתוחים</h3>
              <button
                type="button"
                className="btn btn-soft btn-sm"
                onClick={async () => {
                  const name = await askText(`פרויקט חדש ל${client.name}`, 'פרויקט ');
                  if (name) addProject(client.id, name);
                }}
              >
                + פתח פרויקט חדש ללקוח
              </button>
            </div>
            {projects.map((p) => (
              <ProjectBlock key={p.id} project={p} tasks={tasks.filter((t) => t.projectId === p.id)} showDone={showDone} />
            ))}
            {!projects.length && <p className="empty-note">אין פרויקטים פתוחים</p>}
          </section>

          <section className="client-section">
            <div className="section-head">
              <h3>משימות שוטפות</h3>
            </div>
            <div className="task-list">
              {visibleRoutine.map((t) => (
                <TaskItem key={t.id} task={t} context="client" />
              ))}
              {!visibleRoutine.length && <p className="empty-note">אין משימות שוטפות פתוחות</p>}
            </div>
            <AddTaskInline
              placeholder="+ משימה שוטפת חדשה"
              onAdd={(text) => addTask({ clientId: client.id, description: text })}
            />
          </section>
        </>
      )}
    </article>
  );
}

export function ClientsView() {
  const data = useData();
  const [filter, setFilter] = useState<Filter>('all');
  const [showDone, setShowDone] = useState(false);
  const [minimized, setMinimized] = useState<Set<string>>(() => new Set());

  const hasOpen = (c: Client) => data.tasks.some((t) => t.clientId === c.id && !t.done);
  const visible = data.clients.filter((c) =>
    filter === 'all' ? true : filter === 'open' ? hasOpen(c) : c.category === filter,
  );
  const allMinimized = visible.length > 0 && visible.every((c) => minimized.has(c.id));

  const setCardMinimized = (id: string, on: boolean) =>
    setMinimized((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const categoryOf = (taskClientId: string | null) => data.clients.find((c) => c.id === taskClientId)?.category;
  const generalTasks = data.tasks.filter((t) => !t.clientId);
  const leadTasks = data.tasks.filter((t) => !t.projectId && categoryOf(t.clientId) === 'lead');

  const jumpTo = (id: string) => {
    if (!id) return;
    if (!visible.some((c) => c.id === id)) setFilter('all');
    requestAnimationFrame(() =>
      document.getElementById(`client-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  };

  return (
    <div className="view">
      <div className="toolbar card">
        <div className="pills" role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              className={`pill ${filter === f.key ? 'pill-on' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="toolbar-row">
          <select className="select" value="" onChange={(e) => jumpTo(e.target.value)} aria-label="קפיצה ללקוח">
            <option value="">🔎 קפיצה ללקוח…</option>
            {data.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <label className="switch">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            <span>הצג משימות שבוצעו</span>
          </label>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!visible.length}
            onClick={() => setMinimized(allMinimized ? new Set() : new Set(visible.map((c) => c.id)))}
          >
            {allMinimized ? '⊞ הרחב את כל הלקוחות' : '⊟ מזער את כל הלקוחות'}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              const name = await askText('שם הלקוח / הליד החדש');
              if (!name) return;
              const category = filter === 'big' || filter === 'small' ? filter : 'lead';
              const c = addClient(name, category);
              jumpTo(c.id);
            }}
          >
            + לקוח / ליד
          </button>
        </div>
      </div>

      {filter === 'all' && (
        <>
          <section className="category-group">
            <h2 className="category-title">
              משימות כלליות <span className="category-count">{generalTasks.filter((t) => !t.done).length}</span>
            </h2>
            <TaskGroupCard
              tasks={generalTasks}
              showDone={showDone}
              addPlaceholder="+ משימה כללית (ללא לקוח)"
              onAdd={(text) => addTask({ description: text })}
            />
          </section>
          <section className="category-group">
            <h2 className="category-title cat-title-lead">
              משימות לידים <span className="category-count">{leadTasks.filter((t) => !t.done).length}</span>
            </h2>
            <TaskGroupCard tasks={leadTasks} showDone={showDone} addPlaceholder="" />
          </section>
        </>
      )}

      {CATEGORIES.map((cat) => {
        const list = visible.filter((c) => c.category === cat);
        if (!list.length) return null;
        return (
          <section key={cat} className="category-group">
            <h2 className={`category-title cat-title-${cat}`}>
              {CATEGORY_LABELS[cat]} <span className="category-count">{list.length}</span>
            </h2>
            {list.map((c) => (
              <ClientCard
                key={c.id}
                client={c}
                showDone={showDone}
                minimized={minimized.has(c.id)}
                onMinimizedChange={(on) => setCardMinimized(c.id, on)}
              />
            ))}
          </section>
        );
      })}
      {!visible.length && <p className="empty-state">אין לקוחות שתואמים לסינון</p>}
    </div>
  );
}
