import { createStore, useStore } from './store';

export interface Prefs {
  theme: 'system' | 'light' | 'dark';
  fontScale: number;
  reduceMotion: boolean;
  reduceTransparency: boolean;
  digits: 'latn' | 'arab';
  soundEnabled: boolean;
  soundVolume: number;
  answerDetail: 'brief' | 'detailed';
  showSources: boolean;
  demoMode: boolean;
}

const KEY = 'salwa.prefs.v1';
const DEFAULTS: Prefs = {
  theme: 'system', fontScale: 1, reduceMotion: false, reduceTransparency: false, digits: 'latn',
  soundEnabled: false, soundVolume: 0.35, answerDetail: 'brief', showSources: true, demoMode: false,
};

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    const p = { ...DEFAULTS, ...raw };
    p.fontScale = Math.min(1.4, Math.max(0.9, Number(p.fontScale) || 1));
    p.soundVolume = Math.min(1, Math.max(0, Number(p.soundVolume)));
    return p;
  } catch {
    return DEFAULTS;
  }
}

export const prefsStore = createStore<Prefs>(typeof window === 'undefined' ? DEFAULTS : load());

export function setPrefs(patch: Partial<Prefs>) {
  prefsStore.set((p) => ({ ...p, ...patch }));
  try { localStorage.setItem(KEY, JSON.stringify(prefsStore.get())); } catch { /* storage unavailable */ }
  applyPrefsToDocument();
}

export function usePrefs<S>(select: (p: Prefs) => S): S {
  return useStore(prefsStore, select);
}

let mql: MediaQueryList | null = null;
export function applyPrefsToDocument() {
  const p = prefsStore.get();
  const d = document.documentElement;
  mql ??= matchMedia('(prefers-color-scheme: dark)');
  d.dataset.theme = p.theme === 'system' ? (mql.matches ? 'dark' : 'light') : p.theme;
  if (p.reduceTransparency) d.dataset.transparency = 'reduced'; else delete d.dataset.transparency;
  if (p.reduceMotion) d.dataset.motion = 'reduced'; else delete d.dataset.motion;
  d.style.setProperty('--font-scale', String(p.fontScale));
  const meta = document.querySelectorAll('meta[name="theme-color"]');
  meta.forEach((m) => m.setAttribute('content', d.dataset.theme === 'dark' ? '#0B1E22' : '#E9EFEE'));
}

export function watchSystemTheme(): () => void {
  mql ??= matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => { if (prefsStore.get().theme === 'system') applyPrefsToDocument(); };
  mql.addEventListener('change', onChange);
  return () => mql?.removeEventListener('change', onChange);
}

const reducedMq = typeof window !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
export function motionReduced(): boolean {
  return prefsStore.get().reduceMotion || !!reducedMq?.matches;
}
export function useReducedMotionPref(): boolean {
  const pref = usePrefs((p) => p.reduceMotion);
  return pref || !!reducedMq?.matches;
}
