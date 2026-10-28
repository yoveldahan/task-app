import { useSyncExternalStore } from 'react';

export interface DialogRequest {
  kind: 'prompt' | 'confirm';
  title: string;
  message?: string;
  defaultValue?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (value: string | null) => void;
}

let current: DialogRequest | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function open(req: Omit<DialogRequest, 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => {
    current = {
      ...req,
      resolve: (v) => {
        current = null;
        emit();
        resolve(v);
      },
    };
    emit();
  });
}

/** Styled replacement for window.prompt; resolves to the trimmed text or null if cancelled/empty. */
export async function askText(title: string, defaultValue = '', message?: string): Promise<string | null> {
  const v = await open({ kind: 'prompt', title, defaultValue, message, confirmLabel: 'אישור' });
  return v?.trim() ? v.trim() : null;
}

export async function askConfirm(title: string, message?: string, confirmLabel = 'מחק'): Promise<boolean> {
  return (await open({ kind: 'confirm', title, message, confirmLabel, danger: true })) !== null;
}

export function useDialog(): DialogRequest | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
