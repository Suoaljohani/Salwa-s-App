import { useEffect } from 'react';
import { createStore, useStore } from './store';
import { getCatalog } from './metrics/engine';
import type { Catalog, DatasetInfo } from './metrics/types';
import { useApp } from './appState';
import { usePrefs } from './prefs';

export const catalogStore = createStore<{ catalog: Catalog | null; state: 'idle' | 'loading' | 'ready' | 'error' }>({ catalog: null, state: 'idle' });

let inflight: Promise<void> | null = null;
export function loadCatalog(force = false): Promise<void> {
  if (inflight && !force) return inflight;
  catalogStore.set((s) => ({ ...s, state: s.catalog ? s.state : 'loading' }));
  inflight = getCatalog(force)
    .then((catalog) => catalogStore.set({ catalog, state: 'ready' }))
    .catch(() => catalogStore.set((s) => ({ ...s, state: 'error' })))
    .finally(() => { inflight = null; });
  return inflight;
}

/** Shared catalog, refreshed when demo mode flips or a dataset version changes. */
export function useCatalog(): { catalog: Catalog | null; state: 'idle' | 'loading' | 'ready' | 'error' } {
  const demo = usePrefs((p) => p.demoMode);
  const tick = useApp((s) => s.datasetTick);
  useEffect(() => { void loadCatalog(true); }, [demo, tick]);
  return useStore(catalogStore, (s) => s);
}

export function useDataset(id: string | undefined): DatasetInfo | undefined {
  return useStore(catalogStore, (s) => s.catalog?.datasets.find((d) => d.id === id));
}
