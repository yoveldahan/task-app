import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as StoreModule from './store';

type Store = typeof StoreModule;

let store: Store;

beforeAll(async () => {
  // The store persists to localStorage; node has none, so give it a minimal in-memory one.
  const memory = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  });
  store = await import('./store');
});

describe('meeting summaries archive', () => {
  const date = '2026-11-08';

  it('edits the open summary and archives it when sent', () => {
    store.setMeetingSummary(date, 'טיוטה');
    store.setMeetingSummary(date, 'סיכום סופי');
    const open = store.getState().summaries.filter((s) => s.meetingDate === date);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ summary: 'סיכום סופי', archived: false });

    store.archiveMeetingSummary(date);
    const archived = store.getState().summaries.filter((s) => s.meetingDate === date);
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({ summary: 'סיכום סופי', archived: true });
  });

  it('starts a fresh open summary for the same meeting after archiving', () => {
    store.setMeetingSummary(date, 'הערה נוספת');
    const rows = store.getState().summaries.filter((s) => s.meetingDate === date);
    expect(rows.map((s) => [s.summary, s.archived])).toEqual([
      ['סיכום סופי', true],
      ['הערה נוספת', false],
    ]);
  });

  it('deletes an archived summary by id', () => {
    const archived = store.getState().summaries.find((s) => s.archived)!;
    store.deleteMeetingSummary(archived.id);
    expect(store.getState().summaries.some((s) => s.id === archived.id)).toBe(false);
    expect(store.getState().summaries.filter((s) => s.meetingDate === date)).toHaveLength(1);
  });
});
