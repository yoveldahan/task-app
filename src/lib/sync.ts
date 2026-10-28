/**
 * Cloud sync with Supabase.
 *
 * localStorage stays the working copy (instant UI, works offline). Local edits are
 * recorded in a persisted outbox and pushed in the background; other devices'
 * edits arrive through Supabase Realtime, plus a full pull on start, on reconnect
 * and when the app returns to the foreground. Conflicts resolve per row: the
 * latest write wins, and a row with an unpushed local edit is never overwritten.
 */
import { useSyncExternalStore } from 'react';
import type { RealtimeChannel, Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { applyRemote, getState, setChangeListener } from './store';
import type { AppData } from './types';
import {
  SETTINGS_TABLE,
  TABLES,
  applyRowToDraft,
  diffState,
  reconcile,
  settingsToRow,
  snapshotIsEmpty,
  toRow,
  type ChangeKey,
  type Row,
  type Snapshot,
  type TableName,
} from './syncCore';
import { showToast } from './toast';

const OUTBOX_KEY = 'ras-sync-outbox-v1';
const META_KEY = 'ras-sync-meta-v1';
export const PRE_SYNC_BACKUP_KEY = 'ras-pre-sync-backup';

// ---------- status (observable from React) ----------

export type SyncStatus = 'signed-out' | 'syncing' | 'synced' | 'offline' | 'error';

export interface SyncInfo {
  status: SyncStatus;
  email: string | null;
  userId: string | null;
  pending: number;
  lastSyncAt: string | null;
  error: string | null;
}

let info: SyncInfo = { status: 'signed-out', email: null, userId: null, pending: 0, lastSyncAt: null, error: null };
const listeners = new Set<() => void>();

function setInfo(patch: Partial<SyncInfo>) {
  info = { ...info, ...patch };
  listeners.forEach((l) => l());
}

export function useSyncInfo(): SyncInfo {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => info,
  );
}

// ---------- persisted outbox ----------

/** key → edit counter; an entry is only cleared if no newer edit happened while it was being pushed. */
const outbox = new Map<ChangeKey, number>(
  (() => {
    try {
      return JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]') as [ChangeKey, number][];
    } catch {
      return [];
    }
  })(),
);

function saveOutbox() {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify([...outbox]));
  setInfo({ pending: outbox.size });
}

/** updated_at of the newest version this device pushed, to ignore late realtime echoes of older versions. */
const lastPushed = new Map<ChangeKey, number>();

interface Meta {
  userId: string | null;
}

function loadMeta(): Meta {
  try {
    return { userId: null, ...JSON.parse(localStorage.getItem(META_KEY) ?? '{}') };
  } catch {
    return { userId: null };
  }
}

function saveMeta(meta: Meta) {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

// ---------- state ----------

let userId: string | null = null;
let channel: RealtimeChannel | null = null;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 2000;
let lastError: string | null = null;

/** Pull and push never overlap, so a snapshot can't be older than a push that already finished. */
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

function refreshStatus(busy = false) {
  if (!userId) return setInfo({ status: 'signed-out', error: null });
  if (!navigator.onLine) return setInfo({ status: 'offline' });
  if (busy) return setInfo({ status: 'syncing' });
  if (lastError) return setInfo({ status: 'error', error: lastError });
  setInfo({ status: outbox.size ? 'syncing' : 'synced', error: null });
}

function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

// ---------- local changes → outbox ----------

function onLocalChange(prev: AppData, next: AppData) {
  const changes = diffState(prev, next);
  if (!changes.length) return;
  for (const key of changes) outbox.set(key, (outbox.get(key) ?? 0) + 1);
  saveOutbox();
  scheduleFlush(800);
}

function scheduleFlush(delay: number) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flush(), delay);
}

// ---------- push ----------

