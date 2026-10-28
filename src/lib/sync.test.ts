/**
 * Sync engine against an in-memory fake of the supabase-js calls it uses.
 * One "device" runs the real modules; the other device is simulated by writing
 * to the fake database directly (which emits realtime events like Supabase does).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

// ---------- browser globals for node ----------
class MemoryStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
const events = new EventTarget();
Object.assign(globalThis, {
  window: globalThis,
  addEventListener: events.addEventListener.bind(events),
  removeEventListener: events.removeEventListener.bind(events),
  document: { addEventListener() {}, visibilityState: 'visible' },
});
Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, get: () => online });
let online = true;

// ---------- fake supabase ----------
const db = {
  tables: new Map<string, Map<string, Row>>(),
  handlers: [] as { table: string; cb: (p: { eventType: string; new: Row; old: Row }) => void }[],
  failWrites: false,
  table(name: string) {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name)!;
  },
  write(table: string, row: Row) {
    const t = this.table(table);
    const key = table === 'app_settings' ? String(row.user_id) : `${row.user_id}|${row.id}`;
    const existed = t.has(key);
    const merged = { ...(t.get(key) ?? {}), ...row };
    t.set(key, merged);
    for (const h of this.handlers) if (h.table === table) h.cb({ eventType: existed ? 'UPDATE' : 'INSERT', new: { ...merged }, old: {} });
  },
};

class Query {
  op: 'select' | 'upsert' | 'update' = 'select';
  filters: ((r: Row) => boolean)[] = [];
  payload: Row[] = [];
  patch: Row = {};
  rangeArgs: [number, number] | null = null;
  single = false;
  constructor(private table: string) {}
  select() {
    return this;
  }
  upsert(rows: Row | Row[]) {
    this.op = 'upsert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  update(patch: Row) {
    this.op = 'update';
    this.patch = patch;
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push((r) => r[c] === v);
    return this;
  }
  is(c: string, v: unknown) {
    this.filters.push((r) => (r[c] ?? null) === v);
    return this;
  }
  in(c: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[c]));
    return this;
  }
  order() {
    return this;
  }
  range(a: number, b: number) {
    this.rangeArgs = [a, b];
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
    return Promise.resolve()
      .then(() => this.exec())
      .then(resolve, reject);
  }
  exec() {
    if (this.op !== 'select' && db.failWrites) return { data: null, error: { message: 'network down' } };
    if (this.op === 'upsert') {
      for (const r of this.payload) db.write(this.table, structuredClone(r));
      return { data: null, error: null };
    }
    const rows = [...db.table(this.table).values()].filter((r) => this.filters.every((f) => f(r)));
    if (this.op === 'update') {
      for (const r of rows) db.write(this.table, { ...r, ...this.patch });
      return { data: null, error: null };
    }
    const data = structuredClone(this.rangeArgs ? rows.slice(this.rangeArgs[0], this.rangeArgs[1] + 1) : rows);
    return { data: this.single ? (data[0] ?? null) : data, error: null };
  }
}

const UID = 'user-1';
let session: { user: { id: string; email: string } } | null = null;
let authCb: ((event: string, s: unknown) => void) | null = null;

vi.mock('./supabase', () => ({
  supabase: {
    from: (t: string) => new Query(t),
    channel: () => {
      const ch = {
        on: (_: string, opts: { table: string }, cb: (p: { eventType: string; new: Row; old: Row }) => void) => {
          db.handlers.push({ table: opts.table, cb });
          return ch;
        },
        subscribe: (cb: (s: string) => void) => {
          cb('SUBSCRIBED');
          return ch;
        },
      };
      return ch;
    },
    removeChannel: async () => {
      db.handlers = [];
    },
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        authCb = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signInWithPassword: async () => {
        session = { user: { id: UID, email: 'y@example.com' } };
        authCb?.('SIGNED_IN', session);
        return { error: null };
      },
      signUp: async () => ({ data: { session: null }, error: null }),
      signOut: async () => {
        session = null;
        authCb?.('SIGNED_OUT', null);
        return { error: null };
      },
    },
  },
}));

// ---------- helpers ----------
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

async function bootDevice() {
  session = null; // a new device starts signed out
  vi.resetModules();
  db.handlers = [];
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  const store = await import('./store');
  const sync = await import('./sync');
  sync.initSync();
  await tick();
  return { store, sync };
}

function liveRows(table: string) {
  return [...db.table(table).values()].filter((r) => !r.deleted_at && r.user_id === UID);
}

beforeEach(() => {
  db.tables.clear();
  db.handlers = [];
  db.failWrites = false;
  session = null;
  online = true;
});

describe('sync engine', () => {
  it('first device uploads its data; second device adopts cloud data and keeps a backup', async () => {
    const a = await bootDevice();
    a.store.updateClient(a.store.getState().clients[0].id, { status: 'סטטוס ממכשיר א' });
    await a.sync.signIn('y@example.com', 'pw');
    await tick();
    await a.sync.flush();

    expect(liveRows('clients')).toHaveLength(11);
    expect(liveRows('tasks')).toHaveLength(a.store.getState().tasks.length);
    expect(liveRows('people')).toHaveLength(7);
    expect(liveRows('clients').find((r) => r.name === 'אושר עד')!.status).toBe('סטטוס ממכשיר א');
    const aTaskIds = a.store.getState().tasks.map((t) => t.id);

    // Device B: fresh install with its own (different-id) seed data.
    const b = await bootDevice();
    expect(b.store.getState().tasks.map((t) => t.id)).not.toEqual(aTaskIds);
    await b.sync.signIn('y@example.com', 'pw');
    await tick(100);
    expect(b.store.getState().tasks.map((t) => t.id)).toEqual(aTaskIds);
    expect(b.store.getState().clients[0].status).toBe('סטטוס ממכשיר א');
    expect(b.store.getState().clients.map((c) => c.name)[6]).toBe('רד מרקט (גני תקווה)'); // order kept
    expect(localStorage.getItem('ras-pre-sync-backup')).toBeTruthy();
    // Adopting must not re-upload B's seed rows.
    expect(liveRows('tasks')).toHaveLength(aTaskIds.length);
  });

  it('pushes edits and soft-deletes, applies remote realtime edits, ignores stale echoes', async () => {
    const a = await bootDevice();
    await a.sync.signIn('y@example.com', 'pw');
    await tick();
    await a.sync.flush();

    const [t0, t1] = a.store.getState().tasks;
    a.store.updateTask(t0.id, { done: true });
    a.store.deleteTask(t1.id);
    await a.sync.flush();
    const r0 = liveRows('tasks').find((r) => r.id === t0.id)!;
    expect(r0.done).toBe(true);
    expect(r0.completed_at).toBeTruthy();
    expect(liveRows('tasks').some((r) => r.id === t1.id)).toBe(false);
    expect(db.table('tasks').get(`${UID}|${t1.id}`)!.deleted_at).toBeTruthy();

    // Another device edits a client status → arrives via realtime.
    const clientRow = liveRows('clients')[0];
    db.write('clients', { ...clientRow, status: 'מהנייד', updated_at: new Date(Date.now() + 1000).toISOString() });
    expect(a.store.getState().clients.find((c) => c.id === clientRow.id)!.status).toBe('מהנייד');

    // A late echo of an older version of our own row must not overwrite newer local data.
    a.store.updateTask(t0.id, { description: 'גרסה חדשה' });
    await a.sync.flush();
    db.handlers.forEach((h) =>
      h.table === 'tasks' && h.cb({ eventType: 'UPDATE', new: { ...r0, description: 'ישן', updated_at: '2000-01-01T00:00:00Z' }, old: {} }),
    );
    expect(a.store.getState().tasks.find((t) => t.id === t0.id)!.description).toBe('גרסה חדשה');

    // Remote delete via realtime.
    const t2 = a.store.getState().tasks[1];
    const r2 = liveRows('tasks').find((r) => r.id === t2.id)!;
    db.write('tasks', { ...r2, deleted_at: new Date().toISOString(), updated_at: new Date(Date.now() + 2000).toISOString() });
    expect(a.store.getState().tasks.some((t) => t.id === t2.id)).toBe(false);
  });

  it('keeps edits made offline / during failures in the outbox and pushes them later', async () => {
    const a = await bootDevice();
    await a.sync.signIn('y@example.com', 'pw');
    await tick();
    await a.sync.flush();

    db.failWrites = true;
    const c = a.store.getState().clients[2];
    a.store.updateClient(c.id, { status: 'נכתב בלי קליטה' });
    await a.sync.flush();
    expect(liveRows('clients').find((r) => r.id === c.id)!.status).not.toBe('נכתב בלי קליטה');

    // A pull while the edit is pending must not revert it.
    await a.sync.pull();
    expect(a.store.getState().clients.find((x) => x.id === c.id)!.status).toBe('נכתב בלי קליטה');

    // The outbox survives a restart of the app on the same device.
    const saved = new Map((globalThis as unknown as { localStorage: MemoryStorage }).localStorage.m);
    vi.resetModules();
    db.handlers = [];
    const storage = new MemoryStorage();
    storage.m = saved;
    (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;
    const store2 = await import('./store');
    const sync2 = await import('./sync');
    db.failWrites = false;
    sync2.initSync();
    await tick(100);
    await sync2.flush();
    expect(liveRows('clients').find((r) => r.id === c.id)!.status).toBe('נכתב בלי קליטה');
    expect(store2.getState().clients.find((x) => x.id === c.id)!.status).toBe('נכתב בלי קליטה');
  });

  it('people order and settings sync', async () => {
    const a = await bootDevice();
    await a.sync.signIn('y@example.com', 'pw');
    await tick();
    await a.sync.flush();
    a.store.movePerson('igal', -1);
    a.store.update((d) => void (d.settings.webhookUrl = 'https://hook'));
    await a.sync.flush();
    const order = liveRows('people')
      .sort((x, y) => Number(x.sort_order) - Number(y.sort_order))
      .map((r) => r.id);
    expect(order.slice(0, 4)).toEqual(['me', 'matan', 'igal', 'ilana']);
    expect(db.table('app_settings').get(UID)!.webhook_url).toBe('https://hook');

    const b = await bootDevice();
    await b.sync.signIn('y@example.com', 'pw');
    await tick(100);
    expect(b.store.getState().people.map((p) => p.id).slice(0, 4)).toEqual(['me', 'matan', 'igal', 'ilana']);
    expect(b.store.getState().settings.webhookUrl).toBe('https://hook');
  });
});
