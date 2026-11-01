import type { Task } from '../lib/types';
import { CATEGORY_BADGE } from '../lib/constants';
import { addProject, deleteTask, update, updateTask, useData } from '../lib/store';
import { askText } from '../lib/dialog';
import { showToast } from '../lib/toast';
import { AutoTextarea, DueDateField, Field, PersonSelect, ReminderField } from './fields';

const NEW_PROJECT = '__new__';

export function removeTaskWithUndo(task: Task) {
  deleteTask(task.id);
  showToast('המשימה נמחקה', {
    action: { label: 'בטל', onClick: () => update((d) => void d.tasks.push(task)) },
    duration: 6000,
  });
}

/** Assignment dropdown: routine task / one of the client's projects / create a new project. */
export function AssignmentSelect({ task }: { task: Task }) {
  const data = useData();
  const projects = data.projects.filter((p) => p.clientId === task.clientId && (!p.closed || p.id === task.projectId));
  return (
    <select
      className="select"
      value={task.projectId ?? ''}
      disabled={!task.clientId}
      aria-label="שיוך"
      onChange={async (e) => {
        const v = e.target.value;
        if (v === NEW_PROJECT) {
          const name = await askText('שם הפרויקט החדש', '', 'הפרויקט ייפתח תחת הלקוח והמשימה תשויך אליו');
          if (name && task.clientId) updateTask(task.id, { projectId: addProject(task.clientId, name).id });
          return;
        }
        updateTask(task.id, { projectId: v || null });
      }}
    >
      <option value="">משימה שוטפת</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          📁 {p.name}
        </option>
      ))}
      {task.clientId && <option value={NEW_PROJECT}>+ פרויקט חדש…</option>}
    </select>
  );
}

export function TaskItem({ task, context }: { task: Task; context: 'client' | 'project' | 'master' }) {
  const data = useData();
  const client = data.clients.find((c) => c.id === task.clientId);
  const set = (patch: Partial<Task>) => updateTask(task.id, patch);

  return (
    <div
      className={`task-item ${task.done ? 'is-done' : ''} ${task.stuckWithId !== data.settings.meId ? 'is-delegated' : ''}`}
      data-task-id={task.id}
    >
      {context === 'master' && (
        <div className="task-meta-row">
          <select
            className="select client-select"
            value={task.clientId ?? ''}
            aria-label="שם הלקוח"
            onChange={(e) => set({ clientId: e.target.value || null })}
          >
            <option value="">ללא לקוח</option>
            {data.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {client && <span className={`badge badge-${client.category}`}>{CATEGORY_BADGE[client.category]}</span>}
          <AssignmentSelect task={task} />
        </div>
      )}

      <div className="task-main-row">
        <label className="check" title="בוצע">
          <input type="checkbox" checked={task.done} onChange={(e) => set({ done: e.target.checked })} />
          <span className="check-box" aria-hidden />
        </label>
        <AutoTextarea
          className="task-desc"
          value={task.description}
          placeholder={context === 'project' ? 'תיאור תת-המשימה' : 'תיאור המשימה'}
          aria-label="תיאור המשימה"
          onChange={(v) => set({ description: v })}
        />
        <button type="button" className="icon-btn danger" title="מחק משימה" onClick={() => removeTaskWithUndo(task)}>
          🗑
        </button>
      </div>

      <div className={`task-fields ${context === 'client' ? 'has-assign' : ''}`}>
        <Field label="מועד לביצוע">
          <DueDateField value={task.dueDate} done={task.done} onChange={(v) => set({ dueDate: v })} />
        </Field>
        <Field label="אצל מי זה תקוע">
          <PersonSelect value={task.stuckWithId} onChange={(id) => set({ stuckWithId: id })} />
        </Field>
        <Field label="תזכורת" className="field-reminder">
          <ReminderField
            item={task}
            closed={task.done}
            text={task.description}
            clientId={task.clientId}
            onChange={(patch) => set(patch)}
          />
        </Field>
        <Field label="למה זה תקוע" className="field-wide">
          <AutoTextarea
            className="input"
            value={task.stuckReason}
            placeholder="למשל: ממתין לבדיקת מק״ט במחסן"
            onChange={(v) => set({ stuckReason: v })}
          />
        </Field>
        {context === 'client' && (
          <Field label="שיוך" className="field-assign">
            <AssignmentSelect task={task} />
          </Field>
        )}
      </div>
    </div>
  );
}

/** One-line "add" input: type and press Enter. */
export function AddTaskInline({
  placeholder,
  onAdd,
}: {
  placeholder: string;
  onAdd: (text: string) => void;
}) {
  return (
    <form
      className="add-inline"
      onSubmit={(e) => {
        e.preventDefault();
        const input = e.currentTarget.elements.namedItem('text') as HTMLInputElement;
        const text = input.value.trim();
        if (!text) return;
        onAdd(text);
        input.value = '';
      }}
    >
      <input name="text" className="input" placeholder={placeholder} enterKeyHint="done" autoComplete="off" />
      <button type="submit" className="btn btn-soft">
        הוסף
      </button>
    </form>
  );
}
