// Bankroll persistence + cross-page event bus.
// One source of truth in localStorage; pages subscribe via the 'chipshot:bankroll' event.

const KEY = 'chipshot.bankroll.v1';
const USER_KEY = 'chipshot.user.v1';
const START = 1000;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch (_) { return null; }
}

function write(n) {
  try { localStorage.setItem(KEY, String(Math.max(0, Math.round(n)))); } catch (_) {}
}

export function getBalance() {
  const v = read();
  if (v == null) {
    write(START);
    return START;
  }
  return v;
}

export function setBalance(n) {
  write(n);
  emit();
  return getBalance();
}

export function adjust(delta) {
  const next = Math.max(0, getBalance() + delta);
  write(next);
  emit();
  return next;
}

export function resetBankroll() {
  write(START);
  emit();
  return START;
}

function emit() {
  try {
    window.dispatchEvent(new CustomEvent('chipshot:bankroll', { detail: { balance: getBalance() } }));
  } catch (_) {}
}

export function onChange(cb) {
  const handler = (e) => cb(e.detail?.balance ?? getBalance());
  window.addEventListener('chipshot:bankroll', handler);
  // initial fire
  cb(getBalance());
  return () => window.removeEventListener('chipshot:bankroll', handler);
}

// User profile (just a name, for onboarding flavor).
export function getUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

export function setUser(user) {
  try { localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch (_) {}
  try { window.dispatchEvent(new CustomEvent('chipshot:user', { detail: user })); } catch (_) {}
}

export function formatChips(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

export const STARTING_BANKROLL = START;
