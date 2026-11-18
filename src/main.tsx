import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import { App } from './App';
import { applyPrefsToDocument, prefsStore, watchSystemTheme } from './lib/prefs';

applyPrefsToDocument();
watchSystemTheme();
const syncDigits = () => { document.documentElement.dataset.digits = prefsStore.get().digits; };
syncDigits();
prefsStore.subscribe(syncDigits);

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
