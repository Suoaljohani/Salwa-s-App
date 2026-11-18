import { createSalwaSoundPlayer, type SalwaCue } from './player';
import { prefsStore } from '../prefs';

// One player for the whole app (Web Audio synthesis from the Salwa pack; no audio files, no dependency).
const player = typeof window === 'undefined' ? null : createSalwaSoundPlayer();

function sync() {
  const p = prefsStore.get();
  player?.setMuted(!p.soundEnabled);
  player?.setVolume(p.soundVolume);
}
sync();
prefsStore.subscribe(sync);

/** Call inside the click handler that enables or previews sound. */
export async function unlockSound(): Promise<boolean> {
  sync();
  return (await player?.unlock()) ?? false;
}

/** Supplementary cue; a false result is silent suppression, never a task failure. */
export function cue(c: SalwaCue): boolean {
  return player?.play(c) ?? false;
}

export function disposeSound() { player?.dispose(); }
