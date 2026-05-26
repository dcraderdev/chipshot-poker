// Tiny Tone.js wrapper for tactile feedback. Lazy-loaded; respects a "muted" pref.
// Use: import { play } from '../lib/sounds.js'; play('deal'); play('chip'); play('win'); play('lose'); play('click');

const MUTE_KEY = 'chipshot.muted.v1';
let _Tone = null;
let _ready = false;
let _started = false;
let _synth = null;
let _noise = null;

export function isMuted() {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch (_) { return false; }
}
export function setMuted(b) {
  try { localStorage.setItem(MUTE_KEY, b ? '1' : '0'); } catch (_) {}
  try { window.dispatchEvent(new CustomEvent('chipshot:muted', { detail: { muted: !!b } })); } catch (_) {}
}

async function ensure() {
  if (_ready) return _Tone;
  if (isMuted()) return null;
  try {
    _Tone = (await import('tone')).default ?? await import('tone');
    _ready = true;
    return _Tone;
  } catch (e) {
    return null;
  }
}

async function startContext() {
  if (_started) return;
  const Tone = await ensure();
  if (!Tone) return;
  try { await Tone.start(); _started = true; } catch (_) {}
  _synth = new Tone.Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.005, decay: 0.08, sustain: 0.0, release: 0.08 }
  }).toDestination();
  _synth.volume.value = -14;
  _noise = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.05, sustain: 0 }
  }).toDestination();
  _noise.volume.value = -22;
}

// One-time gesture binding: first user interaction unlocks audio.
if (typeof window !== 'undefined') {
  const unlock = () => { startContext(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

const PATTERNS = {
  click:   () => _synth && _synth.triggerAttackRelease('C5', '16n'),
  deal:    () => _noise && _noise.triggerAttackRelease('16n'),
  chip:    () => _synth && _synth.triggerAttackRelease('E4', '32n'),
  flip:    () => _synth && _synth.triggerAttackRelease('A4', '32n'),
  win:     () => { if (!_synth) return;
                   const now = _Tone.now();
                   _synth.triggerAttackRelease('C5', '8n', now);
                   _synth.triggerAttackRelease('E5', '8n', now + 0.12);
                   _synth.triggerAttackRelease('G5', '8n', now + 0.24); },
  lose:    () => { if (!_synth) return;
                   const now = _Tone.now();
                   _synth.triggerAttackRelease('E4', '8n', now);
                   _synth.triggerAttackRelease('C4', '4n', now + 0.12); },
  push:    () => _synth && _synth.triggerAttackRelease('G4', '16n'),
};

export async function play(name) {
  if (isMuted()) return;
  if (!_started) await startContext();
  if (!_started) return;
  const fn = PATTERNS[name];
  if (fn) try { fn(); } catch (_) {}
}
