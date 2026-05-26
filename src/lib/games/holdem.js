// Texas Hold'em — single-player vs 3 bots.
// Browser-only. Call init() after DOMContentLoaded.

import { Hand } from 'pokersolver';
import { freshDeck, shuffle, toShort, RANK_LABEL, SUIT_GLYPH } from '../deck.js';
import { getBalance, adjustBalance } from '../bankroll.js';
import { recordHand } from '../history.js';

const SMALL_BLIND = 5;
const BIG_BLIND = 10;
const BOT_STACK = 1000;

// Seat layout: 0 = hero (bottom), 1 = west (left), 2 = north (top), 3 = east (right)
const SEAT_NAMES = ['You', 'Bot West', 'Bot North', 'Bot East'];

const STREETS = ['preflop', 'flop', 'turn', 'river', 'showdown'];

let state = null;

function freshState(buttonSeat = 0) {
  return {
    deck: shuffle(freshDeck()),
    players: SEAT_NAMES.map((name, i) => ({
      idx: i,
      name,
      isHero: i === 0,
      stack: i === 0 ? getBalance() : BOT_STACK,
      hole: [],
      bet: 0,            // chips put in this street
      totalBet: 0,       // chips put in this hand
      folded: false,
      allIn: false,
      hasActed: false,
    })),
    board: [],
    pot: 0,
    street: 'preflop',
    button: buttonSeat,
    toAct: 0,
    currentBet: 0,        // street bet to match
    lastRaiseSize: BIG_BLIND,
    log: [],
    awaitingHero: false,
    handOver: false,
    winners: [],          // [{seat, amount, hand}]
    winningCards: [],     // short strings
    handNumber: 0,
  };
}

// ---------- Card rendering ----------
function cardHTML(c, { faceDown = false, win = false } = {}) {
  if (faceDown) {
    return `<div class="playing-card pc-md is-facedown is-black"><div class="pc-back"><div class="pc-back-pattern"></div></div></div>`;
  }
  const isRed = c.suit === 'h' || c.suit === 'd';
  const colorClass = isRed ? 'is-red' : 'is-black';
  const winClass = win ? ' is-win' : '';
  const rank = RANK_LABEL[c.rank];
  const glyph = SUIT_GLYPH[c.suit];
  return `<div class="playing-card pc-md ${colorClass}${winClass}" data-card="${toShort(c)}">
    <div class="pc-corner pc-tl"><span class="pc-rank">${rank}</span><span class="pc-suit">${glyph}</span></div>
    <div class="pc-center">${glyph}</div>
    <div class="pc-corner pc-br"><span class="pc-rank">${rank}</span><span class="pc-suit">${glyph}</span></div>
  </div>`;
}

// ---------- DOM refs ----------
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

// ---------- Logging ----------
function log(msg, cls = '') {
  state.log.unshift({ msg, cls });
  if (state.log.length > 30) state.log.length = 30;
  renderLog();
}

function renderLog() {
  const el = $('#hold-log');
  if (!el) return;
  el.innerHTML = state.log.map(l => `<div class="${l.cls}">${l.msg}</div>`).join('');
}

// ---------- Hand start ----------
function startHand() {
  const prevButton = state ? state.button : 0;
  const button = state ? (prevButton + 1) % 4 : 0;
  state = freshState(button);
  state.handNumber += 1;

  // Fresh stacks: hero from bankroll, bots reset to BOT_STACK each hand.
  const heroBal = getBalance();
  if (heroBal <= 0) {
    state.handOver = true;
    renderAll();
    showBusted();
    return;
  }
  state.players[0].stack = heroBal;
  state.players[1].stack = BOT_STACK;
  state.players[2].stack = BOT_STACK;
  state.players[3].stack = BOT_STACK;

  // Deal 2 to each
  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < 4; i++) {
      const seat = (state.button + 1 + i) % 4;
      state.players[seat].hole.push(state.deck.pop());
    }
  }

  // Post blinds: SB = button+1, BB = button+2
  const sbSeat = (state.button + 1) % 4;
  const bbSeat = (state.button + 2) % 4;
  postBet(sbSeat, SMALL_BLIND);
  postBet(bbSeat, BIG_BLIND);
  state.currentBet = BIG_BLIND;
  state.lastRaiseSize = BIG_BLIND;
  log(`Hand #${state.handNumber} — ${state.players[state.button].name} on button. Blinds posted.`);

  // First to act preflop = button+3 (UTG in 4-handed)
  state.toAct = (state.button + 3) % 4;
  state.street = 'preflop';

  renderAll();
  advance();
}

