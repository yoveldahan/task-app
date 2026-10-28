import { useState } from 'react';
import type { ClientCategory } from '../lib/types';
import { CATEGORIES, CATEGORY_LABELS, MEETING_PREFIX } from '../lib/constants';
import {
  addClient,
  addPerson,
  deleteClient,
  deletePerson,
  movePerson,
  renamePerson,
  replaceState,
  resetToSeed,
  update,
  updateClient,
  useData,
} from '../lib/store';
import { askConfirm } from '../lib/dialog';
import { showToast } from '../lib/toast';
import { exportClientsCsv, exportJson, exportTasksCsv, exportTopicsCsv, isValidBackup } from '../lib/exporters';
import { notificationsSupported, requestNotificationPermission } from '../lib/reminders';
import { postWebhook } from '../lib/storage';
import { SyncCard } from '../components/SyncCard';

function appBaseUrl(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

export function SettingsView() {
  const data = useData();
  const [newClient, setNewClient] = useState('');
  const [newCategory, setNewCategory] = useState<ClientCategory>('lead');
  const [newPerson, setNewPerson] = useState('');
  const [permission, setPermission] = useState(notificationsSupported() ? Notification.permission : 'unsupported');

  const taskLinkExample = `${appBaseUrl()}?${new URLSearchParams({ task: 'להתקשר בנושא משלוח', client: 'פז', due: 'מחר', time: '10:00', who: 'מתן' })}`;
  const meetingExample = `${appBaseUrl()}?quickAdd=${encodeURIComponent(`${MEETING_PREFIX} זמני אספקה של מתאמים`)}`;
  const webhookEndpoint = `${window.location.origin}/api/tasks`;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('הועתק ללוח', { kind: 'success' });
    } catch {
      showToast('לא ניתן להעתיק', { kind: 'error' });
    }
  };

  return (
    <div className="view settings">
      <SyncCard />

      {/* ---------- Clients ---------- */}
      <section className="card settings-card">
        <h2>לקוחות</h2>
        <form
          className="settings-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newClient.trim()) return;
            addClient(newClient.trim(), newCategory);
            setNewClient('');
            showToast('הלקוח נוסף', { kind: 'success' });
          }}
        >
          <input className="input" placeholder="שם לקוח חדש" value={newClient} onChange={(e) => setNewClient(e.target.value)} />
          <select className="select" value={newCategory} onChange={(e) => setNewCategory(e.target.value as ClientCategory)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary">
            הוסף
          </button>
        </form>
        <div className="settings-list">
          {data.clients.map((c) => {
            const taskCount = data.tasks.filter((t) => t.clientId === c.id).length;
            const projectCount = data.projects.filter((p) => p.clientId === c.id).length;
            return (
              <div key={c.id} className="settings-row">
                <input
                  className="input"
                  value={c.name}
                  aria-label="שם הלקוח"
                  onChange={(e) => updateClient(c.id, { name: e.target.value })}
                />
                <select
                  className="select"
                  value={c.category}
                  aria-label="קטגוריה"
                  onChange={(e) => updateClient(c.id, { category: e.target.value as ClientCategory })}
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {CATEGORY_LABELS[cat]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="icon-btn danger"
                  title="מחק לקוח"
                  onClick={async () => {
                    const ok = await askConfirm(
                      `למחוק את "${c.name}"?`,
                      `יימחקו גם ${taskCount} משימות ו-${projectCount} פרויקטים של הלקוח. נושאים לישיבה יועברו ל"כללי".`,
                    );
                    if (ok) deleteClient(c.id);
                  }}
                >
                  🗑
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---------- People ---------- */}
      <section className="card settings-card">
        <h2>רשימת "אצל מי זה תקוע"</h2>
        <form
          className="settings-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newPerson.trim()) return;
            addPerson(newPerson.trim());
            setNewPerson('');
          }}
        >
          <input className="input" placeholder="שם / בעל תפקיד חדש" value={newPerson} onChange={(e) => setNewPerson(e.target.value)} />
          <button type="submit" className="btn btn-primary">
            הוסף
          </button>
        </form>
        <div className="settings-list">
          {data.people.map((p, i) => (
            <div key={p.id} className="settings-row">
              <input
                className="input"
                value={p.name}
                aria-label="שם"
                onChange={(e) => renamePerson(p.id, e.target.value)}
              />
              <button type="button" className="icon-btn" disabled={i === 0} onClick={() => movePerson(p.id, -1)} title="הזז למעלה">
                ▲
              </button>
              <button
                type="button"
                className="icon-btn"
                disabled={i === data.people.length - 1}
                onClick={() => movePerson(p.id, 1)}
                title="הזז למטה"
              >
                ▼
              </button>
              {p.id === data.settings.meId ? (
                <span className="me-tag">אני</span>
              ) : (
                <button
                  type="button"
                  className="icon-btn danger"
                  title="מחק"
                  onClick={async () => {
                    if (await askConfirm(`להסיר את "${p.name}"?`, 'משימות שתקועות אצלו יועברו אליך.', 'הסר')) {
                      deletePerson(p.id);
                    }
                  }}
                >
                  🗑
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Notifications ---------- */}
      <section className="card settings-card">
        <h2>התראות ותזכורות</h2>
        <p className="muted">
          התזכורות קופצות כהתראה בדפדפן/בטלפון וכבאנר בתוך האפליקציה כשהאפליקציה פתוחה (גם בלשונית ברקע). כדי לקבל
          תזכורת גם כשהאפליקציה סגורה, השתמש בכפתורי 📅 Google / 📲 יומן שליד כל תזכורת, או בחיבור Webhook למטה.
        </p>
        <div className="toolbar-row">
          <span className={`perm perm-${permission}`}>
            {permission === 'granted'
              ? '✓ התראות מאושרות'
              : permission === 'denied'
                ? '✕ התראות חסומות – יש לאשר בהגדרות הדפדפן'
                : permission === 'unsupported'
                  ? 'הדפדפן לא תומך בהתראות'
                  : 'התראות טרם אושרו'}
          </span>
          {permission === 'default' && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={async () => setPermission(await requestNotificationPermission())}
            >
              אפשר התראות
            </button>
          )}
        </div>
      </section>

      {/* ---------- Shortcuts ---------- */}
      <section className="card settings-card">
        <h2>הזנה מבחוץ: קישורים, Gemini ו-Webhook</h2>
        <p className="muted">
          <b>קישור</b> שנפתח בדפדפן מוסיף משימה מיד (או ממלא את תיבת ההזנה עם <code>prefill=1</code>). פרמטרים:{' '}
          <code>task</code> / <code>topic</code> / <code>quickAdd</code>, ו-<code>client</code>, <code>project</code>,{' '}
          <code>due</code>, <code>time</code>, <code>who</code>, <code>reason</code>.
        </p>
        <div className="code-row">
          <code className="code">{taskLinkExample}</code>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(taskLinkExample)}>
            העתק
          </button>
        </div>
        <div className="code-row">
          <code className="code">{meetingExample}</code>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(meetingExample)}>
            העתק
          </button>
        </div>
        <p className="muted">
          <b>Webhook</b> לאוטומציות (Make / Zapier / וואטסאפ / Shortcuts): בקשת <code>POST</code> אל{' '}
          <code>{webhookEndpoint}</code> עם הכותרת <code>Authorization: Bearer &lt;WEBHOOK_TOKEN&gt;</code> וגוף JSON כמו{' '}
          <code>{'{"text":"להתקשר לפז מחר ב-10:00","who":"מתן"}'}</code>. המשימה נשמרת בענן ומופיעה מיד בכל המכשירים
          המחוברים.
        </p>
        <p className="muted">
          קישורים ישירים למסכים: <code>#clients</code> · <code>#tasks</code> · <code>#meeting</code> · <code>#settings</code>
        </p>
      </section>

      {/* ---------- Cloud / webhook ---------- */}
      <section className="card settings-card">
        <h2>סנכרון ענן ואוטומציה (Webhook)</h2>
        <p className="muted">
          כתובת Webhook של Make / Zapier / Google Apps Script. המערכת שולחת אליה POST בפורמט JSON:{' '}
          <code>{'{ event: "reminder-set", reminder }'}</code> בכל קביעת תזכורת (למשל ליצירת משימה ב-Google Tasks), ו-
          <code>{'{ event: "data-sync", data }'}</code> לגיבוי כל הנתונים (למשל ל-Google Sheets).
        </p>
        <input
          className="input"
          dir="ltr"
          type="url"
          placeholder="https://hook.eu1.make.com/…"
          value={data.settings.webhookUrl}
          onChange={(e) => update((d) => void (d.settings.webhookUrl = e.target.value.trim()))}
        />
        <label className="switch">
          <input
            type="checkbox"
            checked={data.settings.webhookSendReminders}
            onChange={(e) => update((d) => void (d.settings.webhookSendReminders = e.target.checked))}
          />
          <span>שלח כל תזכורת חדשה ל-Webhook (Google Tasks / יומן)</span>
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={data.settings.webhookSyncData}
            onChange={(e) => update((d) => void (d.settings.webhookSyncData = e.target.checked))}
          />
          <span>סנכרן את כל הנתונים אחרי כל שינוי (גיבוי ענן)</span>
        </label>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={!data.settings.webhookUrl}
          onClick={async () => {
            const ok = await postWebhook(data.settings.webhookUrl, { event: 'test', sentAt: new Date().toISOString() });
            showToast(ok ? 'נשלחה בקשת בדיקה' : 'השליחה נכשלה – בדוק את הכתובת', { kind: ok ? 'success' : 'error' });
          }}
        >
          שלח בדיקה
        </button>
      </section>

      {/* ---------- Backup ---------- */}
      <section className="card settings-card">
        <h2>גיבוי, ייצוא וייבוא</h2>
        <p className="muted">
          הנתונים נשמרים אוטומטית במכשיר (וגם בענן כשמחוברים). גיבוי JSON הוא עותק מלא שאפשר לשמור בצד; ייבוא שלו כשמחוברים
          לענן מחליף את הנתונים גם בענן ובכל המכשירים.
        </p>
        <div className="button-grid">
          <button type="button" className="btn btn-soft" onClick={() => exportJson(data)}>
            ⬇ גיבוי מלא (JSON)
          </button>
          <button type="button" className="btn btn-soft" onClick={() => exportTasksCsv(data)}>
            ⬇ משימות ל-Excel (CSV)
          </button>
          <button type="button" className="btn btn-soft" onClick={() => exportTopicsCsv(data)}>
            ⬇ נושאים לישיבה (CSV)
          </button>
          <button type="button" className="btn btn-soft" onClick={() => exportClientsCsv(data)}>
            ⬇ לקוחות וסטטוסים (CSV)
          </button>
          <label className="btn btn-soft file-btn">
            ⬆ ייבוא גיבוי (JSON)
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  const parsed = JSON.parse(await file.text());
                  if (!isValidBackup(parsed)) throw new Error('invalid');
                  if (await askConfirm('לייבא את הגיבוי?', 'כל הנתונים הנוכחיים במכשיר יוחלפו בנתוני הגיבוי.', 'ייבא')) {
                    replaceState(parsed);
                    showToast('הגיבוי יובא בהצלחה', { kind: 'success' });
                  }
                } catch {
                  showToast('קובץ גיבוי לא תקין', { kind: 'error' });
                }
              }}
            />
          </label>
          <button
            type="button"
            className="btn btn-danger-soft"
            onClick={async () => {
              if (await askConfirm('לאפס לנתוני הפתיחה?', 'כל השינויים שלך יימחקו. מומלץ לייצא גיבוי קודם.', 'אפס')) {
                resetToSeed();
                showToast('הנתונים אופסו', { kind: 'success' });
              }
            }}
          >
            ↺ איפוס לנתוני פתיחה
          </button>
        </div>
      </section>
    </div>
  );
}
