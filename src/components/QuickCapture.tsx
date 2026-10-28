import { useEffect, useMemo, useRef, useState } from 'react';
import { parseQuickInput } from '../lib/parser';
import { describeParsed, quickAdd } from '../lib/quickAdd';
import { useData } from '../lib/store';
import { showToast } from '../lib/toast';
import { MEETING_PREFIX } from '../lib/constants';

// Minimal typing for the (prefixed) Web Speech API.
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function getRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
}

export function QuickCapture() {
  const data = useData();
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const baseRef = useRef('');
  const speechSupported = useMemo(() => !!getRecognition(), []);

  const preview = useMemo(() => {
    if (!text.trim()) return [];
    return describeParsed(parseQuickInput(text, data));
  }, [text, data]);

  useEffect(() => () => recRef.current?.stop(), []);

  const submit = () => {
    if (quickAdd(text)) setText('');
  };

  const toggleMic = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const Recognition = getRecognition();
    if (!Recognition) {
      showToast('הדפדפן לא תומך בהכתבה קולית. נסה ב-Chrome, או השתמש במקלדת הקולית של הטלפון.', { kind: 'error' });
      return;
    }
    const rec = new Recognition();
    rec.lang = 'he-IL';
    rec.interimResults = true;
    rec.continuous = false;
    baseRef.current = text ? `${text.trim()} ` : '';
    rec.onresult = (e) => {
      let transcript = '';
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      setText(baseRef.current + transcript);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed') showToast('אין הרשאה למיקרופון', { kind: 'error' });
      else if (e.error !== 'no-speech' && e.error !== 'aborted') showToast(`שגיאת הכתבה: ${e.error}`, { kind: 'error' });
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  return (
    <div className="quick-capture">
      <form
        className="qc-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          className="qc-input"
          rows={1}
          value={text}
          placeholder='משימה חדשה, או "נושא לישיבה: …"'
          aria-label="הזנה מהירה"
          enterKeyHint="send"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {speechSupported && (
          <button
            type="button"
            className={`qc-btn qc-mic ${listening ? 'is-listening' : ''}`}
            onClick={toggleMic}
            title="הכתבה קולית"
            aria-label="הכתבה קולית"
          >
            {listening ? '⏹' : '🎤'}
          </button>
        )}
        <button type="submit" className="qc-btn qc-add" aria-label="הוסף" disabled={!text.trim()}>
          ＋
        </button>
      </form>
      <div className="qc-hints">
        {preview.length ? (
          preview.map((p) => (
            <span key={p} className="qc-chip">
              {p}
            </span>
          ))
        ) : (
          <button type="button" className="qc-chip qc-chip-btn" onClick={() => setText(`${MEETING_PREFIX} `)}>
            🗓 {MEETING_PREFIX}
          </button>
        )}
        {listening && <span className="qc-chip qc-listening">● מקשיב…</span>}
      </div>
    </div>
  );
}
