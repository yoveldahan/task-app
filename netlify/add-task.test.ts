import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeedData } from '../src/lib/seed';
import { toRow } from '../src/lib/syncCore';

const UID = 'user-1';
const seed = createSeedData();
const tables: Record<string, Record<string, unknown>[]> = {};
const inserted: { table: string; row: Record<string, unknown> }[] = [];

function resetTables() {
  const now = new Date().toISOString();
  tables.clients = seed.clients.map((c) => toRow(c, UID, now));
  tables.projects = seed.projects.map((p) => toRow(p, UID, now));
  tables.people = seed.people.map((p, i) => toRow(p, UID, now, i));
  tables.app_settings = [{ user_id: UID, me_id: 'me', webhook_url: '', webhook_sync_data: false, webhook_send_reminders: false }];
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const filters: ((r: Record<string, unknown>) => boolean)[] = [];
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
        maybeSingle: async () => ({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }),
        insert: async (row: Record<string, unknown>) => (inserted.push({ table, row }), { error: null }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null }),
      };
      return q;
    },
  }),
}));

const { default: handler, israelNow } = await import('./functions/add-task.mts');

function post(body: unknown, opts: { token?: string | null; type?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': opts.type ?? 'application/json' };
  if (opts.token !== null) headers.Authorization = `Bearer ${opts.token ?? 'secret-token'}`;
  return new Request('https://x/api/tasks', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.WEBHOOK_TOKEN = 'secret-token';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_x';
  process.env.SUPABASE_USER_ID = UID;
  inserted.length = 0;
  resetTables();
});

describe('POST /api/tasks', () => {
  it('rejects other methods, missing config and bad tokens', async () => {
    expect((await handler(new Request('https://x/api/tasks'))).status).toBe(405);
    expect((await handler(post({ text: 'x' }, { token: null }))).status).toBe(401);
    expect((await handler(post({ text: 'x' }, { token: 'wrong' }))).status).toBe(401);
    delete process.env.SUPABASE_SECRET_KEY;
    const r = await handler(post({ text: 'x' }));
    expect(r.status).toBe(503);
    expect((await r.json()).missing).toEqual(['SUPABASE_SECRET_KEY']);
    expect(inserted).toHaveLength(0);
  });

  it('creates a task in the user rows from parsed text', async () => {
    const r = await handler(post({ text: 'להתקשר לפז לגבי משלוח, תקוע אצל אילנה', due: '2026-11-05' }));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.kind).toBe('task');
    expect(inserted).toHaveLength(1);
    expect(inserted[0].table).toBe('tasks');
    expect(inserted[0].row).toMatchObject({
      user_id: UID,
      description: 'להתקשר לפז לגבי משלוח',
      client_id: seed.clients[1].id,
      stuck_with_id: 'ilana',
      due_date: '2026-11-05',
      deleted_at: null,
    });
  });

  it('routes "נושא לישיבה:" and topic field to meeting_topics', async () => {
    await handler(post({ text: 'נושא לישיבה: זמני אספקה מול מתן' }));
    await handler(post({ topic: 'מחירון חדש' }));
    expect(inserted.map((i) => i.table)).toEqual(['meeting_topics', 'meeting_topics']);
    expect(inserted[0].row.with_whom_id).toBe('matan');
  });

  it('accepts plain text and form bodies; token in body', async () => {
    expect((await handler(post('בדיקת מלאי לרד מרקט', { type: 'text/plain' }))).status).toBe(201);
    expect((await handler(post('text=הצעת+מחיר&client=בראשית', { type: 'application/x-www-form-urlencoded' }))).status).toBe(201);
    expect((await handler(post({ text: 'x', token: 'secret-token' }, { token: null }))).status).toBe(201);
    expect(inserted[1].row.client_id).toBe(seed.clients.find((c) => c.name === 'בראשית')!.id);
  });

  it('creates a new project row when asked', async () => {
    await handler(post({ text: 'מיפוי מדפים', client: 'נוי השדה', project: 'הרחבת תגים' }));
    expect(inserted.map((i) => i.table)).toEqual(['projects', 'tasks']);
    expect(inserted[1].row.project_id).toBe(inserted[0].row.id);
  });

  it('dryRun saves nothing; empty text is 400; unsynced account is 409', async () => {
    const r = await handler(post({ text: 'x', dryRun: true }));
    expect((await r.json()).dryRun).toBe(true);
    expect(inserted).toHaveLength(0);
    expect((await handler(post({ text: '  ' }))).status).toBe(400);
    tables.people = [];
    tables.clients = [];
    expect((await handler(post({ text: 'x' }))).status).toBe(409);
  });

  it('israelNow converts to Israel wall-clock time', () => {
    const d = israelNow(new Date('2026-10-28T22:30:00Z')); // UTC+2 in late October
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([29, 0, 30]);
  });
});
