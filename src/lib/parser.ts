import type { AppData } from './types';
import { addDays, toISODate, upcomingSunday } from './dates';
import { REMINDER_TIMES } from './constants';

export interface ParsedInput {
  kind: 'task' | 'topic';
  /** Cleaned text: prefix and date/time phrases removed, names kept. */
  text: string;
  clientId: string | null;
  projectId: string | null;
  /** Set when the text says "פרויקט חדש: ..." and a client was recognised. */
  newProjectName: string | null;
  personId: string | null;
  dueDate: string | null;
  reminderDate: string | null;
  reminderTime: string | null;
  meetingDate: string | null;
}

// Accepts the spoken form too: dictation produces "נושא לישיבה" without a colon.
const MEETING_PREFIX_RE = /^\s*נושא\s+ל?ישיבה\s*[:\-–,.]?\s*/;
// Header of a message copied from WhatsApp: "[10:15, 28.10.2026] מתן: ..." – its time must not become a reminder.
export function isMeetingText(s: string): boolean {
  return MEETING_PREFIX_RE.test(s);
}

const WHATSAPP_HEADER_RE = /^\s*\[[^\]]*\d{1,2}[:.]\d{2}[^\]]*\]\s*[^:\n]{1,40}:\s*/;

const BOUNDARY = `\\s,.;:!?()"'״׳\\-–/`;
// Hebrew attaches prepositions to the word: ל־, ב־, מ־, ו־, ה־, ש־, כ־ (up to two, e.g. "ולאושר").
const PREFIX = '[ובלמהשכ]{0,2}';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Position of `keyword` as a whole Hebrew word (allowing attached prefixes), or -1. */
function findWord(text: string, keyword: string): number {
  const re = new RegExp(`(^|[${BOUNDARY}])${PREFIX}${escapeRe(keyword.toLowerCase())}(?=$|[${BOUNDARY}])`);
  const m = re.exec(text);
  return m ? m.index + m[1].length : -1;
}

/** "פז (Yellow / סופר יודה)" → ["פז (yellow / סופר יודה)", "פז", "yellow", "סופר יודה"] */
export function nameKeywords(name: string): string[] {
  const out = new Set<string>();
  const clean = name.trim().toLowerCase();
  out.add(clean);
  const base = clean.replace(/\(.*?\)/g, '').trim();
  if (base) out.add(base);
  for (const m of clean.matchAll(/\((.*?)\)/g)) {
    for (const part of m[1].split(/[/,]/)) {
      const p = part.trim();
      if (p.length >= 2) out.add(p);
    }
  }
  for (const part of base.split('/')) {
    const p = part.trim();
    if (p.length >= 2) out.add(p);
  }
  return [...out];
}

// These values in the "stuck with" list are ordinary words, so they only count after "אצל".
export const GENERIC_PEOPLE = new Set(['לקוח', 'ספק', 'חיצוני', 'הנהלה']);

interface Match {
  id: string;
  index: number;
  length: number;
}

export function bestMatch(text: string, candidates: { id: string; keywords: string[] }[]): Match | null {
  let best: Match | null = null;
  for (const c of candidates) {
    for (const k of c.keywords) {
      const index = findWord(text, k);
      if (index < 0) continue;
      // Prefer the longest keyword (most specific), then the earliest mention.
      if (!best || k.length > best.length || (k.length === best.length && index < best.index)) {
        best = { id: c.id, index, length: k.length };
      }
    }
  }
  return best;
}