function postBet(seat, amount) {
  const p = state.players[seat];
  const real = Math.min(amount, p.stack);
  p.stack -= real;
  p.bet += real;
  p.totalBet += real;
  state.pot += real;
  if (p.stack === 0) p.allIn = true;
  return real;
}

// ---------- Action engine ----------
function activePlayers() {
  return state.players.filter(p => !p.folded);
}

function playersAbleToBet() {
  return state.players.filter(p => !p.folded && !p.allIn);
}

function bettingRoundDone() {
  const alive = activePlayers();
  if (alive.length <= 1) return true;
  const able = playersAbleToBet();
  if (able.length === 0) return true;
  // All able-to-bet have acted and matched current bet
  return able.every(p => p.hasActed && p.bet === state.currentBet);
}

function nextSeatToAct(from) {
  for (let i = 1; i <= 4; i++) {
    const s = (from + i) % 4;
    const p = state.players[s];
    if (!p.folded && !p.allIn) return s;
  }
  return null;
}

function advance() {
  // If only one alive, award & end hand
  if (activePlayers().length <= 1) {
    return endHand();
  }
  if (bettingRoundDone()) {
    return nextStreet();
  }
  const seat = state.toAct;
  const p = state.players[seat];
  if (p.folded || p.allIn) {
    state.toAct = nextSeatToAct(seat);
    return advance();
  }
  if (p.isHero) {
    state.awaitingHero = true;
    renderAll();
  } else {
    state.awaitingHero = false;
    renderAll();
    setTimeout(() => botAct(seat), 700);
  }
}

function nextStreet() {
  // Collect bets into pot (already in pot since postBet); reset street bets.
  state.players.forEach(p => { p.bet = 0; p.hasActed = false; });
  state.currentBet = 0;
  state.lastRaiseSize = BIG_BLIND;

  const idx = STREETS.indexOf(state.street);
  const nextStreetName = STREETS[idx + 1];
  state.street = nextStreetName;

  if (nextStreetName === 'flop') {
    state.deck.pop(); // burn
    state.board.push(state.deck.pop(), state.deck.pop(), state.deck.pop());
    log(`Flop: ${state.board.map(c => RANK_LABEL[c.rank] + SUIT_GLYPH[c.suit]).join(' ')}`);
  } else if (nextStreetName === 'turn') {
    state.deck.pop();
    state.board.push(state.deck.pop());
    log(`Turn: ${SUIT_GLYPH[state.board[3].suit]}${RANK_LABEL[state.board[3].rank]}`);
  } else if (nextStreetName === 'river') {
    state.deck.pop();
    state.board.push(state.deck.pop());
    log(`River: ${SUIT_GLYPH[state.board[4].suit]}${RANK_LABEL[state.board[4].rank]}`);
  } else if (nextStreetName === 'showdown') {
    return showdown();
  }

  // First to act postflop = first alive seat after button
  state.toAct = nextSeatToAct(state.button);
  // If only allins remain, fast-forward
  if (playersAbleToBet().length < 2) {
    // Continue dealing without further betting
    setTimeout(() => nextStreet(), 600);
    renderAll();
    return;
  }
  renderAll();
  setTimeout(() => advance(), 500);
}

// ---------- Hero actions ----------
function heroFold() { applyAction(0, { type: 'fold' }); }
function heroCheckCall() {
  const p = state.players[0];
  const toCall = state.currentBet - p.bet;
  if (toCall <= 0) applyAction(0, { type: 'check' });
  else applyAction(0, { type: 'call', amount: toCall });
}
function heroRaise(target) {
  // target = total street bet hero wants to be at
  const p = state.players[0];
  const min = state.currentBet + state.lastRaiseSize;
  let total = Math.max(target, min);
  total = Math.min(total, p.bet + p.stack); // can't exceed all-in
  applyAction(0, { type: 'raise', target: total });
}

