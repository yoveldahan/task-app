import type { AppData, MeetingTopic, Settings, Task } from './types';
import { STORAGE_KEY } from './constants';

/**
 * Persistence boundary. The app only talks to this interface, so a cloud
 * backend (Supabase / Firebase / Google Sheets) can replace localStorage by
 * implementing the same two methods.
 */
export interface StorageAdapter {
  load(): AppData | null;
  save(data: AppData): void;
}

export const localStorageAdapter: StorageAdapter = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as AppData) : null;
    } catch {
      return null;
    }
  },
  save(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  },
};

/** Fire-and-forget POST to the user's automation webhook (Make / Zapier / Apps Script). */
export async function postWebhook(url: string, payload: unknown): Promise<boolean> {
  if (!url) return false;
  try {
    // text/plain + no-cors avoid a CORS preflight, which Apps Script web apps don't answer.
    // With no-cors the response is opaque (ok is always false), so only a thrown error counts as failure.
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    return true;
  } catch {
    return false;
  }
}

/** Fills fields added in later versions so older backups/imports keep working. */
type DeepPartialData = Partial<Omit<AppData, 'tasks' | 'topics' | 'settings'>> & {
  tasks?: Partial<Task>[];
  topics?: Partial<MeetingTopic>[];
  settings?: Partial<Settings>;
};

/**
 * Older data had several rows sharing one createdAt (seeded in the same millisecond).
 * The cloud orders rows by created_at, so make them strictly increasing in array order.
 */
function uniqueCreatedAt<T extends { createdAt: string }>(list: T[]): T[] {
  let prev = -Infinity;
  return list.map((item) => {
    const t = Date.parse(item.createdAt);
    if (Number.isNaN(t) || t > prev) {
      prev = Number.isNaN(t) ? prev : t;
      return item;
    }
    prev += 1;
    return { ...item, createdAt: new Date(prev).toISOString() };
  });
}

export function normalizeData(input: DeepPartialData): AppData {
  return {
    version: 1,
    clients: uniqueCreatedAt(input.clients ?? []),
    projects: uniqueCreatedAt(input.projects ?? []),
    tasks: uniqueCreatedAt((input.tasks ?? []).map((t) => ({ reminderFiredFor: null, completedAt: null, ...t }) as Task)),
    topics: uniqueCreatedAt(
      (input.topics ?? []).map((t) => ({ reminderFiredFor: null, convertedTaskId: null, ...t }) as MeetingTopic),
    ),
    summaries: uniqueCreatedAt(input.summaries ?? []),
    people: input.people ?? [],
    settings: {
      meId: 'me',
      webhookUrl: '',
      webhookSyncData: false,
      webhookSendReminders: false,
      ...input.settings,
    },
  };
}
