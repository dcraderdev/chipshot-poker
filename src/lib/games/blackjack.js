// Blackjack game logic + DOM controller.
// Imports shared deck/bankroll/history utilities. Browser-only (init() must be
// called from a client script tag, never during SSR).

import {
  freshDeck,
  shuffle,
  bjBestTotal,
  bjIsSoft,
  isBlackjack,
  RANK_LABEL,
  SUIT_GLYPH,
} from '../deck.js';
import { getBalance, adjustBalance, onBalanceChange } from '../bankroll.js';
import { recordHand } from '../history.js';

const NUM_DECKS = 6;
const RESHUFFLE_RATIO = 0.25; // reshuffle when < 25% remain
const MIN_BET = 5;
const MAX_BET = 500;
const DEALER_HITS_SOFT_17 = true;

// ----- Shoe -----
function buildShoe(numDecks = NUM_DECKS) {
  let cards = [];
  for (let i = 0; i < numDecks; i++) cards = cards.concat(freshDeck());
  return shuffle(cards);
}

// ----- DOM helpers -----
function isRedSuit(suit) {
  return suit === 'h' || suit === 'd';
}

function cardEl(card, { faceDown = false, dealing = false } = {}) {
  const div = document.createElement('div');
  const classes = ['playing-card', 'pc-md'];
  if (faceDown) {
    classes.push('is-facedown');
    div.className = classes.join(' ');
    if (dealing) div.classList.add('is-dealing');
    const back = document.createElement('div');
    back.className = 'pc-back';
    div.appendChild(back);
    return div;
  }
  classes.push(isRedSuit(card.suit) ? 'is-red' : 'is-black');
  div.className = classes.join(' ');
  if (dealing) div.classList.add('is-dealing');
  const glyph = SUIT_GLYPH[card.suit];
  const label = RANK_LABEL[card.rank];
  div.innerHTML = `
    <div class="pc-corner pc-tl"><span class="pc-rank">${label}</span><span class="pc-suit">${glyph}</span></div>
    <div class="pc-center">${glyph}</div>
    <div class="pc-corner pc-br"><span class="pc-rank">${label}</span><span class="pc-suit">${glyph}</span></div>
  `;
  return div;
}

function totalLabel(cards) {
  if (!cards.length) return '';
  const best = bjBestTotal(cards);
  const soft = bjIsSoft(cards);
  if (best > 21) return `bust ${best}`;
  if (soft && best !== 21) return `soft ${best}`;
  return `${best}`;
}

// ----- State -----
function makeState() {
  return {
    shoe: [],
    bet: 25,
    pendingBet: 25,
    dealer: [],
    hands: [],            // [{ cards, bet, done, doubled, fromSplit, result }]
    activeIdx: 0,
    revealed: false,
    phase: 'idle',        // 'idle' | 'player' | 'dealer' | 'resolved'
    balance: 0,
  };
}

