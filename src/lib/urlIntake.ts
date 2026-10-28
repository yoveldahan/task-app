import type { IntakeInput } from './intake';

/**
 * Incoming links (phone shortcuts, Gemini, WhatsApp automations, Android share):
 *
 *   ?task=להתקשר לפז&client=פז&due=2026-11-05&time=10:00&who=מתן&reason=...
 *   ?topic=זמני אספקה&client=אושר עד          → meeting topic
 *   ?quickAdd=<free text>                       → parsed like the quick-capture bar
 *   &prefill=1                                  → fill the quick-capture box instead of saving
 */
const TEXT_KEYS = ['task', 'text', 'quickAdd', 'shareTitle', 'shareUrl'];
const FIELD_KEYS: Record<string, keyof IntakeInput> = {
  client: 'client',
  project: 'project',
  due: 'due',
  reminder: 'reminderDate',
  reminderDate: 'reminderDate',
  time: 'reminderTime',
  reminderTime: 'reminderTime',
  who: 'stuckWith',
  stuckWith: 'stuckWith',
  reason: 'stuckReason',
  stuckReason: 'stuckReason',
};
export const URL_INTAKE_KEYS = [...TEXT_KEYS, 'topic', 'prefill', ...Object.keys(FIELD_KEYS)];

export function readUrlIntake(params: URLSearchParams): { input: IntakeInput; prefill: boolean } | null {
  const topic = params.get('topic')?.trim();
  const texts = TEXT_KEYS.map((k) => params.get(k)?.trim()).filter((v): v is string => !!v);
  const text = [...new Set(topic ? [topic, ...texts] : texts)].join(' ');
  if (!text) return null;

  const input: IntakeInput = { text, type: topic ? 'topic' : undefined };
  for (const [param, field] of Object.entries(FIELD_KEYS)) {
    const v = params.get(param)?.trim();
    if (v) (input as unknown as Record<string, string>)[field] = v;
  }
  const prefill = ['1', 'true', 'yes'].includes(params.get('prefill') ?? '');
  return { input, prefill };
}

/** Text for the quick-capture box when prefilling: structured fields are spelled out so the parser picks them up again. */
export function composePrefillText(input: IntakeInput): string {
  const parts = [input.type === 'topic' && !input.text.startsWith('נושא לישיבה') ? `נושא לישיבה: ${input.text}` : input.text];
  if (input.client && !input.text.includes(input.client)) parts.push(input.client);
  if (input.project) parts.push(`פרויקט ${input.project}`);
  if (input.stuckWith) parts.push(`תקוע אצל ${input.stuckWith}`);
  if (input.due) {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.due);
    parts.push(`עד ${iso ? `${Number(iso[3])}/${Number(iso[2])}/${iso[1]}` : input.due}`);
  }
  if (input.reminderTime) parts.push(`ב-${input.reminderTime}`);
  if (input.stuckReason) parts.push(`– ${input.stuckReason}`);
  return parts.join(' ');
}

let pendingPrefill: string | null = null;

export function setPrefill(text: string) {
  pendingPrefill = text;
}

/** Read once by the quick-capture bar on mount. */
export function takePrefill(): string | null {
  const t = pendingPrefill;
  pendingPrefill = null;
  return t;
}
