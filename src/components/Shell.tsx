import { useEffect, useRef } from 'react';
import { dismissToast, useToasts } from '../lib/toast';
import { useDialog } from '../lib/dialog';

export function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'reminder' ? 'alert' : 'status'}>
          <span className="toast-msg">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                t.action!.onClick();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className="toast-close" aria-label="סגור" onClick={() => dismissToast(t.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

export function DialogHost() {
  const dialog = useDialog();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!dialog) return;
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dialog.resolve(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog]);

  if (!dialog) return null;
  return (
    <div className="dialog-backdrop" onClick={() => dialog.resolve(null)}>
      <form
        className="dialog card"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          dialog.resolve(dialog.kind === 'prompt' ? (inputRef.current?.value ?? '') : 'ok');
        }}
      >
        <h3 className="dialog-title">{dialog.title}</h3>
        {dialog.message && <p className="dialog-msg">{dialog.message}</p>}
        {dialog.kind === 'prompt' && <input ref={inputRef} className="input" defaultValue={dialog.defaultValue} />}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={() => dialog.resolve(null)}>
            ביטול
          </button>
          <button type="submit" className={`btn ${dialog.danger ? 'btn-danger' : 'btn-primary'}`} autoFocus={dialog.kind === 'confirm'}>
            {dialog.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
