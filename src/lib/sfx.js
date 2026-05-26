// ChipShot Poker — synthesized SFX via Web Audio API.
// SSR-safe: no top-level access to window / AudioContext.
// Lazy-init the AudioContext on first user gesture.

const STORAGE_KEY = 'chipshot.sfx.v1';
const MASTER_GAIN = 0.35;
const EVENT_NAME = 'chipshot:sfxchange';

let ctx = null;
let masterGain = null;
let muted = false;
let initialized = false;
let gestureBound = false;

function isBrowser() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function readMutedFromStorage() {
  if (!isBrowser()) return false;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null) return false;
    const parsed = JSON.parse(raw);
    return !!(parsed && parsed.muted);
  } catch (_) {
    return false;
  }
}

function writeMutedToStorage(value) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ muted: !!value }));
  } catch (_) {
    /* ignore quota / privacy errors */
  }
}

function ensureInit() {
  if (!isBrowser()) return;
  if (!initialized) {
    muted = readMutedFromStorage();
    initialized = true;
  }
  if (!gestureBound) {
    gestureBound = true;
    const handler = () => {
      buildContext();
      document.removeEventListener('click', handler, true);
      document.removeEventListener('keydown', handler, true);
      document.removeEventListener('touchstart', handler, true);
    };
    document.addEventListener('click', handler, true);
    document.addEventListener('keydown', handler, true);
    document.addEventListener('touchstart', handler, true);
  }
}

function buildContext() {
  if (!isBrowser() || ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    masterGain = ctx.createGain();
    masterGain.gain.value = MASTER_GAIN;
    masterGain.connect(ctx.destination);
  } catch (_) {
    ctx = null;
  }
  return ctx;
}

function ready() {
  ensureInit();
  if (muted) return null;
  const c = ctx || buildContext();
  if (!c) return null;
  if (c.state === 'suspended') {
    // Best-effort resume; ignore failure if no gesture yet.
    try { c.resume(); } catch (_) { /* noop */ }
  }
  return c;
}

// ---- helpers --------------------------------------------------------------