function applyAction(seat, action) {
  const p = state.players[seat];
  if (action.type === 'fold') {
    p.folded = true;
    p.hasActed = true;
    log(`${p.name} folds.`);
  } else if (action.type === 'check') {
    p.hasActed = true;
    log(`${p.name} checks.`);
  } else if (action.type === 'call') {
    const toCall = state.currentBet - p.bet;
    const real = Math.min(toCall, p.stack);
    p.stack -= real; p.bet += real; p.totalBet += real; state.pot += real;
    if (p.stack === 0) p.allIn = true;
    p.hasActed = true;
    log(`${p.name} calls $${real}.`);
  } else if (action.type === 'raise') {
    const need = action.target - p.bet;
    const real = Math.min(need, p.stack);
    p.stack -= real; p.bet += real; p.totalBet += real; state.pot += real;
    if (p.stack === 0) p.allIn = true;
    const raiseSize = p.bet - state.currentBet;
    state.lastRaiseSize = Math.max(state.lastRaiseSize, raiseSize);
    state.currentBet = p.bet;
    // Other players need to act again
    state.players.forEach(o => { if (o !== p && !o.folded && !o.allIn) o.hasActed = false; });
    p.hasActed = true;
    log(`${p.name} ${raiseSize === p.totalBet ? 'bets' : 'raises to'} $${p.bet}.`);
  }
  state.awaitingHero = false;
  state.toAct = nextSeatToAct(seat);
  renderAll();
  setTimeout(() => advance(), 250);
}

// ---------- Bot brain ----------
function botAct(seat) {
  if (state.handOver) return;
  const p = state.players[seat];
  if (p.folded || p.allIn) {
    state.toAct = nextSeatToAct(seat);
    return advance();
  }
  const decision = botDecide(p);
  applyAction(seat, decision);
}

function botDecide(p) {
  const toCall = state.currentBet - p.bet;
  // Preflop logic
  if (state.street === 'preflop') {
    const strength = preflopStrength(p.hole);
    if (strength >= 0.85) {
      // Premium - raise
      if (toCall < state.currentBet * 2.5) {
        return { type: 'raise', target: Math.min(state.currentBet * 3, p.bet + p.stack) };
      }
      return toCall === 0 ? { type: 'check' } : { type: 'call' };
    }
    if (strength >= 0.5) {
      // Playable - call
      if (toCall === 0) return { type: 'check' };
      if (toCall <= BIG_BLIND * 4) return { type: 'call' };
      return { type: 'fold' };
    }
    if (toCall === 0) return { type: 'check' };
    return { type: 'fold' };
  }

  // Post-flop: evaluate 5+ card hand
  const all = [...p.hole, ...state.board].map(toShort);
  let rank = 0;
  try {
    const h = Hand.solve(all);
    rank = h.rank; // pokersolver: 1=high card .. 9=straight flush
  } catch { rank = 1; }

  if (rank >= 4) {
    // Two pair or better — bet/raise
    const r = Math.random();
    if (r < 0.5 && p.stack > state.pot * 0.5) {
      const target = Math.max(state.currentBet + Math.max(state.pot, BIG_BLIND), state.currentBet + state.lastRaiseSize);
      return { type: 'raise', target: Math.min(target, p.bet + p.stack) };
    }
    return toCall === 0 ? { type: 'check' } : { type: 'call' };
  }
  if (rank >= 2) {
    // Pair — call/check
    if (toCall === 0) return { type: 'check' };
    if (toCall <= state.pot * 0.6) return { type: 'call' };
    return Math.random() < 0.3 ? { type: 'call' } : { type: 'fold' };
  }
  // Air
  if (toCall === 0) {
    // Occasional bluff
    if (Math.random() < 0.18) {
      const target = Math.max(state.currentBet + Math.round(state.pot * 0.5), state.currentBet + state.lastRaiseSize);
      return { type: 'raise', target: Math.min(target, p.bet + p.stack) };
    }
    return { type: 'check' };
  }
  return Math.random() < 0.18 ? { type: 'call' } : { type: 'fold' };
}

