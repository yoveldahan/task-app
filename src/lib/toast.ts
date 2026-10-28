import { useSyncExternalStore } from 'react';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'reminder' | 'error';
  action?: { label: string; onClick: () => void };
  /** ms; 0 = stays until dismissed (used for reminders). */
  duration: number;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showToast(message: string, opts: Partial<Omit<Toast, 'id' | 'message'>> = {}) {
  const toast: Toast = { id: nextId++, message, kind: 'info', duration: 4000, ...opts };
  toasts = [...toasts, toast];
  emit();
  if (toast.duration > 0) setTimeout(() => dismissToast(toast.id), toast.duration);
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
}
