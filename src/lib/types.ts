export type ClientCategory = 'big' | 'small' | 'lead';

export interface Client {
  id: string;
  name: string;
  category: ClientCategory;
  /** Free-text general status, edited inline from the clients screen. */
  status: string;
  statusUpdatedAt: string | null;
  createdAt: string;
}

export interface Project {
  id: string;
  clientId: string;
  name: string;
  closed: boolean;
  createdAt: string;
}

/** Shared reminder fields for tasks and meeting topics. */
export interface Reminder {
  reminderDate: string | null; // YYYY-MM-DD
  reminderTime: string | null; // HH:MM from REMINDER_TIMES
  /** `${date} ${time}` of the reminder that already fired, so editing it re-arms. */
  reminderFiredFor: string | null;
}

export interface Task extends Reminder {
  id: string;
  clientId: string | null;
  /** null = routine task (משימה שוטפת). */
  projectId: string | null;
  description: string;
  done: boolean;
  dueDate: string | null;
  stuckWithId: string;
  stuckReason: string;
  createdAt: string;
  completedAt: string | null;
}

export interface MeetingTopic extends Reminder {
  id: string;
  meetingDate: string;
  topic: string;
  /** null = כללי / חברה */
  clientId: string | null;
  projectId: string | null;
  withWhomId: string;
  background: string;
  discussed: boolean;
  decision: string;
  convertedTaskId: string | null;
  createdAt: string;
}

/** Running summary typed during a weekly meeting – one per meeting date. */
export interface MeetingSummary {
  id: string;
  meetingDate: string; // YYYY-MM-DD
  summary: string;
  /** true once the summary was sent; archived summaries are read-only history. */
  archived: boolean;
  createdAt: string;
}

export interface Person {
  id: string;
  name: string;
}

export interface Settings {
  meId: string;
  /** Optional endpoint (Make / Zapier / Apps Script) for cloud sync and reminder automation. */
  webhookUrl: string;
  webhookSyncData: boolean;
  webhookSendReminders: boolean;
}

export interface AppData {
  version: number;
  clients: Client[];
  projects: Project[];
  tasks: Task[];
  topics: MeetingTopic[];
  summaries: MeetingSummary[];
  people: Person[];
  settings: Settings;
}