function preflopStrength(hole) {
  const [a, b] = hole;
  const rankOrder = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
  const r1 = rankOrder.indexOf(a.rank);
  const r2 = rankOrder.indexOf(b.rank);
  const pair = a.rank === b.rank;
  const suited = a.suit === b.suit;
  const hi = Math.max(r1, r2);
  const lo = Math.min(r1, r2);
  const gap = hi - lo;

  if (pair) return 0.6 + (hi / 12) * 0.4; // 22 ~0.6, AA ~1.0
  let s = (hi / 12) * 0.5;                  // hi card weight
  if (suited) s += 0.12;
  if (gap === 1) s += 0.10;                 // connected
  else if (gap === 2) s += 0.05;
  if (hi >= 10 && lo >= 9) s += 0.15;       // broadway
  return Math.min(s, 0.99);
}

// ---------- Showdown ----------
function showdown() {
  const alive = activePlayers();
  // Build pokersolver hands
  const hands = alive.map(p => {
    const all = [...p.hole, ...state.board].map(toShort);
    const h = Hand.solve(all);
    h._seat = p.idx;
    return h;
  });
  const winners = Hand.winners(hands);
  const share = Math.floor(state.pot / winners.length);
  const remainder = state.pot - share * winners.length;
  state.winners = winners.map((h, i) => ({
    seat: h._seat,
    amount: share + (i === 0 ? remainder : 0),
    handName: h.descr || h.name,
    cards: (h.cards || []).map(c => (c.value || c.toString().slice(0, -1)) + (c.suit || c.toString().slice(-1))),
  }));
  state.winningCards = [];
  winners.forEach(h => {
    (h.cards || []).forEach(c => {
      const s = c.toString();
      // pokersolver toString returns like "As", "Td"
      state.winningCards.push(s);
    });
  });
  state.winners.forEach(w => {
    const p = state.players[w.seat];
    p.stack += w.amount;
    log(`${p.name} wins $${w.amount} with ${w.handName}.`, 'log-win');
  });
  endHand(true);
}

function endHand(fromShowdown = false) {
  state.handOver = true;
  state.awaitingHero = false;

  if (!fromShowdown) {
    // Award uncontested pot
    const alive = activePlayers();
    if (alive.length === 1) {
      const p = alive[0];
      p.stack += state.pot;
      state.winners = [{ seat: p.idx, amount: state.pot, handName: 'uncontested', cards: [] }];
      log(`${p.name} wins $${state.pot} (uncontested).`, p.isHero ? 'log-win' : 'log-loss');
    }
  }

  // Settle hero bankroll
  const hero = state.players[0];
  const heroWon = state.winners.find(w => w.seat === 0);
  const delta = (heroWon ? heroWon.amount : 0) - hero.totalBet;
  let result = 'push';
  if (delta > 0) result = 'win';
  else if (delta < 0) result = 'loss';

  try {
    adjustBalance(delta, { game: 'holdem' });
  } catch {}
  try {
    recordHand('holdem', {
      result,
      delta,
      summary: heroWon
        ? `Won $${heroWon.amount} with ${heroWon.handName}`
        : `Lost $${hero.totalBet}`,
      payload: {
        hole: hero.hole.map(toShort),
        board: state.board.map(toShort),
        winnerName: state.winners[0] ? state.players[state.winners[0].seat].name : null,
        handName: state.winners[0] ? state.winners[0].handName : null,
      },
    });
  } catch {}

  renderAll();

  // Check bust
  if (getBalance() <= 0) {
    showBusted();
  }
}

function showBusted() {
  const el = $('#hold-busted');
  if (el) el.hidden = false;
  const nextBtn = $('#hold-next');
  if (nextBtn) nextBtn.disabled = true;
}

// ---------- Render ----------
function renderAll() {
  if (!state) return;
  renderSeats();
  renderBoard();
  renderHole();
  renderPot();
  renderActionBar();
  renderLog();
  renderStreet();
}

function renderStreet() {
  const el = $('#hold-street');
  if (el) el.textContent = state.handOver ? 'Hand complete' : state.street.toUpperCase();
}

function renderPot() {
  const el = $('#hold-pot');
  if (el) el.textContent = `Pot $${state.pot}`;
}

