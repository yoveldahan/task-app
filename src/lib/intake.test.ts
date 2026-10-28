import { describe, expect, it } from 'vitest';
import { intake, parseDateInput, parseTimeInput } from './intake';
import { composePrefillText, readUrlIntake } from './urlIntake';
import { createSeedData } from './seed';

const NOW = new Date(2026, 9, 28, 11, 15); // Wed 28.10.2026 11:15
const data = createSeedData();
const clientId = (n: string) => data.clients.find((c) => c.name === n)!.id;

describe('intake', () => {
  it('explicit fields override parsed text', () => {
    const r = intake(
      { text: 'להתקשר בנושא משלוח', client: 'סופר יודה', due: '2026-11-05', reminderTime: '10:15', stuckWith: 'מתן', stuckReason: 'ממתין למחסן' },
      data,
      NOW,
    );
    expect(r.kind).toBe('task');
    expect(r.task).toMatchObject({
      description: 'להתקשר בנושא משלוח',
      clientId: clientId('פז (Yellow / סופר יודה)'),
      dueDate: '2026-11-05',
      reminderDate: '2026-11-05',
      reminderTime: '10:00',
      stuckWithId: 'matan',
      stuckReason: 'ממתין למחסן',
    });
    expect(r.warnings).toEqual([]);
  });

  it('unknown client is kept in the text with a warning', () => {
    const r = intake({ text: 'הצעת מחיר', client: 'שופרסל' }, data, NOW);
    expect(r.task!.clientId).toBeNull();
    expect(r.task!.description).toBe('הצעת מחיר (לקוח: שופרסל)');
    expect(r.warnings[0]).toContain('שופרסל');
  });

  it('type=topic routes to a meeting topic for the upcoming Sunday', () => {
    const r = intake({ text: 'זמני אספקה', type: 'topic', client: 'אושר עד', stuckWith: 'מתן' }, data, NOW);
    expect(r.kind).toBe('topic');
    expect(r.topic).toMatchObject({ topic: 'זמני אספקה', meetingDate: '2026-11-01', withWhomId: 'matan', clientId: clientId('אושר עד') });
  });

  it('explicit project: existing match, or a new project for the client', () => {
    const existing = intake({ text: 'מיפוי', client: 'אושר עד', project: 'שדרוג 3 סניפי מרכז' }, data, NOW);
    expect(existing.newProject).toBeNull();
    expect(existing.task!.projectId).toBe(data.projects[0].id);
    const created = intake({ text: 'מיפוי', client: 'נוי השדה', project: 'הרחבת תגים' }, data, NOW);
    expect(created.newProject).toMatchObject({ name: 'הרחבת תגים', clientId: clientId('נוי השדה') });
    expect(created.task!.projectId).toBe(created.newProject!.id);
  });

  it('reminder date alone defaults to 09:00', () => {
    expect(intake({ text: 'x', reminderDate: 'מחר' }, data, NOW).task).toMatchObject({ reminderDate: '2026-10-29', reminderTime: '09:00' });
  });

  it('date/time input formats', () => {
    expect(parseDateInput('2026-12-01', NOW)).toBe('2026-12-01');
    expect(parseDateInput('5/11', NOW)).toBe('2026-11-05');
    expect(parseDateInput('5.11', NOW)).toBe('2026-11-05');
    expect(parseDateInput('יום ראשון', NOW)).toBe('2026-11-01');
    expect(parseDateInput('בלה', NOW)).toBeNull();
    expect(parseTimeInput('9')).toBe('09:00');
    expect(parseTimeInput('16:40')).toBe('16:30');
    expect(parseTimeInput('25:00')).toBeNull();
  });
});

describe('URL intake', () => {
  it('reads structured params', () => {
    const r = readUrlIntake(new URLSearchParams('task=להתקשר&client=פז&due=2026-11-05&time=10:00&who=מתן&reason=x'))!;
    expect(r.prefill).toBe(false);
    expect(r.input).toEqual({ text: 'להתקשר', type: undefined, client: 'פז', due: '2026-11-05', reminderTime: '10:00', stuckWith: 'מתן', stuckReason: 'x' });
  });

  it('topic param and prefill flag', () => {
    const r = readUrlIntake(new URLSearchParams('topic=זמני אספקה&prefill=1'))!;
    expect(r.input.type).toBe('topic');
    expect(r.prefill).toBe(true);
  });

  it('no text → null', () => {
    expect(readUrlIntake(new URLSearchParams('client=פז'))).toBeNull();
  });

  it('prefill text round-trips through the parser', () => {
    const text = composePrefillText({ text: 'להתקשר', client: 'אושר עד', stuckWith: 'מתן', due: '2026-11-05', reminderTime: '10:00' });
    const r = intake({ text }, data, NOW);
    expect(r.task).toMatchObject({ clientId: clientId('אושר עד'), stuckWithId: 'matan', dueDate: '2026-11-05', reminderTime: '10:00' });
    expect(r.task!.description).toBe('להתקשר אושר עד');
  });
});
