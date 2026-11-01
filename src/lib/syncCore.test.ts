import { describe, expect, it } from 'vitest';
import { createSeedData } from './seed';
import { applyRowToDraft, diffState, fromRow, reconcile, snapshotIsEmpty, toRow, type Snapshot } from './syncCore';
import type { AppData, Task } from './types';

const UID = '00000000-0000-0000-0000-000000000001';
const NOW = '2026-10-29T08:00:00.000Z';

function snapshotOf(data: AppData): Snapshot {
  return {
    clients: data.clients.map((e) => toRow(e, UID, NOW)),
    projects: data.projects.map((e) => toRow(e, UID, NOW)),
    tasks: data.tasks.map((e) => toRow(e, UID, NOW)),
    meeting_topics: data.topics.map((e) => toRow(e, UID, NOW)),
    meeting_summaries: data.summaries.map((e) => toRow(e, UID, NOW)),
    people: data.people.map((e, i) => toRow(e, UID, NOW, i)),
    settings: { user_id: UID, me_id: 'me', webhook_url: '', webhook_sync_data: false, webhook_send_reminders: false },
  };
}

describe('row mapping', () => {
  it('round-trips a task through snake_case columns', () => {
    const task = createSeedData().tasks[0];
    const row = toRow(task, UID, NOW);
    expect(row).toMatchObject({ user_id: UID, stuck_with_id: task.stuckWithId, reminder_fired_for: null, deleted_at: null });
    expect(fromRow<Task>(row)).toEqual(task);
  });

  it('round-trips a meeting summary through its table columns', () => {
    const s = { id: 'sum-1', meetingDate: '2026-11-01', summary: 'סיכום', createdAt: NOW };
    const row = toRow(s, UID, NOW);
    expect(row).toMatchObject({ meeting_date: '2026-11-01', summary: 'סיכום' });
    expect(fromRow<typeof s>(row)).toEqual(s);
  });

  it('normalises Postgres timestamp format so createdAt sorts as a string', () => {
    const t = fromRow<Task>({ id: 'x', created_at: '2026-10-28T21:15:00.123+00:00', due_date: '2026-11-01' });
    expect(t.createdAt).toBe('2026-10-28T21:15:00.123Z');
    expect(t.dueDate).toBe('2026-11-01');
  });
});

describe('diffState', () => {
  it('detects added, changed and removed rows and settings', () => {
    const a = createSeedData();
    const b = structuredClone(a);
    b.tasks[0].done = true;
    const removed = b.clients.pop()!;
    b.topics.push({ ...b.topics[0], id: 'new-topic' } as never);
    b.settings.webhookUrl = 'https://x';
    expect(diffState(a, b).sort()).toEqual(
      [`tasks:${a.tasks[0].id}`, `clients:${removed.id}`, 'meeting_topics:new-topic', 'settings'].sort(),
    );
  });

  it('a reorder of people marks the moved rows', () => {
    const a = createSeedData();
    const b = structuredClone(a);
    [b.people[1], b.people[2]] = [b.people[2], b.people[1]];
    expect(diffState(a, b).sort()).toEqual(['people:ilana', 'people:matan']);
  });

  it('no changes → empty', () => {
    const a = createSeedData();
    expect(diffState(a, structuredClone(a))).toEqual([]);
  });
});

describe('reconcile', () => {
  it('takes the cloud version for rows without pending edits, preserving order', () => {
    const local = createSeedData();
    const remote = structuredClone(local);
    remote.clients[0].status = 'עודכן בנייד';
    remote.tasks.splice(1, 1); // deleted on the other device
    const next = reconcile(local, snapshotOf(remote), new Set());
    expect(next.clients[0].status).toBe('עודכן בנייד');
    expect(next.tasks.map((t) => t.id)).toEqual(remote.tasks.map((t) => t.id));
    expect(next.clients.map((c) => c.id)).toEqual(local.clients.map((c) => c.id));
    expect(next.people.map((p) => p.id)).toEqual(local.people.map((p) => p.id));
  });

  it('keeps pending local edits, unpushed new rows and unpushed deletes', () => {
    const base = createSeedData();
    const local = structuredClone(base);
    local.clients[0].status = 'עריכה מקומית';
    const newTask = { ...local.tasks[0], id: 'local-new', createdAt: '2099-01-01T00:00:00.000Z' };
    local.tasks.push(newTask);
    const deleted = local.tasks.splice(0, 1)[0];

    const remote = structuredClone(base);
    remote.clients[0].status = 'עריכה בענן';

    const pending = new Set([`clients:${base.clients[0].id}`, 'tasks:local-new', `tasks:${deleted.id}`] as const);
    const next = reconcile(local, snapshotOf(remote), new Set(pending));
    expect(next.clients[0].status).toBe('עריכה מקומית');
    expect(next.tasks.some((t) => t.id === 'local-new')).toBe(true);
    expect(next.tasks.some((t) => t.id === deleted.id)).toBe(false);
  });

  it('empty snapshot detection', () => {
    expect(
      snapshotIsEmpty({ clients: [], projects: [], tasks: [], meeting_topics: [], meeting_summaries: [], people: [], settings: null }),
    ).toBe(true);
    expect(snapshotIsEmpty(snapshotOf(createSeedData()))).toBe(false);
  });
});

describe('applyRowToDraft (realtime)', () => {
  it('updates, inserts and soft-deletes rows', () => {
    const d = createSeedData();
    const t = d.tasks[0];
    applyRowToDraft(d, 'tasks', { ...toRow(t, UID, NOW), description: 'שונה' });
    expect(d.tasks.find((x) => x.id === t.id)!.description).toBe('שונה');

    applyRowToDraft(d, 'tasks', { ...toRow({ ...t, id: 'rt-new', createdAt: '2099-01-01T00:00:00.000Z' }, UID, NOW) });
    expect(d.tasks.at(-1)!.id).toBe('rt-new');

    applyRowToDraft(d, 'tasks', { ...toRow(t, UID, NOW), deleted_at: NOW });
    expect(d.tasks.some((x) => x.id === t.id)).toBe(false);
  });

  it('places a person by sort_order', () => {
    const d = createSeedData();
    applyRowToDraft(d, 'people', toRow({ id: 'new', name: 'דני' }, UID, NOW, 1));
    expect(d.people[1].id).toBe('new');
  });
});

describe('meeting summaries sync', () => {
  const summary = { id: 'sum-1', meetingDate: '2026-11-01', summary: 'הוחלט לקדם את הלקוח', createdAt: NOW };

  it('diffState reports an added or edited summary as a change', () => {
    const base = createSeedData();
    const next = { ...base, summaries: [summary] };
    expect(diffState(base, next)).toContain('meeting_summaries:sum-1');
    const edited = { ...next, summaries: [{ ...summary, summary: 'עודכן' }] };
    expect(diffState(next, edited)).toEqual(['meeting_summaries:sum-1']);
  });

  it('reconcile pulls a cloud summary when there is no pending local change', () => {
    const local = createSeedData();
    const snap = { ...snapshotOf(local), meeting_summaries: [toRow(summary, UID, NOW)] };
    const next = reconcile(local, snap, new Set());
    expect(next.summaries).toEqual([summary]);
  });

  it('reconcile keeps a local summary that has an unpushed edit', () => {
    const local = { ...createSeedData(), summaries: [{ ...summary, summary: 'מקומי' }] };
    const snap = { ...snapshotOf(createSeedData()), meeting_summaries: [toRow(summary, UID, NOW)] };
    const next = reconcile(local, snap, new Set(['meeting_summaries:sum-1']));
    expect(next.summaries[0].summary).toBe('מקומי');
  });
});