function renderSeats() {
  for (let i = 0; i < 4; i++) {
    const p = state.players[i];
    const el = $(`[data-seat="${i}"]`);
    if (!el) continue;
    el.classList.toggle('is-active', !state.handOver && state.toAct === i && !p.folded);
    el.classList.toggle('is-folded', p.folded);
    el.classList.toggle('is-winner', state.winners.some(w => w.seat === i));
    el.querySelector('[data-seat-stack]').textContent = `$${p.stack}`;
    const betEl = el.querySelector('[data-seat-bet]');
    betEl.textContent = p.bet > 0 ? `Bet $${p.bet}` : '';
    betEl.style.display = p.bet > 0 ? '' : 'none';

    // Bot cards
    if (!p.isHero) {
      const cards = el.querySelector('[data-seat-cards]');
      if (cards) {
        const showFace = state.handOver && !p.folded && state.board.length === 5;
        if (p.hole.length === 0) {
          cards.innerHTML = '';
        } else if (showFace) {
          cards.innerHTML = p.hole.map(c => cardHTML(c, { win: state.winningCards.includes(toShort(c)) })).join('');
        } else {
          cards.innerHTML = p.hole.map(() => cardHTML(null, { faceDown: true })).join('');
        }
      }
    }
  }
}

function renderHole() {
  const el = $('#hold-hero-cards');
  if (!el) return;
  const hero = state.players[0];
  el.innerHTML = hero.hole.map(c => cardHTML(c, { win: state.winningCards.includes(toShort(c)) })).join('');
}

function renderBoard() {
  const el = $('#hold-board');
  if (!el) return;
  const slots = [];
  for (let i = 0; i < 5; i++) {
    if (state.board[i]) {
      const c = state.board[i];
      slots.push(cardHTML(c, { win: state.winningCards.includes(toShort(c)) }));
    } else {
      slots.push(`<div class="playing-card pc-md is-facedown is-black" style="opacity:0.18"><div class="pc-back"><div class="pc-back-pattern"></div></div></div>`);
    }
  }
  el.innerHTML = slots.join('');
}

function renderActionBar() {
  const bar = $('#hold-actions');
  const next = $('#hold-next');
  if (!bar || !next) return;
  if (state.handOver) {
    bar.hidden = true;
    next.hidden = false;
    return;
  }
  bar.hidden = !state.awaitingHero;
  next.hidden = true;
  if (!state.awaitingHero) return;

  const hero = state.players[0];
  const toCall = state.currentBet - hero.bet;
  const callBtn = $('#hold-call');
  const foldBtn = $('#hold-fold');
  const raiseBtns = $$('[data-raise]');

  if (toCall <= 0) {
    callBtn.textContent = 'Check';
  } else {
    callBtn.textContent = `Call $${Math.min(toCall, hero.stack)}`;
  }
  callBtn.disabled = false;
  foldBtn.disabled = toCall <= 0; // Can't fold if you can check (still allowed but discouraged) — keep enabled
  foldBtn.disabled = false;

  const potIfCalled = state.pot + Math.min(toCall, hero.stack);
  const half = Math.max(state.currentBet + state.lastRaiseSize, hero.bet + Math.round(potIfCalled * 0.5));
  const full = Math.max(state.currentBet + state.lastRaiseSize, hero.bet + potIfCalled);
  const allIn = hero.bet + hero.stack;

  raiseBtns.forEach(btn => {
    const kind = btn.dataset.raise;
    let target = half;
    let label = '1/2 pot';
    if (kind === 'pot') { target = full; label = 'Pot'; }
    if (kind === 'allin') { target = allIn; label = 'All-in'; }
    target = Math.min(target, allIn);
    btn.disabled = target <= hero.bet || hero.stack === 0;
    btn.dataset.target = String(target);
    btn.textContent = `${label} ($${target})`;
  });
}

// ---------- Boot ----------
export function init() {
  if (typeof window === 'undefined') return;

  // Wire buttons
  $('#hold-fold')?.addEventListener('click', heroFold);
  $('#hold-call')?.addEventListener('click', heroCheckCall);
  $$('[data-raise]').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = parseInt(btn.dataset.target || '0', 10);
      if (t > 0) heroRaise(t);
    });
  });
  $('#hold-next')?.addEventListener('click', () => {
    if (getBalance() <= 0) { showBusted(); return; }
    const busted = $('#hold-busted');
    if (busted) busted.hidden = true;
    startHand();
  });

  startHand();
}
