import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { quickAddInput } from './lib/quickAdd';
import { URL_INTAKE_KEYS, composePrefillText, readUrlIntake, setPrefill } from './lib/urlIntake';
import { registerServiceWorker } from './lib/reminders';
import { initSync } from './lib/sync';
import './styles.css';

/**
 * Incoming links (?task=…&client=…, ?topic=…, ?quickAdd=…, Android share) add an item on load,
 * or with &prefill=1 fill the quick-capture box. Handled once here, outside React, then stripped
 * from the URL so a refresh doesn't add it again.
 */
function handleUrlIntake() {
  const url = new URL(window.location.href);
  const req = readUrlIntake(url.searchParams);
  if (!req) return;
  URL_INTAKE_KEYS.forEach((k) => url.searchParams.delete(k));
  if (req.prefill) {
    setPrefill(composePrefillText(req.input));
  } else {
    const added = quickAddInput(req.input);
    if (added && !url.hash) url.hash = added === 'topic' ? '#meeting' : '#tasks';
  }
  window.history.replaceState(null, '', url.toString());
}

initSync();
handleUrlIntake();
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