// ----- Main init -----
export function init(root) {
  if (typeof window === 'undefined') return;
  if (!root) return;

  const refs = {
    balance: root.querySelector('[data-bj-balance]'),
    bet: root.querySelector('[data-bj-bet]'),
    chipRow: root.querySelector('[data-bj-chiprow]'),
    clearBet: root.querySelector('[data-bj-clearbet]'),
    dealerArea: root.querySelector('[data-bj-dealer]'),
    dealerTotal: root.querySelector('[data-bj-dealer-total]'),
    handsArea: root.querySelector('[data-bj-hands]'),
    message: root.querySelector('[data-bj-message]'),
    log: root.querySelector('[data-bj-log]'),
    lowChips: root.querySelector('[data-bj-lowchips]'),
    actions: {
      deal: root.querySelector('[data-act="deal"]'),
      hit: root.querySelector('[data-act="hit"]'),
      stand: root.querySelector('[data-act="stand"]'),
      double: root.querySelector('[data-act="double"]'),
      split: root.querySelector('[data-act="split"]'),
      next: root.querySelector('[data-act="next"]'),
    },
  };

  const state = makeState();
  state.shoe = buildShoe();
  state.balance = getBalance();

  // ---- helpers ----
  const log = (msg, kind = '') => {
    if (!refs.log) return;
    const line = document.createElement('div');
    if (kind) line.className = `log-${kind}`;
    line.textContent = msg;
    refs.log.appendChild(line);
    refs.log.scrollTop = refs.log.scrollHeight;
  };

  const setMessage = (text) => {
    if (refs.message) refs.message.textContent = text || '';
  };

  const ensureShoe = () => {
    if (state.shoe.length < NUM_DECKS * 52 * RESHUFFLE_RATIO) {
      state.shoe = buildShoe();
      log('Shuffled a fresh shoe.');
    }
  };

  const draw = () => state.shoe.pop();

  // ---- rendering ----
  const renderBalance = () => {
    state.balance = getBalance();
    if (refs.balance) refs.balance.textContent = `$${Math.round(state.balance).toLocaleString()}`;
    updateChipRowAffordance();
    updateLowChipsHint();
  };

  const renderBet = () => {
    if (refs.bet) refs.bet.textContent = `$${state.pendingBet}`;
  };

  const updateChipRowAffordance = () => {
    if (!refs.chipRow) return;
    const chips = refs.chipRow.querySelectorAll('.bet-chip');
    chips.forEach((c) => {
      const v = parseInt(c.getAttribute('data-val'), 10);
      const wouldExceed = state.pendingBet + v > MAX_BET;
      const cantAfford = v > state.balance;
      c.toggleAttribute('disabled', wouldExceed || cantAfford || state.phase !== 'idle');
      c.style.opacity = (wouldExceed || cantAfford || state.phase !== 'idle') ? '0.35' : '1';
      c.style.pointerEvents = (state.phase !== 'idle') ? 'none' : 'auto';
    });
  };

  const updateLowChipsHint = () => {
    if (!refs.lowChips) return;
    const need = Math.max(MIN_BET, state.pendingBet);
    const broke = state.balance < need;
    refs.lowChips.hidden = !broke;
  };

  const renderDealer = ({ animate = false } = {}) => {
    if (!refs.dealerArea) return;
    refs.dealerArea.innerHTML = '';
    state.dealer.forEach((c, i) => {
      const hideHole = (!state.revealed && i === 1);
      const el = cardEl(c, { faceDown: hideHole, dealing: animate });
      refs.dealerArea.appendChild(el);
    });
    if (refs.dealerTotal) {
      if (!state.dealer.length) {
        refs.dealerTotal.textContent = '';
      } else if (!state.revealed) {
        // Show only the up-card value
        const up = [state.dealer[0]];
        refs.dealerTotal.textContent = totalLabel(up);
      } else {
        refs.dealerTotal.textContent = totalLabel(state.dealer);
      }
    }
  };

  const renderHands = ({ animate = false } = {}) => {
    if (!refs.handsArea) return;
    refs.handsArea.innerHTML = '';
    state.hands.forEach((h, idx) => {
      const seat = document.createElement('div');
      seat.className = 'player-seat';
      if (state.phase === 'player' && idx === state.activeIdx) seat.classList.add('is-active');
      if (h.result === 'win' || h.result === 'blackjack') seat.classList.add('is-winner');
      if (h.result === 'loss' || h.result === 'bust') seat.classList.add('is-folded');

      const name = document.createElement('span');
      name.className = 'player-name';
      const baseLabel = state.hands.length > 1 ? `HAND ${idx + 1}` : 'YOU';
      name.textContent = `${baseLabel} · ${totalLabel(h.cards)}`;
      seat.appendChild(name);

      const cardsWrap = document.createElement('div');
      cardsWrap.className = 'card-row';
      h.cards.forEach((c) => {
        const el = cardEl(c, { dealing: animate });
        if (h.result === 'win' || h.result === 'blackjack') el.classList.add('is-win');
        cardsWrap.appendChild(el);
      });
      seat.appendChild(cardsWrap);

      const betChip = document.createElement('span');
      betChip.className = 'player-bet';
      betChip.textContent = `Bet $${h.bet}`;
      seat.appendChild(betChip);

      refs.handsArea.appendChild(seat);
    });
  };

  const renderAll = (opts) => {
    renderBalance();
    renderBet();
    renderDealer(opts);
    renderHands(opts);
    updateActions();
  };

  const updateActions = () => {
    const a = refs.actions;
    const inHand = state.phase === 'player';
    const cur = inHand ? state.hands[state.activeIdx] : null;

    if (a.deal) a.deal.disabled = !(state.phase === 'idle' && state.pendingBet >= MIN_BET && state.balance >= state.pendingBet);
    if (a.hit) a.hit.disabled = !inHand || !cur || cur.done;
    if (a.stand) a.stand.disabled = !inHand || !cur || cur.done;

    // Double: only on first decision (2 cards), need balance for extra bet
    const canDouble = inHand && cur && cur.cards.length === 2 && !cur.doubled && state.balance >= cur.bet;
    if (a.double) a.double.disabled = !canDouble;

    // Split: only on a pair (same rank value); only once for simplicity; need balance
    const canSplit = inHand && cur && cur.cards.length === 2 &&
      sameRankValue(cur.cards[0], cur.cards[1]) && !cur.fromSplit && state.balance >= cur.bet &&
      state.hands.length < 4;
    if (a.split) a.split.disabled = !canSplit;

    if (a.next) a.next.hidden = state.phase !== 'resolved';
    // Hide hit/stand/double/split when not in player phase
    const hideActions = state.phase !== 'player';
    ['hit', 'stand', 'double', 'split'].forEach((k) => {
      if (a[k]) a[k].hidden = hideActions;
    });
    if (a.deal) a.deal.hidden = state.phase !== 'idle';
  };

  function sameRankValue(a, b) {
    // For split: 10/J/Q/K all worth 10 count as a pair
    const v = (r) => (['T', 'J', 'Q', 'K'].includes(r) ? 10 : (r === 'A' ? 1 : parseInt(r, 10)));
    return v(a.rank) === v(b.rank);
  }

  // ---- chip betting ----
  refs.chipRow?.addEventListener('click', (e) => {
    const chip = e.target.closest('.bet-chip');
    if (!chip || state.phase !== 'idle') return;
    const v = parseInt(chip.getAttribute('data-val'), 10);
    if (!v) return;
    const next = Math.min(MAX_BET, state.pendingBet + v);
    if (next > state.balance) return;
    state.pendingBet = next;
    renderAll();
  });

  refs.clearBet?.addEventListener('click', () => {
    if (state.phase !== 'idle') return;
    state.pendingBet = 0;
    renderAll();
  });

  // ---- actions ----
  refs.actions.deal?.addEventListener('click', () => startHand());
  refs.actions.hit?.addEventListener('click', () => hit());
  refs.actions.stand?.addEventListener('click', () => stand());
  refs.actions.double?.addEventListener('click', () => doubleDown());
  refs.actions.split?.addEventListener('click', () => splitHand());
  refs.actions.next?.addEventListener('click', () => resetForNextHand());

  // ---- gameplay ----
  function startHand() {
    if (state.phase !== 'idle') return;
    if (state.pendingBet < MIN_BET) {
      setMessage(`Minimum bet is $${MIN_BET}.`);
      return;
    }
    if (state.pendingBet > state.balance) {
      setMessage('Not enough chips.');
      return;
    }
    ensureShoe();
    state.bet = state.pendingBet;
    state.dealer = [];
    state.hands = [{ cards: [], bet: state.bet, done: false, doubled: false, fromSplit: false, result: null }];
    state.activeIdx = 0;
    state.revealed = false;
    state.phase = 'player';
    setMessage('');

    // Place bet
    adjustBalance(-state.bet, { game: 'blackjack', action: 'bet' });
    state.balance = getBalance();

    // Deal: hero, dealer, hero, dealer (hole)
    state.hands[0].cards.push(draw());
    state.dealer.push(draw());
    state.hands[0].cards.push(draw());
    state.dealer.push(draw());

    log(`Bet $${state.bet}. Dealing...`);
    renderAll({ animate: true });

    // Check naturals
    const heroBJ = isBlackjack(state.hands[0].cards);
    const dealerUp = state.dealer[0];
    const dealerCouldBJ = dealerUp.rank === 'A' || ['T', 'J', 'Q', 'K'].includes(dealerUp.rank);

    if (heroBJ || (dealerCouldBJ && isBlackjack(state.dealer))) {
      // Reveal and resolve immediately
      state.hands[0].done = true;
      resolveDealerAndScore({ skipDealerPlay: true });
    } else {
      updateActions();
    }
  }

  function hit() {
    const h = state.hands[state.activeIdx];
    if (!h || h.done) return;
    h.cards.push(draw());
    renderAll();
    const total = bjBestTotal(h.cards);
    if (total > 21) {
      h.done = true;
      h.result = 'bust';
      log(`Hand ${state.activeIdx + 1} busts at ${total}.`, 'loss');
      advanceOrResolve();
    } else if (total === 21) {
      // auto-stand at 21
      h.done = true;
      advanceOrResolve();
    } else {
      updateActions();
    }
  }

  function stand() {
    const h = state.hands[state.activeIdx];
    if (!h || h.done) return;
    h.done = true;
    advanceOrResolve();
  }

  function doubleDown() {
    const h = state.hands[state.activeIdx];
    if (!h || h.done || h.cards.length !== 2 || h.doubled) return;
    if (state.balance < h.bet) return;
    adjustBalance(-h.bet, { game: 'blackjack', action: 'double' });
    state.balance = getBalance();
    h.bet *= 2;
    h.doubled = true;
    h.cards.push(draw());
    log(`Hand ${state.activeIdx + 1} doubles to $${h.bet}.`);
    const total = bjBestTotal(h.cards);
    if (total > 21) {
      h.result = 'bust';
      log(`Hand ${state.activeIdx + 1} busts at ${total}.`, 'loss');
    }
    h.done = true;
    renderAll();
    advanceOrResolve();
  }

  function splitHand() {
    const h = state.hands[state.activeIdx];
    if (!h || h.cards.length !== 2 || h.fromSplit) return;
    if (!sameRankValue(h.cards[0], h.cards[1])) return;
    if (state.balance < h.bet) return;
    adjustBalance(-h.bet, { game: 'blackjack', action: 'split' });
    state.balance = getBalance();

    const c1 = h.cards[0];
    const c2 = h.cards[1];
    const bet = h.bet;
    const newHand1 = { cards: [c1, draw()], bet, done: false, doubled: false, fromSplit: true, result: null };
    const newHand2 = { cards: [c2, draw()], bet, done: false, doubled: false, fromSplit: true, result: null };

    // Replace current hand with the two split hands at the active index
    state.hands.splice(state.activeIdx, 1, newHand1, newHand2);
    log(`Split into two hands.`);
    renderAll();

    // If first split hand is 21, auto-advance
    if (bjBestTotal(newHand1.cards) === 21) {
      newHand1.done = true;
      advanceOrResolve();
    } else {
      updateActions();
    }
  }

  function advanceOrResolve() {
    // Find next undone hand
    let idx = state.activeIdx;
    while (idx < state.hands.length && state.hands[idx].done) idx++;
    if (idx < state.hands.length) {
      state.activeIdx = idx;
      renderAll();
      // Auto-stand at 21
      const h = state.hands[idx];
      if (bjBestTotal(h.cards) === 21) {
        h.done = true;
        advanceOrResolve();
      }
      return;
    }
    // All hands done — dealer plays if any hand didn't bust
    const anyAlive = state.hands.some((h) => bjBestTotal(h.cards) <= 21);
    resolveDealerAndScore({ skipDealerPlay: !anyAlive });
  }

  function dealerShouldHit() {
    const total = bjBestTotal(state.dealer);
    if (total < 17) return true;
    if (total === 17 && DEALER_HITS_SOFT_17 && bjIsSoft(state.dealer)) return true;
    return false;
  }

  function resolveDealerAndScore({ skipDealerPlay = false } = {}) {
    state.phase = 'dealer';
    state.revealed = true;
    renderAll();

    if (!skipDealerPlay) {
      // Dealer draws synchronously (instant for simplicity)
      while (dealerShouldHit()) {
        state.dealer.push(draw());
      }
      const dt = bjBestTotal(state.dealer);
      log(`Dealer shows ${totalLabel(state.dealer)}.`, dt > 21 ? 'win' : '');
    }

    const dealerTotal = bjBestTotal(state.dealer);
    const dealerBJ = isBlackjack(state.dealer);

    let totalDelta = 0;
    state.hands.forEach((h, i) => {
      const heroTotal = bjBestTotal(h.cards);
      const heroBJ = isBlackjack(h.cards) && !h.fromSplit;
      let result, delta, summary;

      if (heroBJ && dealerBJ) {
        result = 'push';
        delta = h.bet; // return bet
        summary = `Hand ${i + 1}: both blackjack — push.`;
      } else if (heroBJ) {
        result = 'blackjack';
        delta = Math.round(h.bet * 2.5); // 3:2 payout + original bet
        summary = `Hand ${i + 1}: BLACKJACK pays 3:2 (+$${Math.round(h.bet * 1.5)}).`;
      } else if (heroTotal > 21) {
        result = 'bust';
        delta = 0; // bet already lost
        summary = `Hand ${i + 1}: bust at ${heroTotal}.`;
      } else if (dealerBJ) {
        result = 'loss';
        delta = 0;
        summary = `Hand ${i + 1}: dealer blackjack.`;
      } else if (dealerTotal > 21) {
        result = 'win';
        delta = h.bet * 2;
        summary = `Hand ${i + 1}: dealer busts — win +$${h.bet}.`;
      } else if (heroTotal > dealerTotal) {
        result = 'win';
        delta = h.bet * 2;
        summary = `Hand ${i + 1}: ${heroTotal} beats ${dealerTotal} — win +$${h.bet}.`;
      } else if (heroTotal < dealerTotal) {
        result = 'loss';
        delta = 0;
        summary = `Hand ${i + 1}: ${heroTotal} loses to ${dealerTotal}.`;
      } else {
        result = 'push';
        delta = h.bet;
        summary = `Hand ${i + 1}: push at ${heroTotal}.`;
      }

      h.result = (result === 'blackjack') ? 'win' : result;
      // adjust balance by payout (delta is the gross return; net = delta - bet)
      if (delta > 0) {
        adjustBalance(delta, { game: 'blackjack', action: 'payout' });
      }
      const net = delta - h.bet;
      totalDelta += net;
      log(summary, result === 'win' || result === 'blackjack' ? 'win' : (result === 'push' ? '' : 'loss'));

      // Record per-hand history
      recordHand('blackjack', {
        result: result === 'blackjack' ? 'win' : result,
        delta: net,
        summary: state.hands.length > 1
          ? summary
          : `Hero ${totalLabel(h.cards)} vs Dealer ${totalLabel(state.dealer)} — ${result}`,
        payload: {
          hand: h.cards,
          dealerHand: state.dealer,
          bet: h.bet,
          doubled: h.doubled,
          fromSplit: h.fromSplit,
        },
      });
    });

    state.balance = getBalance();
    state.phase = 'resolved';

    const summaryMsg = totalDelta > 0
      ? `+$${totalDelta} — nice hand.`
      : totalDelta < 0
      ? `-$${-totalDelta} — better luck next deal.`
      : 'Push.';
    setMessage(summaryMsg);
    renderAll();
  }

  function resetForNextHand() {
    state.dealer = [];
    state.hands = [];
    state.activeIdx = 0;
    state.revealed = false;
    state.phase = 'idle';
    // Keep pendingBet (let user re-deal same bet) but clamp to balance
    state.pendingBet = Math.min(state.pendingBet || MIN_BET, Math.max(MIN_BET, Math.floor(state.balance)));
    if (state.pendingBet > state.balance) state.pendingBet = Math.floor(state.balance);
    setMessage('');
    if (refs.log) refs.log.innerHTML = '';
    renderAll();
  }

  // Live balance subscription (multi-tab, settings page resets, etc.)
  onBalanceChange(() => {
    state.balance = getBalance();
    renderBalance();
    updateActions();
  });

  // Initial paint
  renderAll();
}
