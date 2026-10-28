/**
 * Pure helpers for cloud sync (no network): row mapping, change detection and
 * merging a cloud snapshot with local data. Kept free of side effects for testing.
 */
import type { AppData, Client, MeetingTopic, Person, Project, Settings, Task } from './types';

export type TableName = 'clients' | 'projects' | 'tasks' | 'meeting_topics' | 'people';
export type CollectionKey = 'clients' | 'projects' | 'tasks' | 'topics' | 'people';

export const TABLES: { table: TableName; key: CollectionKey }[] = [
  { table: 'clients', key: 'clients' },
  { table: 'projects', key: 'projects' },
  { table: 'tasks', key: 'tasks' },
  { table: 'meeting_topics', key: 'topics' },
  { table: 'people', key: 'people' },
];

export const SETTINGS_TABLE = 'app_settings';

type Entity = Client | Project | Task | MeetingTopic | Person;
export type Row = Record<string, unknown>;

/** Pending local change: the table row id, or 'settings'. */
export type ChangeKey = `${TableName}:${string}` | 'settings';

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

const ROW_META = new Set(['user_id', 'updated_at', 'deleted_at', 'sort_order']);

export function toRow(entity: Entity, userId: string, updatedAt: string, sortOrder?: number): Row {
  const row: Row = { user_id: userId, updated_at: updatedAt, deleted_at: null };
  for (const [k, v] of Object.entries(entity)) row[snake(k)] = v;
  if (sortOrder !== undefined) row.sort_order = sortOrder;
  return row;
}

/** Postgres returns timestamps as "2026-10-28T21:15:00+00:00"; keep local ones in toISOString() form so they sort as strings. */
export function fromRow<T extends Entity>(row: Row): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (ROW_META.has(k)) continue;
    const key = camel(k);
    out[key] = key.endsWith('At') && typeof v === 'string' ? new Date(v).toISOString() : v;
  }
  return out as T;
}

export function settingsToRow(s: Settings, userId: string, updatedAt: string): Row {
  return {
    user_id: userId,
    me_id: s.meId,
    webhook_url: s.webhookUrl,
    webhook_sync_data: s.webhookSyncData,
    webhook_send_reminders: s.webhookSendReminders,
    updated_at: updatedAt,
  };
}

export function settingsFromRow(row: Row): Settings {
  return {
    meId: String(row.me_id ?? 'me'),
    webhookUrl: String(row.webhook_url ?? ''),
    webhookSyncData: !!row.webhook_sync_data,
    webhookSendReminders: !!row.webhook_send_reminders,
  };
}

/** Row ids that differ between two states (added, changed or removed), plus 'settings'. */
export function diffState(prev: AppData, next: AppData): ChangeKey[] {
  const changes: ChangeKey[] = [];
  for (const { table, key } of TABLES) {
    const before = new Map<string, string>();
    // People's position is part of the row (sort_order), so include the index.
    (prev[key] as Entity[]).forEach((e, i) => before.set(e.id, JSON.stringify(key === 'people' ? [e, i] : e)));
    const seen = new Set<string>();
    (next[key] as Entity[]).forEach((e, i) => {
      seen.add(e.id);
      if (before.get(e.id) !== JSON.stringify(key === 'people' ? [e, i] : e)) changes.push(`${table}:${e.id}`);
    });
    for (const id of before.keys()) if (!seen.has(id)) changes.push(`${table}:${id}`);
  }
  if (JSON.stringify(prev.settings) !== JSON.stringify(next.settings)) changes.push('settings');
  return changes;
}

export function byCreatedAt<T extends { createdAt: string; id: string }>(a: T, b: T): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface Snapshot {
  clients: Row[];
  projects: Row[];
  tasks: Row[];
  meeting_topics: Row[];
  people: Row[];
  settings: Row | null;
}

export function snapshotIsEmpty(s: Snapshot): boolean {
  return !s.settings && TABLES.every(({ table }) => s[table].length === 0);
}

function sortCollection(key: CollectionKey, list: Entity[], order?: Map<string, number>): Entity[] {
  if (key === 'people') return [...list].sort((a, b) => (order?.get(a.id) ?? 0) - (order?.get(b.id) ?? 0));
  return [...(list as (Entity & { createdAt: string })[])].sort(byCreatedAt);
}

/**
 * Cloud snapshot (live rows only) becomes the truth, except rows with a pending
 * local change, which keep their local version (or stay deleted).
 */
export function reconcile(local: AppData, snap: Snapshot, pending: Set<ChangeKey>): AppData {
  const next = structuredClone(local);
  for (const { table, key } of TABLES) {
    const localById = new Map((local[key] as Entity[]).map((e) => [e.id, e]));
    const order = new Map<string, number>();
    const merged: Entity[] = [];
    const remoteIds = new Set<string>();
    for (const row of snap[table]) {
      const id = String(row.id);
      remoteIds.add(id);
      order.set(id, Number(row.sort_order ?? 0));
      if (pending.has(`${table}:${id}`)) {
        const mine = localById.get(id);
        if (mine) merged.push(mine); // else: deleted locally, not yet pushed
      } else {
        merged.push(fromRow(row));
      }
    }
    // Created locally and not pushed yet.
    for (const e of local[key] as Entity[]) {
      if (!remoteIds.has(e.id) && pending.has(`${table}:${e.id}`)) merged.push(e);
    }
    if (key === 'people') {
      // Unpushed local people keep their local position.
      (local.people as Entity[]).forEach((p, i) => {
        if (pending.has(`people:${p.id}`)) order.set(p.id, i);
      });
    }
    (next as unknown as Record<CollectionKey, Entity[]>)[key] = sortCollection(key, merged, order);
  }
  if (snap.settings && !pending.has('settings')) next.settings = settingsFromRow(snap.settings);
  return next;
}

/** Applies one realtime row event to the state draft. Returns false if nothing changed. */
export function applyRowToDraft(draft: AppData, table: TableName | typeof SETTINGS_TABLE, row: Row): void {
  if (table === SETTINGS_TABLE) {
    draft.settings = settingsFromRow(row);
    return;
  }
  const { key } = TABLES.find((t) => t.table === table)!;
  const list = draft[key] as Entity[];
  const id = String(row.id);
  const idx = list.findIndex((e) => e.id === id);
  if (row.deleted_at) {
    if (idx >= 0) list.splice(idx, 1);
    return;
  }
  const entity = fromRow<Entity>(row);
  if (idx >= 0) list[idx] = entity;
  else list.push(entity);

  if (key === 'people') {
    // Re-place the person by sort_order relative to the others (which keep their current order).
    const sortOrder = Number(row.sort_order ?? 0);
    const without = list.filter((e) => e.id !== id);
    const at = Math.min(Math.max(sortOrder, 0), without.length);
    without.splice(at, 0, entity);
    draft.people = without as Person[];
  } else {
    (draft as unknown as Record<CollectionKey, Entity[]>)[key] = sortCollection(key, list);
  }
}
