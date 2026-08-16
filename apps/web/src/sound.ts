/**
 * Tiny WebAudio blips (§71). No audio files to ship, and muted by default on
 * first load until the player opts in — browsers block audio before a gesture
 * anyway.
 */
type SoundName = 'draw' | 'discard' | 'meld' | 'bucharo' | 'yourTurn' | 'wentOut' | 'error';

const TONES: Record<SoundName, { freq: number; duration: number; type: OscillatorType }> = {
  draw: { freq: 520, duration: 0.06, type: 'sine' },
  discard: { freq: 320, duration: 0.08, type: 'sine' },
  meld: { freq: 660, duration: 0.1, type: 'triangle' },
  bucharo: { freq: 880, duration: 0.22, type: 'triangle' },
  yourTurn: { freq: 740, duration: 0.14, type: 'sine' },
  wentOut: { freq: 990, duration: 0.3, type: 'triangle' },
  error: { freq: 180, duration: 0.14, type: 'sawtooth' },
};

const STORAGE_KEY = 'bukharo.muted';
let context: AudioContext | null = null;

export function isMuted(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(muted));
  } catch {
    /* ignore */
  }
}

export function playSound(name: SoundName): void {
  if (isMuted()) return;
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    const tone = TONES[name];
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = tone.type;
    oscillator.frequency.value = tone.freq;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + tone.duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + tone.duration + 0.02);
  } catch {
    /* audio is a nicety, never a failure path */
  }
}
