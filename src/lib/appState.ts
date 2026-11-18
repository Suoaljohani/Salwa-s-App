import { createStore, useStore } from './store';
import type { MetricRequest } from './metrics/types';

export interface PinnedIndicator { id: string; title: string; request: MetricRequest }

const PIN_KEY = 'salwa.pins.v1';
function loadPins(): PinnedIndicator[] {
  try { return JSON.parse(localStorage.getItem(PIN_KEY) ?? '[]'); } catch { return []; }
}

export const appStore = createStore<{ pins: PinnedIndicator[]; exportDraft: MetricRequest | null; datasetTick: number }>({
  pins: typeof window === 'undefined' ? [] : loadPins(),
  exportDraft: null,
  datasetTick: 0,
});

export function useApp<S>(sel: (s: ReturnType<typeof appStore.get>) => S): S { return useStore(appStore, sel); }

export function pinIndicator(p: PinnedIndicator) {
  appStore.set((s) => ({ ...s, pins: [p, ...s.pins.filter((x) => x.id !== p.id)].slice(0, 12) }));
  try { localStorage.setItem(PIN_KEY, JSON.stringify(appStore.get().pins)); } catch { /* ignore */ }
}
export function unpinIndicator(id: string) {
  appStore.set((s) => ({ ...s, pins: s.pins.filter((x) => x.id !== id) }));
  try { localStorage.setItem(PIN_KEY, JSON.stringify(appStore.get().pins)); } catch { /* ignore */ }
}
export function setExportDraft(r: MetricRequest | null) { appStore.set((s) => ({ ...s, exportDraft: r })); }
/** Bumped after an import is approved or rolled back so every surface refetches. */
export function bumpDataset() { appStore.set((s) => ({ ...s, datasetTick: s.datasetTick + 1 })); }
