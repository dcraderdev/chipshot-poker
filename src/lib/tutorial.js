// Per-game tutorial state. Remembers if a user has dismissed the
// first-load "how to play" carousel.

const KEY = 'chipshot.tutorial.v1';
const isBrowser = () => typeof window !== 'undefined' && !!window.localStorage;

function readAll() {
  if (!isBrowser()) return {};
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
  catch { return {}; }
}

function writeAll(all) {
  if (!isBrowser()) return;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
}

export function hasSeenTutorial(game) {
  return !!readAll()[game];
}

export function markTutorialSeen(game) {
  const all = readAll();
  all[game] = true;
  writeAll(all);
}

export function resetTutorials() {
  writeAll({});
}
