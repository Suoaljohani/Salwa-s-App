export type SalwaCue = 'select' | 'success' | 'complete' | 'notice';

type Tone = Readonly<{ frequency: number; offset: number; duration: number; gain: number }>;

const CUES: Record<SalwaCue, readonly Tone[]> = {
  select: [{ frequency: 460, offset: 0, duration: 0.06, gain: 0.05 }],
  success: [
    { frequency: 523.25, offset: 0, duration: 0.09, gain: 0.045 },
    { frequency: 659.25, offset: 0.045, duration: 0.105, gain: 0.04 },
  ],
  complete: [
    { frequency: 440, offset: 0, duration: 0.11, gain: 0.04 },
    { frequency: 659.25, offset: 0.065, duration: 0.145, gain: 0.038 },
  ],
  notice: [{ frequency: 330, offset: 0, duration: 0.13, gain: 0.045 }],
};

export interface SalwaSoundPlayer {
  unlock(): Promise<boolean>;
  play(cue: SalwaCue): boolean;
  setMuted(muted: boolean): void;
  setVolume(volume: number): void;
  dispose(): void;
}

export function createSalwaSoundPlayer(): SalwaSoundPlayer {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let muted = true;
  let volume = 0.2;
  let disposed = false;
  let lastPlayedAt = Number.NEGATIVE_INFINITY;
  const active = new Set<OscillatorNode>();

  function stopActive(): void {
    for (const oscillator of active) {
      try { oscillator.stop(); } catch { /* It may already have ended. */ }
      oscillator.disconnect();
    }
    active.clear();
  }

  async function unlock(): Promise<boolean> {
    if (disposed || typeof window === 'undefined') return false;
    try {
      if (!context) {
        const audioWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
        const Constructor = window.AudioContext ?? audioWindow.webkitAudioContext;
        if (!Constructor) return false;
        context = new Constructor();
        master = context.createGain();
        master.gain.value = muted ? 0 : volume * 0.75;
        master.connect(context.destination);
      }
      if (context.state === 'suspended') await context.resume();
      return !disposed && context.state === 'running';
    } catch {
      return false;
    }
  }

  function play(cue: SalwaCue): boolean {
    if (disposed || muted || volume === 0 || !context || !master || context.state !== 'running') return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastPlayedAt < 140) return false;
    lastPlayedAt = now;
    const audioContext = context;
    const bus = master;

    try {
      for (const tone of CUES[cue]) {
        const oscillator = audioContext.createOscillator();
        const envelope = audioContext.createGain();
        const start = audioContext.currentTime + tone.offset;
        const attack = Math.min(0.008, tone.duration / 4);
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(tone.frequency, start);
        envelope.gain.setValueAtTime(0.00001, start);
        envelope.gain.exponentialRampToValueAtTime(tone.gain, start + attack);
        envelope.gain.exponentialRampToValueAtTime(0.00001, start + tone.duration);
        oscillator.connect(envelope);
        envelope.connect(bus);
        oscillator.onended = () => {
          active.delete(oscillator);
          oscillator.disconnect();
          envelope.disconnect();
        };
        active.add(oscillator);
        oscillator.start(start);
        oscillator.stop(start + tone.duration + 0.005);
      }
      return true;
    } catch {
      stopActive();
      return false;
    }
  }

  function setMuted(value: boolean): void {
    muted = value;
    if (context && master) {
      master.gain.setTargetAtTime(muted ? 0 : volume * 0.75, context.currentTime, 0.008);
    }
    if (muted) stopActive();
  }

  function setVolume(value: number): void {
    volume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    if (context && master) {
      master.gain.setTargetAtTime(muted ? 0 : volume * 0.75, context.currentTime, 0.008);
    }
    if (volume === 0) stopActive();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    stopActive();
    if (master) master.disconnect();
    if (context) void context.close().catch(() => undefined);
    master = null;
    context = null;
  }

  return { unlock, play, setMuted, setVolume, dispose };
}