function makeNoiseBuffer(c, durationSec) {
  const length = Math.max(1, Math.floor(c.sampleRate * durationSec));
  const buf = c.createBuffer(1, length, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buf;
}

function envGain(c, peak, attack, decay) {
  const g = c.createGain();
  const now = c.currentTime;
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(peak, now + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
  return g;
}

function stopAfter(node, c, seconds) {
  try { node.stop(c.currentTime + seconds); } catch (_) { /* noop */ }
}

// ---- sounds ---------------------------------------------------------------

export function playChip() {
  const c = ready(); if (!c) return;
  // Woody knock: low sine "thump" + tiny filtered noise transient.
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(220, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(150, c.currentTime + 0.08);
  const og = envGain(c, 0.6, 0.002, 0.08);
  osc.connect(og).connect(masterGain);
  osc.start();
  stopAfter(osc, c, 0.1);

  const noise = c.createBufferSource();
  noise.buffer = makeNoiseBuffer(c, 0.03);
  const nf = c.createBiquadFilter();
  nf.type = 'bandpass';
  nf.frequency.value = 1800;
  nf.Q.value = 0.8;
  const ng = envGain(c, 0.25, 0.001, 0.03);
  noise.connect(nf).connect(ng).connect(masterGain);
  noise.start();
}

export function playDeal() {
  const c = ready(); if (!c) return;
  // Quick "shf" — high-passed white noise burst.
  const noise = c.createBufferSource();
  noise.buffer = makeNoiseBuffer(c, 0.06);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2200;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 4500;
  bp.Q.value = 0.7;
  const g = envGain(c, 0.35, 0.003, 0.05);
  noise.connect(hp).connect(bp).connect(g).connect(masterGain);
  noise.start();
}

export function playFlip() {
  const c = ready(); if (!c) return;
  // Short tick: square wave click.
  const osc = c.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(600, c.currentTime);
  const g = envGain(c, 0.18, 0.001, 0.02);
  osc.connect(g).connect(masterGain);
  osc.start();
  stopAfter(osc, c, 0.03);
}

export function playWin() {
  const c = ready(); if (!c) return;
  // C5, E5, G5 — short sine arpeggio.
  const notes = [523.25, 659.25, 783.99];
  const step = 0.07;
  notes.forEach((freq, i) => {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, c.currentTime + i * step);
    const g = c.createGain();
    const t = c.currentTime + i * step;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(g).connect(masterGain);
    osc.start(t);
    osc.stop(t + 0.14);
  });
}

export function playLose() {
  const c = ready(); if (!c) return;
  // D5 -> Bb4, descending sine.
  const notes = [587.33, 466.16];
  const step = 0.12;
  notes.forEach((freq, i) => {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, c.currentTime + i * step);
    const g = c.createGain();
    const t = c.currentTime + i * step;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(g).connect(masterGain);
    osc.start(t);
    osc.stop(t + 0.18);
  });
}

export function playClick() {
  const c = ready(); if (!c) return;
  // Tiny UI tick.
  const osc = c.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(800, c.currentTime);
  const g = envGain(c, 0.12, 0.001, 0.015);
  osc.connect(g).connect(masterGain);
  osc.start();
  stopAfter(osc, c, 0.025);
}

// Poker action cues -----------------------------------------------------------

export function playFold() {
  // Low descending: G3 -> D3 sine, soft.
  const c = ready(); if (!c) return;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(196, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(146.83, c.currentTime + 0.18);
  const g = envGain(c, 0.25, 0.005, 0.22);
  osc.connect(g).connect(masterGain);
  osc.start();
  stopAfter(osc, c, 0.24);
}

export function playCheck() {
  // Soft knock: short low triangle tap.
  const c = ready(); if (!c) return;
  const osc = c.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(180, c.currentTime);
  const g = envGain(c, 0.22, 0.002, 0.06);
  osc.connect(g).connect(masterGain);
  osc.start();
  stopAfter(osc, c, 0.08);
}

export function playCall() {
  // Single mid tone: A4 sine pluck.
  const c = ready(); if (!c) return;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(440, c.currentTime);
  const g = envGain(c, 0.3, 0.003, 0.14);
  osc.connect(g).connect(masterGain);
  osc.start();
  stopAfter(osc, c, 0.16);
}

export function playRaise() {
  // Rising: E4 -> A4 -> C#5 stepped sine arpeggio (short).
  const c = ready(); if (!c) return;
  const notes = [329.63, 440.0, 554.37];
  const step = 0.055;
  notes.forEach((freq, i) => {
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, c.currentTime + i * step);
    const g = c.createGain();
    const t = c.currentTime + i * step;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    osc.connect(g).connect(masterGain);
    osc.start(t);
    osc.stop(t + 0.15);
  });
}

export function playBet() {
  // Bet = two quick chip knocks (woody thump pair).
  playChip();
  setTimeout(playChip, 70);
}

export function playAllIn() {
  // Dramatic: low C3 + C4 with rising harmonic and a tiny noise crash.
  const c = ready(); if (!c) return;
  const fundamental = [130.81, 261.63];
  fundamental.forEach((freq) => {
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.5, c.currentTime + 0.35);
    const g = envGain(c, 0.22, 0.01, 0.45);
    osc.connect(g).connect(masterGain);
    osc.start();
    stopAfter(osc, c, 0.5);
  });
  // Crash transient
  const noise = c.createBufferSource();
  noise.buffer = makeNoiseBuffer(c, 0.18);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1200;
  const ng = envGain(c, 0.22, 0.005, 0.16);
  noise.connect(hp).connect(ng).connect(masterGain);
  noise.start();
}

export function playPotBump() {
  // Very quick percussive chip stack settle.
  const c = ready(); if (!c) return;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(680, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(420, c.currentTime + 0.07);
  const g = envGain(c, 0.16, 0.002, 0.07);
  osc.connect(g).connect(masterGain);
  osc.start();
  stopAfter(osc, c, 0.09);
}

export function playShuffle() {
  const c = ready(); if (!c) return;
  // Riffling: ~400ms low-passed noise with LFO-modulated filter cutoff.
  const dur = 0.4;
  const noise = c.createBufferSource();
  noise.buffer = makeNoiseBuffer(c, dur);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2200;
  lp.Q.value = 0.6;

  // LFO modulating filter cutoff for "riffle" texture.
  const lfo = c.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 28;
  const lfoGain = c.createGain();
  lfoGain.gain.value = 900;
  lfo.connect(lfoGain).connect(lp.frequency);

  const g = c.createGain();
  const now = c.currentTime;
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.28, now + 0.02);
  g.gain.linearRampToValueAtTime(0.22, now + dur - 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  noise.connect(lp).connect(g).connect(masterGain);
  noise.start(now);
  lfo.start(now);
  noise.stop(now + dur + 0.02);
  lfo.stop(now + dur + 0.02);
}

// ---- mute API -------------------------------------------------------------

export function isMuted() {
  if (!initialized && isBrowser()) {
    muted = readMutedFromStorage();
    initialized = true;
  }
  return muted;
}

export function setMuted(value) {
  const next = !!value;
  muted = next;
  initialized = true;
  writeMutedToStorage(next);
  if (isBrowser()) {
    try {
      document.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { muted: next } }));
    } catch (_) { /* noop */ }
  }
  return next;
}

export function toggleMuted() {
  return setMuted(!isMuted());
}
