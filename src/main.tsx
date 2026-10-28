import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { quickAdd } from './lib/quickAdd';
import { registerServiceWorker } from './lib/reminders';
import { initSync } from './lib/sync';
import './styles.css';

/**
 * ?quickAdd=<text> (phone shortcut / Gemini link / Android share target) adds an item on load.
 * Handled once here, outside React, and then stripped from the URL so a refresh doesn't add it again.
 */
function handleUrlQuickAdd() {
  const url = new URL(window.location.href);
  const parts = ['shareTitle', 'quickAdd', 'shareUrl'].map((k) => url.searchParams.get(k)?.trim()).filter(Boolean);
  if (!parts.length) return;
  const text = [...new Set(parts)].join(' ');
  const added = quickAdd(text);
  ['shareTitle', 'quickAdd', 'shareUrl'].forEach((k) => url.searchParams.delete(k));
  if (added && !url.hash) url.hash = added === 'topic' ? '#meeting' : '#tasks';
  window.history.replaceState(null, '', url.toString());
}

initSync();
handleUrlQuickAdd();
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
