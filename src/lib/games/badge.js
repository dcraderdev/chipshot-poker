// Shared per-seat action badge helper.
// Mounts a small floating badge above a `.player-seat` showing the player's
// most recent action (ANTE, CHECK, BET $X, CALL, RAISE +$X, FOLD, DRAW N,
// STAND PAT, SHOWDOWN, WIN). Use across game modules.

const KINDS = new Set([
  'ante', 'check', 'bet', 'call', 'raise', 'fold',
  'draw', 'standpat', 'showdown', 'win',
]);

function ensureBadgeEl(seatEl) {
  let badge = seatEl.querySelector('[data-action-badge]');
  if (!badge) {
    badge = document.createElement('span');
    badge.dataset.actionBadge = '';
    badge.className = 'action-badge';
    seatEl.appendChild(badge);
  }
  return badge;
}

export function setBadge(seatEl, kind, label, { clearAfter = 0 } = {}) {
  if (!seatEl) return;
  const safe = KINDS.has(kind) ? kind : 'check';
  const badge = ensureBadgeEl(seatEl);
  badge.className = `action-badge is-${safe} is-visible`;
  badge.textContent = label;

  if (badge._timer) {
    clearTimeout(badge._timer);
    badge._timer = null;
  }
  if (clearAfter > 0) {
    badge._timer = setTimeout(() => clearBadge(seatEl), clearAfter);
  }
}

export function clearBadge(seatEl) {
  if (!seatEl) return;
  const badge = seatEl.querySelector('[data-action-badge]');
  if (!badge) return;
  if (badge._timer) { clearTimeout(badge._timer); badge._timer = null; }
  badge.classList.remove('is-visible');
  badge.textContent = '';
}

export function setActiveSeat(seats, activeSeatEl) {
  seats.forEach((s) => s && s.classList.toggle('is-acting', s === activeSeatEl));
}
