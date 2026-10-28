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
    // text/plain avoids a CORS preflight, which Apps Script web apps don't answer.
    await fetch(url, {
      method: 'POST',
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

export function normalizeData(input: DeepPartialData): AppData {
  return {
    version: 1,
    clients: input.clients ?? [],
    projects: input.projects ?? [],
    tasks: (input.tasks ?? []).map((t) => ({ reminderFiredFor: null, completedAt: null, ...t }) as Task),
    topics: (input.topics ?? []).map((t) => ({ reminderFiredFor: null, convertedTaskId: null, ...t }) as MeetingTopic),
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
