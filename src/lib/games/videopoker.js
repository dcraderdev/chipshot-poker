// Jacks-or-Better Video Poker (9/6 paytable + max-bet royal bonus)
// Client-only — touches window/localStorage. Call init() from page script.

import { freshDeck, shuffle, toShort, RANK_LABEL, SUIT_GLYPH } from '../deck.js';
import { getBalance, adjustBalance, onBalanceChange } from '../bankroll.js';
import { recordHand } from '../history.js';
import { Hand } from 'pokersolver';

// --- Paytable -----------------------------------------------------------
// Multipliers per credit bet. Royal is special: 250 normally, 800 at max-bet.
const HAND_ORDER = [
  'royal',
  'straightFlush',
  'fourKind',
  'fullHouse',
  'flush',
  'straight',
  'threeKind',
  'twoPair',
  'jacksOrBetter',
];

export const PAYTABLE = {
  royal:         { label: 'Royal Flush',     mult: [250, 500, 750, 1000, 4000], bonus: 'Max-bet pays 4000 (800x)' },
  straightFlush: { label: 'Straight Flush',  mult: [50, 100, 150, 200, 250] },
  fourKind:      { label: 'Four of a Kind',  mult: [25, 50, 75, 100, 125] },
  fullHouse:     { label: 'Full House',      mult: [9, 18, 27, 36, 45] },
  flush:         { label: 'Flush',           mult: [6, 12, 18, 24, 30] },
  straight:      { label: 'Straight',        mult: [4, 8, 12, 16, 20] },
  threeKind:     { label: 'Three of a Kind', mult: [3, 6, 9, 12, 15] },
  twoPair:       { label: 'Two Pair',        mult: [2, 4, 6, 8, 10] },
  jacksOrBetter: { label: 'Jacks or Better', mult: [1, 2, 3, 4, 5] },
};

const JOB_RANKS = new Set(['J', 'Q', 'K', 'A']);

// --- Hand evaluation ----------------------------------------------------
// Returns { key, label, winningIdx: number[] } or null for non-paying.
export function evaluateHand(cards) {
  if (!cards || cards.length !== 5) return null;
  const shorts = cards.map(toShort);
  let solved;
  try {
    solved = Hand.solve(shorts);
  } catch {
    return null;
  }
  const name = solved.name;

  // Helper: get indexes of cards whose rank matches one of `ranks`
  const idxOfRanks = (ranks) => {
    const out = [];
    cards.forEach((c, i) => { if (ranks.includes(c.rank)) out.push(i); });
    return out;
  };
  const allIdx = [0, 1, 2, 3, 4];

  if (name === 'Royal Flush')      return { key: 'royal',         label: PAYTABLE.royal.label,         winningIdx: allIdx };
  if (name === 'Straight Flush')   return { key: 'straightFlush', label: PAYTABLE.straightFlush.label, winningIdx: allIdx };
  if (name === 'Four of a Kind') {
    // pokersolver's solved.cards: first 4 are the quads
    const quadRank = solved.cards[0].value;
    return { key: 'fourKind', label: PAYTABLE.fourKind.label, winningIdx: idxOfRanks([quadRank]) };
  }
  if (name === 'Full House')       return { key: 'fullHouse',     label: PAYTABLE.fullHouse.label,     winningIdx: allIdx };
  if (name === 'Flush')            return { key: 'flush',         label: PAYTABLE.flush.label,         winningIdx: allIdx };
  if (name === 'Straight')         return { key: 'straight',      label: PAYTABLE.straight.label,      winningIdx: allIdx };
  if (name === 'Three of a Kind') {
    const tripRank = solved.cards[0].value;
    return { key: 'threeKind', label: PAYTABLE.threeKind.label, winningIdx: idxOfRanks([tripRank]) };
  }
  if (name === 'Two Pair') {
    // first 4 of solved.cards are the two pairs
    const r1 = solved.cards[0].value;
    const r2 = solved.cards[2].value;
    return { key: 'twoPair', label: PAYTABLE.twoPair.label, winningIdx: idxOfRanks([r1, r2]) };
  }
  if (name === 'Pair') {
    const pairRank = solved.cards[0].value;
    if (!JOB_RANKS.has(pairRank)) return null; // low pair = no pay
    return { key: 'jacksOrBetter', label: `Pair of ${RANK_LABEL[pairRank]}s`, winningIdx: idxOfRanks([pairRank]) };
  }
  return null;
}

