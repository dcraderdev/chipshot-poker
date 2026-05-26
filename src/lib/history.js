// Per-game hand history in localStorage (last 50 each).

const KEY = 'chipshot.history.v1';
const MAX = 50;

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) { return {}; }
}
function writeAll(obj) {
  try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch (_) {}
}

export function record(game, entry) {
  const all = readAll();
  const list = Array.isArray(all[game]) ? all[game] : [];
  list.unshift({ ...entry, t: Date.now() });
  all[game] = list.slice(0, MAX);
  writeAll(all);
  try { window.dispatchEvent(new CustomEvent('chipshot:history', { detail: { game, entry: all[game][0] } })); } catch (_) {}
}

export function getHistory(game) {
  const all = readAll();
  return Array.isArray(all[game]) ? all[game] : [];
}

export function getAllHistory() {
  return readAll();
}

export function clearGame(game) {
  const all = readAll();
  delete all[game];
  writeAll(all);
}

export function clearAll() {
  writeAll({});
}
