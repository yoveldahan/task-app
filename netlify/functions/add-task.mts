/**
 * POST /api/tasks – adds a task or meeting topic to the owner's Supabase data
 * from external tools (Make / Zapier / WhatsApp automations, iOS Shortcuts...).
 *
 *   curl -X POST https://<site>/api/tasks \
 *     -H "Authorization: Bearer $WEBHOOK_TOKEN" -H "Content-Type: application/json" \
 *     -d '{"text":"להתקשר לפז מחר ב-10:00","who":"מתן"}'
 *
 * Body (JSON, form-encoded, or plain text = "text"):
 *   text | task | message   free text, parsed like the app's quick-capture bar (required)
 *   topic                   text of a meeting topic (instead of text)
 *   type                    "task" | "topic"
 *   client, project, due, reminderDate | reminder, reminderTime | time,
 *   stuckWith | who, stuckReason | reason       explicit fields, override the parsed text
 *   dryRun                  true → return what would be created without saving
 *
 * Environment (Netlify → Project configuration → Environment variables):
 *   WEBHOOK_TOKEN         shared secret callers must send
 *   SUPABASE_SECRET_KEY   Supabase secret key (server only – bypasses RLS)
 *   SUPABASE_USER_ID      the account the items belong to
 *   SUPABASE_URL          optional, defaults to the app's project
 */
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';
import { describeResult, intake, MAX_TEXT_LENGTH, type IntakeInput } from '../../src/lib/intake';
import { fromRow, settingsFromRow, toRow, type Row } from '../../src/lib/syncCore';
import type { AppData, Client, Person, Project } from '../../src/lib/types';

export const config = { path: '/api/tasks' };

const DEFAULT_SUPABASE_URL = 'https://yjwqntogxovdrygxgutu.supabase.co';
const MAX_BODY_BYTES = 16_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function tokensMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A Date whose local fields are the current wall-clock time in Israel, whatever the server's time zone. */
export function israelNow(at: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return new Date(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return null;
  const type = req.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  }
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  return { text: raw };
}

function str(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return undefined;
}

export function toIntakeInput(b: Record<string, unknown>): IntakeInput {
  const topic = str(b.topic)?.trim();
  const text = topic || str(b.text) || str(b.task) || str(b.message) || str(b.description) || '';
  const type = topic || str(b.type) === 'topic' ? 'topic' : undefined;
  return {
    text,
    type,
    client: str(b.client),
    project: str(b.project),
    due: str(b.due) ?? str(b.dueDate),
    reminderDate: str(b.reminderDate) ?? str(b.reminder),
    reminderTime: str(b.reminderTime) ?? str(b.time),
    stuckWith: str(b.stuckWith) ?? str(b.who),
    stuckReason: str(b.stuckReason) ?? str(b.reason),
  };
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return json(405, { error: 'Use POST with an Authorization: Bearer <token> header and a JSON body {"text": "..."}' });
  }

  const token = process.env.WEBHOOK_TOKEN ?? '';
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? '';
  const userId = process.env.SUPABASE_USER_ID ?? '';
  const missing = [!token && 'WEBHOOK_TOKEN', !secretKey && 'SUPABASE_SECRET_KEY', !userId && 'SUPABASE_USER_ID'].filter(Boolean);
  if (missing.length) return json(503, { error: 'Endpoint not configured', missing });

  let body: Record<string, unknown> | null;
  try {
    body = await readBody(req);
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }
  if (!body) return json(413, { error: 'Body too large' });

  const auth = req.headers.get('authorization') ?? '';
  const given = auth.replace(/^Bearer\s+/i, '') || req.headers.get('x-webhook-token') || str(body.token) || '';
  if (!given || !tokensMatch(given, token)) return json(401, { error: 'Unauthorized' });

  const input = toIntakeInput(body);
  if (!input.text.trim()) return json(400, { error: 'Missing "text" (or "task" / "topic")' });
  if (input.text.length > MAX_TEXT_LENGTH) return json(400, { error: `"text" is longer than ${MAX_TEXT_LENGTH} characters` });

  const supabase = createClient(process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const live = (table: string) => supabase.from(table).select('*').eq('user_id', userId).is('deleted_at', null);
    const [clients, projects, people, settings] = await Promise.all([
      live('clients'),
      live('projects'),
      live('people'),
      supabase.from('app_settings').select('*').eq('user_id', userId).maybeSingle(),
    ]);
    for (const r of [clients, projects, people, settings]) if (r.error) throw r.error;

    // The app loads cloud data over a device's local data on first sign-in; refusing here keeps a
    // webhook item from becoming the only thing in the cloud before the real data was uploaded.
    if (!people.data!.length && !clients.data!.length) {
      return json(409, { error: 'No synced data for this account yet. Sign in to the app first so your data is uploaded.' });
    }

    const data: AppData = {
      version: 1,
      clients: (clients.data as Row[]).map((r) => fromRow<Client>(r)),
      projects: (projects.data as Row[]).map((r) => fromRow<Project>(r)),
      people: (people.data as Row[])
        .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
        .map((r) => fromRow<Person>(r)),
      tasks: [],
      topics: [],
      settings: settings.data
        ? settingsFromRow(settings.data as Row)
        : { meId: 'me', webhookUrl: '', webhookSyncData: false, webhookSendReminders: false },
    };

    const result = intake(input, data, israelNow());
    // intake() stamps createdAt from the shifted Israel clock; use the real instant for ordering.
    const nowIso = new Date().toISOString();
    if (result.newProject) result.newProject.createdAt = nowIso;
    const item = result.task ?? result.topic!;
    item.createdAt = nowIso;
    const summary = describeResult(result, data).join(' · ');

    if (body.dryRun === true || body.dryRun === 'true' || body.dryRun === '1') {
      return json(200, { ok: true, dryRun: true, kind: result.kind, summary, warnings: result.warnings, item });
    }

    if (result.newProject) {
      const { error } = await supabase.from('projects').insert(toRow(result.newProject, userId, nowIso));
      if (error) throw error;
    }
    const table = result.task ? 'tasks' : 'meeting_topics';
    const { error } = await supabase.from(table).insert(toRow(item, userId, nowIso));
    if (error) throw error;

    return json(201, { ok: true, kind: result.kind, id: item.id, summary, warnings: result.warnings });
  } catch (e) {
    const message = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'Unknown error';
    console.error('add-task failed:', message);
    return json(500, { error: 'Failed to save', detail: message });
  }
};
