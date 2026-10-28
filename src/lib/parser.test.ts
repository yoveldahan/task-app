import { describe, expect, it } from 'vitest';
import { parseQuickInput, nameKeywords } from './parser';
import { createSeedData } from './seed';
import { upcomingSunday, dueUrgency } from './dates';

// Wednesday 28.10.2026, 11:15
const NOW = new Date(2026, 9, 28, 11, 15);
const data = createSeedData();
const clientId = (name: string) => data.clients.find((c) => c.name === name)!.id;
const projectId = (name: string) => data.projects.find((p) => p.name === name)!.id;

describe('nameKeywords', () => {
  it('splits parenthetical aliases', () => {
    expect(nameKeywords('פז (Yellow / סופר יודה)')).toEqual(['פז (yellow / סופר יודה)', 'פז', 'yellow', 'סופר יודה']);
  });
});

describe('meeting topic routing', () => {
  it('routes "נושא לישיבה:" to topics for the upcoming Sunday', () => {
    const r = parseQuickInput('נושא לישיבה: זמני אספקה של מתאמים לאושר עד מול מתן', data, NOW);
    expect(r.kind).toBe('topic');
    expect(r.text).toBe('זמני אספקה של מתאמים לאושר עד מול מתן');
    expect(r.meetingDate).toBe('2026-11-01');
    expect(r.clientId).toBe(clientId('אושר עד'));
    expect(r.personId).toBe('matan');
  });

  it('accepts dictated prefix without colon', () => {
    expect(parseQuickInput('נושא לישיבה זמני אספקה', data, NOW).kind).toBe('topic');
  });

  it('regular text is a task', () => {
    expect(parseQuickInput('להתקשר לפז', data, NOW).kind).toBe('task');
  });
});

describe('client / project / person detection', () => {
  it('detects client with Hebrew prefix letter', () => {
    expect(parseQuickInput('לשלוח הצעת מחיר לרד מרקט', data, NOW).clientId).toBe(clientId('רד מרקט (גני תקווה)'));
  });

  it('detects client by alias', () => {
    expect(parseQuickInput('לבדוק משלוח לסופר יודה', data, NOW).clientId).toBe(clientId('פז (Yellow / סופר יודה)'));
  });

  it('does not match a client name inside another word', () => {
    expect(parseQuickInput('לבדוק פזורה', data, NOW).clientId).toBeNull();
  });

  it('existing project name implies project and client', () => {
    const r = parseQuickInput('להזמין מסילות לשדרוג 3 סניפי מרכז', data, NOW);
    expect(r.projectId).toBe(projectId('פרויקט שדרוג 3 סניפי מרכז'));
    expect(r.clientId).toBe(clientId('אושר עד'));
  });

  it('"לפרויקט" with a client that has one open project', () => {
    expect(parseQuickInput('אושר עד לפרויקט: לתאם ביקור', data, NOW).projectId).toBe(
      projectId('פרויקט שדרוג 3 סניפי מרכז'),
    );
  });

  it('new project name', () => {
    const r = parseQuickInput('נוי השדה פרויקט חדש: הרחבת תגים לסניף רעננה, למפות מדפים', data, NOW);
    expect(r.clientId).toBe(clientId('נוי השדה'));
    expect(r.newProjectName).toBe('הרחבת תגים לסניף רעננה');
  });

  it('team member anywhere, earliest wins', () => {
    expect(parseQuickInput('לדבר עם איגל על אילנה לגבי לקוח מרכז', data, NOW).personId).toBe('igal');
  });

  it('removes an explicit "תקוע אצל" clause from the text', () => {
    const r = parseQuickInput('להתקשר לפז לגבי משלוח, תקוע אצל אילנה', data, NOW);
    expect(r.personId).toBe('ilana');
    expect(r.text).toBe('להתקשר לפז לגבי משלוח');
    expect(parseQuickInput('לדבר עם אילנה על משלוח', data, NOW).text).toBe('לדבר עם אילנה על משלוח');
  });

  it('generic person only after "אצל"', () => {
    expect(parseQuickInput('לשלוח ללקוח קטלוג', data, NOW).personId).toBeNull();
    expect(parseQuickInput('תקוע אצל הלקוח', data, NOW).personId).toBe('client');
  });
});

describe('date and time phrases', () => {
  it('מחר ב-10:00 sets due date and reminder', () => {
    const r = parseQuickInput('להתקשר לפז מחר ב-10:00', data, NOW);
    expect(r.dueDate).toBe('2026-10-29');
    expect(r.reminderDate).toBe('2026-10-29');
    expect(r.reminderTime).toBe('10:00');
    expect(r.text).toBe('להתקשר לפז');
  });

  it('time only, already passed today → tomorrow', () => {
    const r = parseQuickInput('פולואפ בשעה 9', data, NOW);
    expect(r.reminderTime).toBe('09:00');
    expect(r.reminderDate).toBe('2026-10-29');
  });

  it('afternoon hour without qualifier', () => {
    const r = parseQuickInput('פולואפ בשעה 3', data, NOW);
    expect(r.reminderTime).toBe('15:00');
    expect(r.reminderDate).toBe('2026-10-28');
  });

  it('rounds to half-hour slot', () => {
    expect(parseQuickInput('משהו ב-14:45', data, NOW).reminderTime).toBe('14:30');
  });

  it('יום ראשון → next Sunday', () => {
    expect(parseQuickInput('לבדוק מלאי ביום ראשון', data, NOW).dueDate).toBe('2026-11-01');
    expect(parseQuickInput('לבדוק מלאי יום ה\'', data, NOW).dueDate).toBe('2026-10-29');
  });

  it('dd/mm date', () => {
    expect(parseQuickInput('הצעת מחיר עד 5/11', data, NOW).dueDate).toBe('2026-11-05');
  });

  it('product size like 2.9 is not a date', () => {
    const r = parseQuickInput('להזמין 700 תגי 2.9', data, NOW);
    expect(r.dueDate).toBeNull();
    expect(r.text).toBe('להזמין 700 תגי 2.9');
  });
});

describe('pasted WhatsApp message', () => {
  it('strips the sender/time header', () => {
    const r = parseQuickInput('[10:15, 28.10.2026] מתן: המתאמים לאושר עד יגיעו רק בשבוע הבא', data, NOW);
    expect(r.reminderTime).toBeNull();
    expect(r.text).toBe('המתאמים לאושר עד יגיעו רק');
    expect(r.dueDate).toBe('2026-11-01');
    expect(r.clientId).toBe(clientId('אושר עד'));
  });
});

describe('dates helpers', () => {
  it('upcomingSunday returns today on Sunday', () => {
    expect(upcomingSunday(new Date(2026, 10, 1, 9))).toBe('2026-11-01');
    expect(upcomingSunday(NOW)).toBe('2026-11-01');
  });

  it('urgency levels', () => {
    expect(dueUrgency('2026-10-27', false, NOW)).toBe('overdue');
    expect(dueUrgency('2026-10-28', false, NOW)).toBe('today');
    expect(dueUrgency('2026-10-30', false, NOW)).toBe('soon');
    expect(dueUrgency('2026-11-10', false, NOW)).toBe('future');
    expect(dueUrgency('2026-10-20', true, NOW)).toBe('done');
  });
});