// payout multiplier for `key` at `bet` (1..5)
export function payoutMultiplier(key, bet) {
  const row = PAYTABLE[key];
  if (!row) return 0;
  const idx = Math.max(1, Math.min(5, bet)) - 1;
  return row.mult[idx];
}

// --- UI rendering -------------------------------------------------------
function cardEl(card, idx, opts = {}) {
  const div = document.createElement('div');
  const red = (card.suit === 'h' || card.suit === 'd');
  div.className = `playing-card pc-lg ${red ? 'is-red' : 'is-black'}`;
  if (opts.interactive) div.classList.add('is-interactive');
  if (opts.held) div.classList.add('is-held');
  if (opts.win) div.classList.add('is-win');
  if (opts.dealing) div.classList.add('is-flipping');
  div.dataset.idx = String(idx);
  div.setAttribute('role', 'button');
  div.setAttribute('aria-pressed', opts.held ? 'true' : 'false');
  div.setAttribute(
    'aria-label',
    `${RANK_LABEL[card.rank]} of ${({ s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' })[card.suit]}${opts.held ? ', held' : ''}`,
  );
  const rank = RANK_LABEL[card.rank];
  const suit = SUIT_GLYPH[card.suit];
  div.innerHTML = `
    <div class="pc-corner pc-tl"><span class="pc-rank">${rank}</span><span class="pc-suit">${suit}</span></div>
    <div class="pc-center">${suit}</div>
    <div class="pc-corner pc-br"><span class="pc-rank">${rank}</span><span class="pc-suit">${suit}</span></div>
  `;
  return div;
}

function cardBackEl(idx) {
  const div = document.createElement('div');
  div.className = 'playing-card pc-lg is-facedown';
  div.dataset.idx = String(idx);
  div.setAttribute('aria-hidden', 'true');
  div.innerHTML = '<div class="pc-back"></div>';
  return div;
}

