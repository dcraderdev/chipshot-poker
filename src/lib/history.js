// Per-game hand history. localStorage-backed, capped at 50 entries per game.
// Entry shape (caller-defined, but recommended):
//   { id, game, at, result: 'win'|'loss'|'push', delta, summary, payload }

const KEY = 'chipshot.history.v1';
const MAX_PER_GAME = 50;
const isBrowser = () => typeof window !== 'undefined' && !!window.localStorage;

function readAll() {
  if (!isBrowser()) return {};
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
  catch { return {}; }
}

function writeAll(all) {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
    window.dispatchEvent(new CustomEvent('chipshot:history'));
  } catch {}
}

export function recordHand(game, entry) {
  if (!isBrowser()) return;
  const all = readAll();
  const list = all[game] || [];
  const full = {
    id: entry.id || `${game}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    game,
    at: entry.at || Date.now(),
    result: entry.result || 'push',
    delta: typeof entry.delta === 'number' ? entry.delta : 0,
    summary: entry.summary || '',
    payload: entry.payload || null,
  };
  list.unshift(full);
  if (list.length > MAX_PER_GAME) list.length = MAX_PER_GAME;
  all[game] = list;
  writeAll(all);
  return full;
}

export function getHistory(game) {
  const all = readAll();
  if (!game) {
    // Return all flattened, newest-first
    return Object.values(all).flat().sort((a, b) => b.at - a.at);
  }
  return all[game] || [];
}

export function clearHistory(game) {
  if (!isBrowser()) return;
  const all = readAll();
  if (game) delete all[game];
  else for (const k of Object.keys(all)) delete all[k];
  writeAll(all);
}

export function onHistoryChange(cb) {
  if (!isBrowser()) return () => {};
  const handler = () => cb();
  window.addEventListener('chipshot:history', handler);
  return () => window.removeEventListener('chipshot:history', handler);
}

export const GAME_LABELS = {
  holdem: "Texas Hold'em",
  blackjack: 'Blackjack',
  draw: 'Five-Card Draw',
  videopoker: 'Video Poker',
};
