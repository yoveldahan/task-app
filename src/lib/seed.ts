import type { AppData, Client, ClientCategory, Person, Project, Task } from './types';
import { newId } from './id';

export const SEED_PEOPLE: Person[] = [
  { id: 'me', name: 'אצלי (יובל)' },
  { id: 'matan', name: 'מתן' },
  { id: 'ilana', name: 'אילנה' },
  { id: 'igal', name: 'איגל' },
  { id: 'client', name: 'לקוח' },
  { id: 'vendor', name: 'ספק / חיצוני' },
  { id: 'mgmt', name: 'הנהלה' },
];

interface SeedTask {
  description: string;
  stuckWithId: string;
  stuckReason?: string;
}

interface SeedClient {
  name: string;
  category: ClientCategory;
  status: string;
  projects?: { name: string; tasks: SeedTask[] }[];
  tasks?: SeedTask[];
}

const SEED_CLIENTS: SeedClient[] = [
  {
    name: 'אושר עד',
    category: 'big',
    status: 'פריסה שוטפת בסניפים; ממתינים לאישור סופי על תמחור מסילות והזמנת מתאמים',
    projects: [
      {
        name: 'פרויקט שדרוג 3 סניפי מרכז',
        tasks: [
          { description: 'מיפוי כמות פרייסרים ומסילות בסניף בני ברק', stuckWithId: 'me' },
          {
            description: 'בדיקת זמינות מתאמים במחסן ל-3 הסניפים',
            stuckWithId: 'matan',
            stuckReason: 'ממתין לספירת מלאי במחסן',
          },
        ],
      },
    ],
    tasks: [
      { description: 'לשלוח הצעת מחיר מעודכנת למסילות רגילות 1280 מ"מ', stuckWithId: 'me' },
      { description: 'בדיקת זמינות מתאם 73014357-02 להזמנה קרובה', stuckWithId: 'matan' },
    ],
  },
  {
    name: 'פז (Yellow / סופר יודה)',
    category: 'big',
    status: 'עבודה שוטפת מול הרשת; בדיקת התאמת אביזרים ופלסטיקה לסניפים חדשים',
    tasks: [
      {
        description: 'מעקב אחר אספקת אביזרי פלסטיקה לסניפי סופר יודה',
        stuckWithId: 'ilana',
        stuckReason: 'בדיקת מועד יציאת משלוח מהמחסן',
      },
    ],
  },
  { name: 'מעדני גורמה', category: 'big', status: 'לקוח פעיל; מעקב הזמנות שוטפות והשלמות ציוד בסניפים' },
  { name: 'סלאח דבאח', category: 'big', status: 'לקוח פעיל; מעקב הצעות מחיר לפלסטיקה ושילוט' },
  { name: 'בני עיראקי', category: 'big', status: 'לקוח פעיל; שירות והשלמות תגים שוטפות' },
  { name: 'נוי השדה', category: 'big', status: 'לקוח פעיל; בדיקת צרכים להרחבת תגים בסניפים נוספים' },
  {
    name: 'רד מרקט (גני תקווה)',
    category: 'small',
    status: 'בוצע סקר סניף (1,900 צרים, 100 רחבים, 700 תגי 2.9); נשלחה הצעת מחיר לאישור',
    projects: [
      {
        name: 'פרויקט הקמת פרייסרים - גני תקווה',
        tasks: [
          { description: 'פולואפ מול הלקוח לאישור סופי של הצעת המחיר', stuckWithId: 'me' },
          {
            description: 'תיאום מועד התקנת תשתית ואנטנות בסניף',
            stuckWithId: 'client',
            stuckReason: 'טרם החזיר הצעה חתומה',
          },
        ],
      },
    ],
  },
  {
    name: 'בראשית',
    category: 'small',
    status: 'בבדיקת סטטוס הזמנה ותיאום מול אילנה',
    tasks: [{ description: 'לדבר עם אילנה לגבי סטטוס הזמנה של לקוח בראשית', stuckWithId: 'ilana' }],
  },
  {
    name: 'מרכז',
    category: 'small',
    status: 'בבירור פנימי מול איגל ואילנה',
    tasks: [{ description: 'לדבר עם איגל על אילנה לגבי לקוח מרכז', stuckWithId: 'igal' }],
  },
  {
    name: 'ח.י.ע.מ גורמה',
    category: 'lead',
    status: 'ליד חדש; נשלחה הצעת מחיר ראשונית, נדרש פולואפ טלפוני',
    tasks: [
      {
        description: 'פולואפ טלפוני על הצעת מחיר שנשלחה',
        stuckWithId: 'client',
        stuckReason: 'ביקש לחזור אליו אחרי בדיקת תקציב',
      },
    ],
  },
  { name: 'קיי טי שיווק', category: 'lead', status: 'ליד חדש; בבחינת הצעת מחיר ראשונית' },
];

export function blankTask(partial: Partial<Task> & { stuckWithId: string }): Task {
  return {
    id: newId(),
    clientId: null,
    projectId: null,
    description: '',
    done: false,
    dueDate: null,
    stuckReason: '',
    reminderDate: null,
    reminderTime: null,
    reminderFiredFor: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    ...partial,
  };
}

export function createSeedData(): AppData {
  // Each seed row gets its own millisecond so the original order survives sorting by created_at.
  const base = Date.now();
  let tick = 0;
  const stamp = () => new Date(base + tick++).toISOString();
  const now = stamp();
  const clients: Client[] = [];
  const projects: Project[] = [];
  const tasks: Task[] = [];

  for (const sc of SEED_CLIENTS) {
    const client: Client = {
      id: newId(),
      name: sc.name,
      category: sc.category,
      status: sc.status,
      statusUpdatedAt: now,
      createdAt: stamp(),
    };
    clients.push(client);

    for (const sp of sc.projects ?? []) {
      const project: Project = { id: newId(), clientId: client.id, name: sp.name, closed: false, createdAt: stamp() };
      projects.push(project);
      for (const st of sp.tasks) {
        tasks.push(blankTask({ ...st, clientId: client.id, projectId: project.id, createdAt: stamp() }));
      }
    }
    for (const st of sc.tasks ?? []) {
      tasks.push(blankTask({ ...st, clientId: client.id, createdAt: stamp() }));
    }
  }

  return {
    version: 1,
    clients,
    projects,
    tasks,
    topics: [],
    people: SEED_PEOPLE.map((p) => ({ ...p })),
    settings: { meId: 'me', webhookUrl: '', webhookSyncData: false, webhookSendReminders: false },
  };
}
