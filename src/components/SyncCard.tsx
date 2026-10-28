import { useState } from 'react';
import { PRE_SYNC_BACKUP_KEY, signIn, signOut, signUp, syncNow, useSyncInfo, type SyncStatus } from '../lib/sync';
import { exportJson } from '../lib/exporters';
import { showToast } from '../lib/toast';
import type { AppData } from '../lib/types';

export const STATUS_LABEL: Record<SyncStatus, string> = {
  'signed-out': 'לא מחובר לענן',
  syncing: 'מסנכרן…',
  synced: 'מסונכרן',
  offline: 'אין חיבור – השינויים יסונכרנו כשהחיבור יחזור',
  error: 'שגיאת סנכרון',
};

export const STATUS_ICON: Record<SyncStatus, string> = {
  'signed-out': '☁️',
  syncing: '🔄',
  synced: '✅',
  offline: '📴',
  error: '⚠️',
};

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Small cloud status pill for the header; links to the sync settings. */
export function SyncBadge() {
  const s = useSyncInfo();
  return (
    <a href="#settings" className={`sync-badge sync-${s.status}`} title={s.error ?? STATUS_LABEL[s.status]}>
      <span>{STATUS_ICON[s.status]}</span>
      <span className="sync-badge-text">
        {s.status === 'signed-out' ? 'מקומי' : s.status === 'synced' ? 'מסונכרן' : s.status === 'offline' ? 'לא מקוון' : s.status === 'error' ? 'שגיאה' : 'מסנכרן'}
      </span>
      {s.pending > 0 && s.status !== 'signed-out' && <span className="sync-pending">{s.pending}</span>}
    </a>
  );
}

function PreSyncBackup() {
  const raw = localStorage.getItem(PRE_SYNC_BACKUP_KEY);
  if (!raw) return null;
  let backup: { savedAt: string; data: AppData };
  try {
    backup = JSON.parse(raw);
  } catch {
    return null;
  }
  return (
    <p className="muted">
      לפני הטעינה מהענן נשמר גיבוי של הנתונים שהיו במכשיר הזה ({new Date(backup.savedAt).toLocaleString('he-IL')}).{' '}
      <button type="button" className="link-btn" onClick={() => exportJson(backup.data)}>
        הורד גיבוי
      </button>
    </p>
  );
}

export function SyncCard() {
  const s = useSyncInfo();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (s.status !== 'signed-out' || s.email) {
    return (
      <section className="card settings-card sync-card">
        <h2>☁️ סנכרון ענן (Supabase)</h2>
        <div className={`sync-status sync-${s.status}`}>
          <span>{STATUS_ICON[s.status]}</span>
          <span>{STATUS_LABEL[s.status]}</span>
          {s.lastSyncAt && <span className="muted">· עודכן {formatTime(s.lastSyncAt)}</span>}
          {s.pending > 0 && <span className="muted">· {s.pending} שינויים ממתינים</span>}
        </div>
        {s.error && <p className="sync-error">{s.error}</p>}
        <p className="muted">
          מחובר כ-<b dir="ltr">{s.email}</b>. כל שינוי נשמר מיד במכשיר ומסונכרן ברקע לכל המכשירים המחוברים לאותו חשבון.
        </p>
        {s.userId && (
          <p className="muted">
            מזהה משתמש (ל-Webhook): <code>{s.userId}</code>{' '}
            <button
              type="button"
              className="link-btn"
              onClick={() => navigator.clipboard.writeText(s.userId!).then(() => showToast('הועתק', { kind: 'success' }))}
            >
              העתק
            </button>
          </p>
        )}
        <PreSyncBackup />
        <div className="toolbar-row">
          <button
            type="button"
            className="btn btn-soft btn-sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await syncNow();
              setBusy(false);
            }}
          >
            🔄 סנכרן עכשיו
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              await signOut();
              showToast('התנתקת. הנתונים נשארו במכשיר.', { kind: 'info' });
            }}
          >
            התנתק
          </button>
        </div>
      </section>
    );
  }

  const submit = async (mode: 'in' | 'up') => {
    if (!email.trim() || !password) {
      setMessage('יש להזין אימייל וסיסמה');
      return;
    }
    setBusy(true);
    setMessage(null);
    if (mode === 'in') {
      const error = await signIn(email.trim(), password);
      if (error) setMessage(error);
    } else {
      const { error, needsConfirm } = await signUp(email.trim(), password);
      if (error) setMessage(error);
      else if (needsConfirm) setMessage('נשלח אליך אימייל לאישור החשבון. לחץ על הקישור ואז התחבר כאן.');
    }
    setBusy(false);
  };

  return (
    <section className="card settings-card sync-card">
      <h2>☁️ סנכרון ענן (Supabase)</h2>
      <p className="muted">
        התחבר כדי לסנכרן את כל הנתונים בזמן אמת בין הנייד למחשב. התחבר <b>קודם במכשיר שיש בו את הנתונים העדכניים</b> – הם
        יועלו לענן, ובמכשירים הבאים הנתונים ייטענו מהענן (עם גיבוי אוטומטי של מה שהיה בהם).
      </p>
      <form
        className="sync-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit('in');
        }}
      >
        <input
          className="input"
          type="email"
          dir="ltr"
          autoComplete="email"
          placeholder="אימייל"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="input"
          type="password"
          dir="ltr"
          autoComplete="current-password"
          placeholder="סיסמה"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="toolbar-row">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            התחבר
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void submit('up')}>
            הרשמה (פעם ראשונה)
          </button>
        </div>
      </form>
      {message && <p className="sync-error">{message}</p>}
    </section>
  );
}