const WEEKDAY_WORDS: [RegExp, number][] = [
  [/ראשון|א['׳]/, 0],
  [/שני|ב['׳]/, 1],
  [/שלישי|ג['׳]/, 2],
  [/רביעי|ד['׳]/, 3],
  [/חמישי|ה['׳]/, 4],
  [/שישי|ו['׳]/, 5],
];

function weekdayIndex(word: string): number {
  for (const [re, idx] of WEEKDAY_WORDS) if (new RegExp(`^(?:${re.source})$`).test(word)) return idx;
  return -1;
}

/** Strictly in the future: "יום ראשון" said on a Sunday means next week. */
function nextWeekday(weekday: number, now: Date): string {
  const diff = (weekday - now.getDay() + 7) % 7 || 7;
  return toISODate(addDays(now, diff));
}

export function roundToSlot(h: number, m: number): string {
  const minutes = Math.min(Math.max(h * 60 + (m >= 30 ? 30 : 0), 8 * 60), 20 * 60);
  const slot = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return REMINDER_TIMES.includes(slot) ? slot : '09:00';
}

interface DateTimeResult {
  date: string | null;
  time: string | null;
  rest: string;
}

export function extractDateTime(input: string, now: Date): DateTimeResult {
  let rest = input;
  let date: string | null = null;
  let time: string | null = null;

  const take = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    const m = re.exec(rest);
    if (!m) return false;
    fn(m);
    rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length);
    return true;
  };

  const B = `(?<=^|[${BOUNDARY}])`;
  const E = `(?=$|[${BOUNDARY}])`;

  // ----- time (before dates, so "10:30" isn't read as a date) -----
  take(
    new RegExp(`${B}(?:ב-?|בשעה\\s*|עד\\s*)?(\\d{1,2}):(\\d{2})(?:\\s*(בבוקר|בצהריים|אחה"צ|אחר הצהריים|בערב))?${E}`),
    (m) => {
      let h = Number(m[1]);
      if (m[3] && m[3] !== 'בבוקר' && h < 12) h += 12;
      time = roundToSlot(h, Number(m[2]));
    },
  ) ||
    take(new RegExp(`${B}בשעה\\s*(\\d{1,2})(?:\\s*(בבוקר|בצהריים|אחה"צ|אחר הצהריים|בערב))?${E}`), (m) => {
      let h = Number(m[1]);
      // Working hours: "בשעה 3" means 15:00.
      if ((m[2] && m[2] !== 'בבוקר' && h < 12) || (!m[2] && h < 8)) h += 12;
      time = roundToSlot(h, 0);
    }) ||
    take(new RegExp(`${B}ב-?(\\d{1,2})\\s*(בבוקר|בצהריים|אחה"צ|אחר הצהריים|בערב)${E}`), (m) => {
      let h = Number(m[1]);
      if (m[2] !== 'בבוקר' && h < 12) h += 12;
      time = roundToSlot(h, 0);
    });

  // ----- dates -----
  const t = toISODate(now);
  take(new RegExp(`${B}מחרתיים${E}`), () => (date = toISODate(addDays(now, 2)))) ||
    take(new RegExp(`${B}(?:עד\\s*)?מחר${E}`), () => (date = toISODate(addDays(now, 1)))) ||
    take(new RegExp(`${B}(?:עד\\s*)?היום${E}`), () => (date = t)) ||
    take(new RegExp(`${B}בעוד\\s+יומיים${E}`), () => (date = toISODate(addDays(now, 2)))) ||
    take(new RegExp(`${B}בעוד\\s+שבוע${E}`), () => (date = toISODate(addDays(now, 7)))) ||
    take(new RegExp(`${B}בעוד\\s+(\\d{1,2})\\s+ימים${E}`), (m) => (date = toISODate(addDays(now, Number(m[1]))))) ||
    take(new RegExp(`${B}(?:ב|עד\\s*)?שבוע\\s+הבא${E}`), () => (date = nextWeekday(0, now))) ||
    take(
      new RegExp(`${B}(?:עד\\s*|ב)?(?:יום\\s+)(ראשון|שני|שלישי|רביעי|חמישי|שישי|[אבגדהו]['׳])(?:\\s+הקרוב)?${E}`),
      (m) => (date = nextWeekday(weekdayIndex(m[1]), now)),
    ) ||
    take(
      new RegExp(`${B}(?:עד\\s*|ב)?(ראשון|שני|שלישי|רביעי|חמישי|שישי)\\s+הקרוב${E}`),
      (m) => (date = nextWeekday(weekdayIndex(m[1]), now)),
    ) ||
    // dd/mm[/yy] anywhere; dd.mm only after ב/עד/ל so "תגי 2.9" stays a product size.
    take(
      new RegExp(
        `${B}(?:(?:ב|עד|ל)-?\\s*)?(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?${E}|${B}(?:ב|עד|ל)-?\\s*(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{2,4}))?${E}`,
      ),
      (m) => {
        const day = Number(m[1] ?? m[4]);
        const month = Number(m[2] ?? m[5]);
        const yearRaw = m[3] ?? m[6];
        if (day < 1 || day > 31 || month < 1 || month > 12) return;
        let year = yearRaw ? Number(yearRaw.length === 2 ? `20${yearRaw}` : yearRaw) : now.getFullYear();
        let d = new Date(year, month - 1, day);
        if (!yearRaw && toISODate(d) < t) d = new Date(++year, month - 1, day);
        date = toISODate(d);
      },
    );

  return { date, time, rest };
}

function tidy(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^[\s,.;:\-–]+|[\s,;:\-–]+$/g, '')
    .trim();
}

export function parseQuickInput(raw: string, data: AppData, now: Date = new Date()): ParsedInput {
  let text = raw.trim().replace(WHATSAPP_HEADER_RE, '');
  const isTopic = MEETING_PREFIX_RE.test(text);
  if (isTopic) text = text.replace(MEETING_PREFIX_RE, '');

  // ----- new project: "פרויקט חדש: <name>" (up to a comma/period) -----
  let newProjectName: string | null = null;
  const np = /פרויקט\s+חדש\s*[:\-–]?\s*([^,.;\n]+)/.exec(text);
  if (np) newProjectName = np[1].trim();

  const { date, time, rest } = extractDateTime(text, now);
  const lower = rest.toLowerCase();

  // ----- project (an existing project name implies its client) -----
  const openProjects = data.projects.filter((p) => !p.closed);
  const projectMatch = bestMatch(
    lower,
    openProjects.map((p) => {
      const stripped = p.name.replace(/^\s*פרויקט\s+/, '').trim();
      return { id: p.id, keywords: [...new Set([p.name, stripped].map((k) => k.toLowerCase()))] };
    }),
  );
  let projectId = projectMatch?.id ?? null;

  // ----- client -----
  let clientId: string | null = null;
  if (projectId) {
    clientId = openProjects.find((p) => p.id === projectId)!.clientId;
  } else {
    const clientMatch = bestMatch(
      lower,
      data.clients.map((c) => ({ id: c.id, keywords: nameKeywords(c.name) })),
    );
    clientId = clientMatch?.id ?? null;
  }

  // "...לפרויקט" with a known client that has exactly one open project → that project.
  if (!projectId && clientId && !newProjectName && /פרויקט/.test(rest)) {
    const own = openProjects.filter((p) => p.clientId === clientId);
    if (own.length === 1) projectId = own[0].id;
  }

  // ----- person the item is stuck with -----
  let personId: string | null = null;
  let personIndex = Infinity;
  for (const person of data.people) {
    const keywords = nameKeywords(person.name);
    if (person.id === data.settings.meId) keywords.push('אצלי');
    for (const k of keywords) {
      const idx = GENERIC_PEOPLE.has(k)
        ? (() => {
            const m = new RegExp(`אצל\\s+ה?${escapeRe(k)}(?=$|[${BOUNDARY}])`).exec(lower);
            return m ? m.index : -1;
          })()
        : findWord(lower, k);
      if (idx >= 0 && idx < personIndex) {
        personIndex = idx;
        personId = person.id;
      }
    }
  }

  // An explicit "תקוע אצל מתן" clause is fully captured by the field, so drop it from the text.
  let cleaned = rest;
  if (personId) {
    const person = data.people.find((p) => p.id === personId)!;
    for (const k of nameKeywords(person.name)) {
      cleaned = cleaned.replace(
        new RegExp(`[,;]?\\s*(?:(?:ה?משימה\\s+)?(?:תקוע(?:ה)?|נמצא(?:ת)?)\\s+)?אצל\\s+ה?${escapeRe(k)}(?=$|[${BOUNDARY}])`, 'i'),
        ' ',
      );
    }
  }

  // Only a time was said ("ב-10:00 להתקשר"): the reminder is today, or tomorrow if that time has passed.
  let reminderDate: string | null = null;
  if (time) {
    if (date) {
      reminderDate = date;
    } else {
      const [h, m] = (time as string).split(':').map(Number);
      const passed = now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
      reminderDate = toISODate(passed ? addDays(now, 1) : now);
    }
  }

  return {
    kind: isTopic ? 'topic' : 'task',
    text: tidy(cleaned) || tidy(rest) || tidy(text),
    clientId,
    projectId,
    newProjectName: newProjectName && clientId && !projectId ? newProjectName : null,
    personId,
    dueDate: isTopic ? null : (date ?? reminderDate),
    reminderDate,
    reminderTime: time,
    meetingDate: isTopic ? upcomingSunday(now) : null,
  };
}