export function flush(): Promise<void> {
  return exclusive(async () => {
    if (!userId || !outbox.size || !navigator.onLine) return refreshStatus();
    const uid = userId;
    const batch = new Map(outbox);
    const state = getState();
    const now = new Date().toISOString();
    refreshStatus(true);

    try {
      for (const { table, key } of TABLES) {
        const list = state[key] as { id: string }[];
        const byId = new Map(list.map((e, i) => [e.id, { e, i }]));
        const upserts: Row[] = [];
        const deletes: string[] = [];
        for (const k of batch.keys()) {
          if (!k.startsWith(`${table}:`)) continue;
          const id = k.slice(table.length + 1);
          const found = byId.get(id);
          if (found) upserts.push(toRow(found.e as never, uid, now, key === 'people' ? found.i : undefined));
          else deletes.push(id);
        }
        for (let i = 0; i < upserts.length; i += 500) {
          const { error } = await supabase.from(table).upsert(upserts.slice(i, i + 500), { onConflict: 'user_id,id' });
          if (error) throw error;
        }
        for (let i = 0; i < deletes.length; i += 200) {
          const { error } = await supabase
            .from(table)
            .update({ deleted_at: now, updated_at: now })
            .eq('user_id', uid)
            .in('id', deletes.slice(i, i + 200));
          if (error) throw error;
        }
      }
      if (batch.has('settings')) {
        const { error } = await supabase
          .from(SETTINGS_TABLE)
          .upsert(settingsToRow(state.settings, uid, now), { onConflict: 'user_id' });
        if (error) throw error;
      }

      const pushedAt = Date.parse(now);
      for (const [k, counter] of batch) {
        lastPushed.set(k, pushedAt);
        if (outbox.get(k) === counter) outbox.delete(k);
      }
      saveOutbox();
      lastError = null;
      retryDelay = 2000;
      setInfo({ lastSyncAt: now });
      if (outbox.size) scheduleFlush(300);
    } catch (e) {
      lastError = errorMessage(e);
      scheduleFlush(retryDelay);
      retryDelay = Math.min(retryDelay * 2, 60_000);
    } finally {
      refreshStatus();
    }
  });
}

// ---------- pull ----------

async function fetchAll(table: TableName, uid: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('user_id', uid)
      .is('deleted_at', null)
      .order('id')
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data as Row[]));
    if (data.length < 1000) return rows;
  }
}

async function fetchSnapshot(uid: string): Promise<Snapshot> {
  const [clients, projects, tasks, meeting_topics, people, settings] = await Promise.all([
    fetchAll('clients', uid),
    fetchAll('projects', uid),
    fetchAll('tasks', uid),
    fetchAll('meeting_topics', uid),
    fetchAll('people', uid),
    supabase.from(SETTINGS_TABLE).select('*').eq('user_id', uid).maybeSingle(),
  ]);
  if (settings.error) throw settings.error;
  return { clients, projects, tasks, meeting_topics, people, settings: settings.data as Row | null };
}

function markAllPending(state: AppData) {
  for (const { table, key } of TABLES) {
    for (const e of state[key] as { id: string }[]) outbox.set(`${table}:${e.id}`, (outbox.get(`${table}:${e.id}`) ?? 0) + 1);
  }
  outbox.set('settings', (outbox.get('settings') ?? 0) + 1);
  saveOutbox();
}

export function pull(): Promise<void> {
  return exclusive(async () => {
    if (!userId || !navigator.onLine) return refreshStatus();
    const uid = userId;
    refreshStatus(true);
    try {
      const snap = await fetchSnapshot(uid);
      const meta = loadMeta();

      if (meta.userId !== uid) {
        // First sync of this device for this account.
        outbox.clear();
        if (snapshotIsEmpty(snap)) {
          markAllPending(getState());
          showToast('☁️ הנתונים מהמכשיר הזה הועלו לענן', { kind: 'success' });
        } else {
          localStorage.setItem(
            PRE_SYNC_BACKUP_KEY,
            JSON.stringify({ savedAt: new Date().toISOString(), data: getState() }),
          );
          const next = reconcile(getState(), snap, new Set());
          applyRemote((d) => Object.assign(d, next));
          saveOutbox();
          showToast('☁️ הנתונים נטענו מהענן. גיבוי של הנתונים המקומיים הקודמים נשמר בהגדרות.', {
            kind: 'success',
            duration: 7000,
          });
        }
        saveMeta({ userId: uid });
      } else {
        const next = reconcile(getState(), snap, new Set(outbox.keys()));
        applyRemote((d) => Object.assign(d, next));
      }

      lastError = null;
      setInfo({ lastSyncAt: new Date().toISOString() });
    } catch (e) {
      lastError = errorMessage(e);
    } finally {
      refreshStatus();
    }
  }).then(() => {
    if (outbox.size) scheduleFlush(100);
  });
}