// --- Game controller ----------------------------------------------------
export function init(root) {
  if (!root) return;

  const els = {
    cards:       root.querySelector('[data-vp-cards]'),
    paytable:    root.querySelector('[data-vp-paytable]'),
    deal:        root.querySelector('[data-vp-deal]'),
    chips:       [...root.querySelectorAll('[data-vp-chip]')],
    betLabel:    root.querySelector('[data-vp-bet]'),
    creditsLabel: root.querySelector('[data-vp-credits]'),
    banner:      root.querySelector('[data-vp-banner]'),
    lastResult:  root.querySelector('[data-vp-last]'),
    lowChips:    root.querySelector('[data-vp-lowchips]'),
  };

  // State
  let bet = 5;
  let phase = 'idle'; // 'idle' = pre-deal, 'draw' = after initial deal, 'final' = post-draw
  let hand = [];          // 5 cards
  let initialHand = [];   // snapshot at deal
  let held = [false, false, false, false, false];
  let deck = [];          // remaining deck (post-deal)
  let bannerTimer = null;

  // ------ Helpers ------
  const updateBetLabel = () => { if (els.betLabel) els.betLabel.textContent = `$${bet}`; };
  const updateCredits = () => {
    if (els.creditsLabel) els.creditsLabel.textContent = `$${Math.round(getBalance()).toLocaleString()}`;
  };
  const setChipActive = () => {
    els.chips.forEach((c) => {
      const v = Number(c.dataset.vpChip);
      c.classList.toggle('is-active', v === bet);
      c.setAttribute('aria-pressed', v === bet ? 'true' : 'false');
    });
  };
  const setDealLabel = () => {
    if (!els.deal) return;
    if (phase === 'draw') {
      els.deal.textContent = 'Draw';
    } else {
      els.deal.textContent = 'Deal';
    }
  };
  const refreshLowChips = () => {
    const bal = getBalance();
    if (els.lowChips) els.lowChips.hidden = bal >= 1;
    if (els.deal) els.deal.disabled = (phase === 'idle' && bal < 1);
    // Disable chip values exceeding balance when idle
    els.chips.forEach((c) => {
      const v = Number(c.dataset.vpChip);
      c.disabled = (phase !== 'idle') || (v > bal);
    });
    // If current bet exceeds bal, snap down
    if (phase === 'idle' && bet > bal) {
      bet = Math.max(1, Math.floor(bal));
      updateBetLabel();
      setChipActive();
      renderPaytable();
    }
  };

  // ------ Rendering ------
  const renderCardsFaceDown = () => {
    els.cards.innerHTML = '';
    for (let i = 0; i < 5; i++) els.cards.appendChild(cardBackEl(i));
  };
  const renderEmpty = () => {
    els.cards.innerHTML = '';
    // Show 5 face-down placeholders as visual anchor
    for (let i = 0; i < 5; i++) {
      const div = document.createElement('div');
      div.className = 'playing-card pc-lg is-facedown';
      div.style.opacity = '0.55';
      div.setAttribute('aria-hidden', 'true');
      div.innerHTML = '<div class="pc-back"></div>';
      els.cards.appendChild(div);
    }
  };
  const renderHand = (opts = {}) => {
    els.cards.innerHTML = '';
    const winSet = new Set(opts.winningIdx || []);
    hand.forEach((c, i) => {
      els.cards.appendChild(cardEl(c, i, {
        interactive: phase === 'draw',
        held: held[i],
        win: winSet.has(i),
        dealing: opts.dealing,
      }));
    });
  };

  const renderPaytable = () => {
    if (!els.paytable) return;
    els.paytable.innerHTML = '';
    HAND_ORDER.forEach((key) => {
      const row = PAYTABLE[key];
      const tr = document.createElement('tr');
      tr.dataset.row = key;
      const tdLabel = document.createElement('td');
      tdLabel.className = 'vp-pt-label';
      tdLabel.textContent = row.label;
      tr.appendChild(tdLabel);
      for (let b = 1; b <= 5; b++) {
        const td = document.createElement('td');
        td.className = 'vp-pt-cell';
        const m = row.mult[b - 1];
        td.textContent = m.toLocaleString();
        if (b === bet) td.classList.add('is-active-bet');
        if (b === 5 && key === 'royal') td.classList.add('is-bonus');
        tr.appendChild(td);
      }
      els.paytable.appendChild(tr);
    });
  };

  const flashWinRow = (key) => {
    const tr = els.paytable?.querySelector(`tr[data-row="${key}"]`);
    if (!tr) return;
    tr.classList.add('is-flash');
    setTimeout(() => tr.classList.remove('is-flash'), 1800);
  };

  const showBanner = (text, payout) => {
    if (!els.banner) return;
    els.banner.innerHTML = `<span class="vp-banner-text">${text}</span>${payout ? `<span class="vp-banner-payout">+$${payout}</span>` : ''}`;
    els.banner.classList.add('is-visible');
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => {
      els.banner.classList.remove('is-visible');
    }, 2200);
  };

  // ------ Actions ------
  const onChipClick = (e) => {
    if (phase !== 'idle') return;
    const v = Number(e.currentTarget.dataset.vpChip);
    if (!v) return;
    bet = v;
    updateBetLabel();
    setChipActive();
    renderPaytable();
  };

  const onCardClick = (e) => {
    if (phase !== 'draw') return;
    const target = e.target.closest('.playing-card');
    if (!target) return;
    const idx = Number(target.dataset.idx);
    if (!Number.isFinite(idx)) return;
    held[idx] = !held[idx];
    target.classList.toggle('is-held', held[idx]);
    target.setAttribute('aria-pressed', held[idx] ? 'true' : 'false');
  };

  const startDeal = () => {
    const bal = getBalance();
    if (bet > bal) {
      bet = Math.max(1, Math.floor(bal));
      updateBetLabel();
      setChipActive();
    }
    if (bal < 1) return;

    // Deduct bet
    adjustBalance(-bet, { game: 'videopoker', kind: 'bet' });
    updateCredits();

    // Fresh deck and deal 5
    deck = shuffle(freshDeck());
    hand = deck.splice(0, 5);
    initialHand = hand.slice();
    held = [false, false, false, false, false];
    phase = 'draw';
    if (els.banner) els.banner.classList.remove('is-visible');
    if (els.lastResult) els.lastResult.textContent = 'Click cards to HOLD, then Draw.';
    renderHand({ dealing: true });
    setDealLabel();
    refreshLowChips();
  };

  const startDraw = () => {
    // Replace non-held cards
    const newHand = hand.slice();
    for (let i = 0; i < 5; i++) {
      if (!held[i]) newHand[i] = deck.shift();
    }
    hand = newHand;

    // Evaluate
    const evalRes = evaluateHand(hand);
    const winIdx = evalRes ? evalRes.winningIdx : [];

    let mult = 0, payout = 0, key = null, label = 'No pair';
    if (evalRes) {
      key = evalRes.key;
      label = evalRes.label;
      mult = payoutMultiplier(key, bet);
      payout = mult * bet;
    }

    phase = 'final';
    renderHand({ winningIdx: winIdx });
    setDealLabel();

    if (payout > 0) {
      adjustBalance(payout, { game: 'videopoker', kind: 'win', handKey: key });
      showBanner(`${evalRes.label.toUpperCase()}!`, payout);
      flashWinRow(key);
    }
    updateCredits();

    const result = payout > 0 ? 'win' : 'loss';
    const delta = payout - bet;
    const summary = payout > 0
      ? `${label} — ${mult}x of $${bet} bet (+$${payout})`
      : `${label} — lost $${bet}`;
    recordHand('videopoker', {
      result,
      delta,
      summary,
      payload: {
        initial: initialHand.map(toShort),
        final: hand.map(toShort),
        holds: held.slice(),
        handName: label,
        handKey: key,
        bet,
        mult,
        payout,
      },
    });

    if (els.lastResult) {
      els.lastResult.textContent = summary;
      els.lastResult.classList.toggle('is-win', payout > 0);
      els.lastResult.classList.toggle('is-loss', payout === 0);
    }

    // Auto-advance to idle so next click of "Deal" starts a new round.
    // Keep cards visible until next Deal press.
    phase = 'idle';
    setDealLabel();
    refreshLowChips();
  };

  const onDealClick = () => {
    if (phase === 'idle') return startDeal();
    if (phase === 'draw') return startDraw();
  };

  // ------ Wire up ------
  els.chips.forEach((c) => c.addEventListener('click', onChipClick));
  els.cards?.addEventListener('click', onCardClick);
  els.deal?.addEventListener('click', onDealClick);
  onBalanceChange(() => { updateCredits(); refreshLowChips(); });

  // Keyboard: 1-5 toggle hold during draw; Space/Enter deals
  document.addEventListener('keydown', (e) => {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (phase === 'draw' && /^[1-5]$/.test(e.key)) {
      const idx = Number(e.key) - 1;
      held[idx] = !held[idx];
      const cardNode = els.cards.querySelector(`.playing-card[data-idx="${idx}"]`);
      if (cardNode) {
        cardNode.classList.toggle('is-held', held[idx]);
        cardNode.setAttribute('aria-pressed', held[idx] ? 'true' : 'false');
      }
      e.preventDefault();
    } else if ((e.key === 'Enter' || e.key === ' ') && (phase === 'idle' || phase === 'draw')) {
      onDealClick();
      e.preventDefault();
    }
  });

  // Initial render
  updateBetLabel();
  updateCredits();
  setChipActive();
  setDealLabel();
  renderPaytable();
  renderEmpty();
  refreshLowChips();
}
