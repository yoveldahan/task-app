import { useSyncExternalStore } from 'react';
import type { AppData, Client, MeetingTopic, Project, Task } from './types';
import { createSeedData, blankTask } from './seed';
import { localStorageAdapter, normalizeData, postWebhook, type StorageAdapter } from './storage';
import { newId } from './id';
import { upcomingSunday } from './dates';
import { STORAGE_KEY } from './constants';

const adapter: StorageAdapter = localStorageAdapter;

let state: AppData = (() => {
  const loaded = adapter.load();
  return loaded ? normalizeData(loaded) : createSeedData();
})();

const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let syncTimer: ReturnType<typeof setTimeout> | undefined;

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => adapter.save(state), 150);

  const { webhookUrl, webhookSyncData } = state.settings;
  if (webhookUrl && webhookSyncData) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      postWebhook(webhookUrl, { event: 'data-sync', sentAt: new Date().toISOString(), data: state });
    }, 3000);
  }
}

// Save immediately on first run so the seed data's ids are stable across reloads.
if (!adapter.load()) adapter.save(state);

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    clearTimeout(saveTimer);
    adapter.save(state);
  });
  // Keep multiple open tabs in sync.
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY && e.newValue) {
      state = normalizeData(JSON.parse(e.newValue));
      emit();
    }
  });
}

/** Applies a mutation to a deep copy of the state, then saves and notifies. */
export function update(recipe: (draft: AppData) => void) {
  const draft = structuredClone(state);
  recipe(draft);
  state = draft;
  persist();
  emit();
}

export function getState(): AppData {
  return state;
}

export function replaceState(data: AppData) {
  state = normalizeData(data);
  persist();
  emit();
}

export function useStore<T>(selector: (s: AppData) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => selector(state),
  );
}

export function useData(): AppData {
  return useStore((s) => s);
}

// ---------- Clients ----------

export function addClient(name: string, category: Client['category']): Client {
  const client: Client = {
    id: newId(),
    name,
    category,
    status: '',
    statusUpdatedAt: null,
    createdAt: new Date().toISOString(),
  };
  update((d) => void d.clients.push(client));
  return client;
}

export function updateClient(id: string, patch: Partial<Client>) {
  update((d) => {
    const c = d.clients.find((x) => x.id === id);
    if (!c) return;
    Object.assign(c, patch);
    if ('status' in patch) c.statusUpdatedAt = new Date().toISOString();
  });
}

export function deleteClient(id: string) {
  update((d) => {
    d.clients = d.clients.filter((c) => c.id !== id);
    d.projects = d.projects.filter((p) => p.clientId !== id);
    d.tasks = d.tasks.filter((t) => t.clientId !== id);
    for (const t of d.topics) {
      if (t.clientId === id) {
        t.clientId = null;
        t.projectId = null;
      }
    }
  });
}

// ---------- Projects ----------

export function addProject(clientId: string, name: string): Project {
  const project: Project = { id: newId(), clientId, name, closed: false, createdAt: new Date().toISOString() };
  update((d) => void d.projects.push(project));
  return project;
}

export function updateProject(id: string, patch: Partial<Project>) {
  update((d) => {
    const p = d.projects.find((x) => x.id === id);
    if (p) Object.assign(p, patch);
  });
}

export function deleteProject(id: string) {
  update((d) => {
    d.projects = d.projects.filter((p) => p.id !== id);
    d.tasks = d.tasks.filter((t) => t.projectId !== id);
    for (const t of d.topics) if (t.projectId === id) t.projectId = null;
  });
}

// ---------- Tasks ----------

export function addTask(partial: Partial<Task>): Task {
  const task = blankTask({ stuckWithId: state.settings.meId, ...partial });
  update((d) => void d.tasks.push(task));
  return task;
}

export function updateTask(id: string, patch: Partial<Task>) {
  update((d) => {
    const t = d.tasks.find((x) => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
    if ('done' in patch) t.completedAt = patch.done ? new Date().toISOString() : null;
    // Moving a task to another client detaches it from the old client's project.
    if ('clientId' in patch && t.projectId) {
      const p = d.projects.find((x) => x.id === t.projectId);
      if (!p || p.clientId !== t.clientId) t.projectId = null;
    }
  });
}

export function deleteTask(id: string) {
  update((d) => {
    d.tasks = d.tasks.filter((t) => t.id !== id);
  });
}

// ---------- Meeting topics ----------

export function addTopic(partial: Partial<MeetingTopic>): MeetingTopic {
  const topic: MeetingTopic = {
    id: newId(),
    meetingDate: upcomingSunday(),
    topic: '',
    clientId: null,
    projectId: null,
    withWhomId: state.settings.meId,
    background: '',
    discussed: false,
    decision: '',
    convertedTaskId: null,
    reminderDate: null,
    reminderTime: null,
    reminderFiredFor: null,
    createdAt: new Date().toISOString(),
    ...partial,
  };
  update((d) => void d.topics.push(topic));
  return topic;
}

export function updateTopic(id: string, patch: Partial<MeetingTopic>) {
  update((d) => {
    const t = d.topics.find((x) => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
    if ('clientId' in patch && t.projectId) {
      const p = d.projects.find((x) => x.id === t.projectId);
      if (!p || p.clientId !== t.clientId) t.projectId = null;
    }
  });
}

export function deleteTopic(id: string) {
  update((d) => {
    d.topics = d.topics.filter((t) => t.id !== id);
  });
}

/** "הפוך למשימה" – turns the meeting decision into a new task under the related client. */
export function convertTopicToTask(topicId: string): Task | null {
  const topic = state.topics.find((t) => t.id === topicId);
  if (!topic) return null;
  const task = blankTask({
    clientId: topic.clientId,
    projectId: topic.projectId,
    description: topic.decision.trim() || topic.topic.trim(),
    stuckWithId: topic.withWhomId,
    stuckReason: topic.decision.trim() ? `החלטה מישיבה ${topic.meetingDate}: ${topic.topic.trim()}` : '',
  });
  update((d) => {
    d.tasks.push(task);
    const t = d.topics.find((x) => x.id === topicId);
    if (t) t.convertedTaskId = task.id;
  });
  return task;
}

// ---------- People ----------

export function addPerson(name: string) {
  update((d) => void d.people.push({ id: newId(), name }));
}

export function renamePerson(id: string, name: string) {
  update((d) => {
    const p = d.people.find((x) => x.id === id);
    if (p) p.name = name;
  });
}

/** Items referencing the removed person fall back to "me". */
export function deletePerson(id: string) {
  update((d) => {
    if (id === d.settings.meId) return;
    d.people = d.people.filter((p) => p.id !== id);
    for (const t of d.tasks) if (t.stuckWithId === id) t.stuckWithId = d.settings.meId;
    for (const t of d.topics) if (t.withWhomId === id) t.withWhomId = d.settings.meId;
  });
}

export function movePerson(id: string, dir: -1 | 1) {
  update((d) => {
    const i = d.people.findIndex((p) => p.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= d.people.length) return;
    [d.people[i], d.people[j]] = [d.people[j], d.people[i]];
  });
}

export function resetToSeed() {
  replaceState(createSeedData());
}
