// Shared bankroll & profile. localStorage-backed, browser-only.
// All functions are safe to call during SSR (return defaults).

const KEY = 'chipshot.bankroll.v1';
const PROFILE_KEY = 'chipshot.profile.v1';
const STARTING = 1000;

const isBrowser = () => typeof window !== 'undefined' && !!window.localStorage;

function readRaw() {
  if (!isBrowser()) return null;
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); }
  catch { return null; }
}

function writeRaw(state) {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent('chipshot:bankroll', { detail: state }));
  } catch {}
}

export function getProfile() {
  if (!isBrowser()) return { username: null, onboarded: false };
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null') || { username: null, onboarded: false }; }
  catch { return { username: null, onboarded: false }; }
}

export function setProfile(profile) {
  if (!isBrowser()) return;
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch {}
  try { window.dispatchEvent(new CustomEvent('chipshot:profile', { detail: profile })); } catch {}
}

export function getBalance() {
  const s = readRaw();
  if (s && Number.isFinite(s.balance)) return s.balance;
  // Seed on first read
  writeRaw({ balance: STARTING, lifetime: { won: 0, lost: 0 } });
  return STARTING;
}

export function getLifetime() {
  const s = readRaw() || {};
  return s.lifetime || { won: 0, lost: 0 };
}

// delta is signed: positive = win, negative = loss/bet placed.
export function adjustBalance(delta, meta = {}) {
  if (!isBrowser()) return STARTING;
  const cur = readRaw() || { balance: STARTING, lifetime: { won: 0, lost: 0 } };
  cur.balance = Math.max(0, Math.round((cur.balance + delta) * 100) / 100);
  cur.lifetime = cur.lifetime || { won: 0, lost: 0 };
  if (delta > 0) cur.lifetime.won += delta;
  else if (delta < 0) cur.lifetime.lost += -delta;
  cur.lastChange = { delta, meta, at: Date.now() };
  writeRaw(cur);
  return cur.balance;
}

export function setBalance(value) {
  if (!isBrowser()) return STARTING;
  const cur = readRaw() || { balance: STARTING, lifetime: { won: 0, lost: 0 } };
  cur.balance = Math.max(0, Math.round(value * 100) / 100);
  writeRaw(cur);
  return cur.balance;
}

export function resetBankroll() {
  if (!isBrowser()) return STARTING;
  const fresh = { balance: STARTING, lifetime: { won: 0, lost: 0 } };
  writeRaw(fresh);
  return STARTING;
}

export const STARTING_BANKROLL = STARTING;

// Subscribe to live balance changes. Returns unsubscribe fn.
export function onBalanceChange(cb) {
  if (!isBrowser()) return () => {};
  const handler = (e) => cb(e.detail?.balance ?? getBalance());
  window.addEventListener('chipshot:bankroll', handler);
  // Cross-tab
  const storageHandler = (e) => { if (e.key === KEY) cb(getBalance()); };
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener('chipshot:bankroll', handler);
    window.removeEventListener('storage', storageHandler);
  };
}