// ---------- realtime ----------

function onRealtimeRow(table: TableName | typeof SETTINGS_TABLE, eventType: string, row: Row) {
  const key: ChangeKey = table === SETTINGS_TABLE ? 'settings' : `${table}:${String(row.id)}`;
  if (outbox.has(key)) return; // our unpushed edit wins
  const pushed = lastPushed.get(key);
  if (pushed && row.updated_at && Date.parse(String(row.updated_at)) < pushed) return; // stale echo
  if (eventType === 'DELETE') row = { ...row, deleted_at: new Date().toISOString() };
  applyRemote((d) => applyRowToDraft(d, table, row));
  setInfo({ lastSyncAt: new Date().toISOString() });
}

function subscribe(uid: string) {
  unsubscribe();
  let first = true;
  let ch = supabase.channel(`ras-sync-${uid}`);
  for (const table of [...TABLES.map((t) => t.table), SETTINGS_TABLE] as const) {
    ch = ch.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `user_id=eq.${uid}` },
      (payload) => {
        const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Row;
        if (row && (row.id !== undefined || table === SETTINGS_TABLE)) onRealtimeRow(table, payload.eventType, row);
      },
    );
  }
  channel = ch.subscribe((status) => {
    // After a dropped connection, catch up on anything missed while disconnected.
    if (status === 'SUBSCRIBED') {
      if (!first) void pull();
      first = false;
    }
  });
}

function unsubscribe() {
  if (channel) void supabase.removeChannel(channel);
  channel = null;
}

// ---------- lifecycle ----------

async function start(session: Session) {
  if (userId === session.user.id) return;
  userId = session.user.id;
  setInfo({ email: session.user.email ?? null, userId: session.user.id });
  setChangeListener(onLocalChange);
  await pull();
  subscribe(userId);
}

function stop() {
  userId = null;
  unsubscribe();
  clearTimeout(flushTimer);
  setInfo({ email: null, userId: null, lastSyncAt: null });
  refreshStatus();
}

export function initSync() {
  // A device that was signed in keeps recording edits right away, before the session is restored.
  if (loadMeta().userId) setChangeListener(onLocalChange);
  setInfo({ pending: outbox.size });

  void supabase.auth.getSession().then(({ data }) => {
    if (data.session) void start(data.session);
    else refreshStatus();
  });
  supabase.auth.onAuthStateChange((event, session) => {
    if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) void start(session);
    if (event === 'SIGNED_OUT') stop();
  });

  window.addEventListener('online', () => {
    refreshStatus();
    void pull();
  });
  window.addEventListener('offline', () => refreshStatus());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && userId) void pull();
  });
}

function redirectUrl(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? translateAuthError(error.message) : null;
}

/** Returns an error message, or null plus whether email confirmation is still required. */
export async function signUp(email: string, password: string): Promise<{ error: string | null; needsConfirm: boolean }> {
  const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectUrl() } });
  if (error) return { error: translateAuthError(error.message), needsConfirm: false };
  return { error: null, needsConfirm: !data.session };
}

export async function signOut(): Promise<void> {
  if (outbox.size) await flush();
  await supabase.auth.signOut();
  setChangeListener(null);
  outbox.clear();
  saveOutbox();
  saveMeta({ userId: null });
  stop();
}

export async function syncNow() {
  await flush();
  await pull();
}

function translateAuthError(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return 'אימייל או סיסמה שגויים';
  if (/email not confirmed/i.test(msg)) return 'יש לאשר את כתובת האימייל דרך הקישור שנשלח אליך';
  if (/already registered/i.test(msg)) return 'המשתמש כבר קיים – התחבר במקום להירשם';
  if (/password should be at least/i.test(msg)) return 'הסיסמה קצרה מדי (לפחות 6 תווים)';
  if (/rate limit/i.test(msg)) return 'יותר מדי ניסיונות – נסה שוב בעוד כמה דקות';
  return msg;
}
