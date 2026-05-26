// Five-Card Draw game logic — pure functions + a small state machine helper.
// Used by /games/five-card-draw page. No DOM concerns here.

import { freshShuffled } from '../deck.js';
import { evaluate, winners } from '../poker-eval.js';

export const ANTE = 10;
export const BET = 20;

const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const RANK_VALUE = Object.fromEntries(RANK_ORDER.map((r, i) => [r, i + 2]));

// --- Hand introspection used by the bot heuristic --------------------------
function rankCounts(cards) {
  const m = new Map();
  for (const c of cards) m.set(c.rank, (m.get(c.rank) || 0) + 1);
  return m;
}
function suitCounts(cards) {
  const m = new Map();
  for (const c of cards) m.set(c.suit, (m.get(c.suit) || 0) + 1);
  return m;
}

// Returns the set of indexes into `cards` that the bot should HOLD.
export function botHoldIndexes(cards) {
  const hold = new Set();
  const counts = rankCounts(cards);

  // 1. Always hold any pair-or-better matching ranks.
  let hasPair = false;
  for (const [rank, count] of counts.entries()) {
    if (count >= 2) {
      hasPair = true;
      cards.forEach((c, i) => { if (c.rank === rank) hold.add(i); });
    }
  }
  if (hasPair) return hold;

  // 2. Four to a flush — hold those four.
  const suits = suitCounts(cards);
  for (const [suit, count] of suits.entries()) {
    if (count === 4) {
      cards.forEach((c, i) => { if (c.suit === suit) hold.add(i); });
      return hold;
    }
  }

  // 3. Four to an open-ended straight (any 4 consecutive ranks).
  const sorted = cards
    .map((c, i) => ({ v: RANK_VALUE[c.rank], i }))
    .sort((a, b) => a.v - b.v);
  for (let start = 0; start <= sorted.length - 4; start++) {
    const window = sorted.slice(start, start + 4);
    if (window[3].v - window[0].v === 3 && new Set(window.map((x) => x.v)).size === 4) {
      window.forEach((x) => hold.add(x.i));
      return hold;
    }
  }

  // 4. Fall back: hold the single highest card (Jack or better), else discard all.
  let bestIdx = -1;
  let bestVal = 10; // require J+
  cards.forEach((c, i) => {
    const v = RANK_VALUE[c.rank];
    if (v >= bestVal) { bestVal = v; bestIdx = i; }
  });
  if (bestIdx >= 0) hold.add(bestIdx);
  return hold;
}

// --- Bet decision ---------------------------------------------------------
// Bot reacts to a player bet. Returns 'call' | 'fold'.
// Rule: fold with bottom-pair-or-worse 40% of the time; otherwise call.
//       with two-pair-or-better always call.
export function botRespondToBet(botCards, rng = Math.random) {
  const ev = evaluate(botCards);
  // pokersolver ranks: 1=HighCard, 2=Pair, 3=TwoPair, 4=Trips, ...
  if (ev.rank >= 3) return 'call';
  if (ev.rank === 2) {
    // Pair — look up the pair rank. If pair is 9 or lower, more likely to fold.
    const counts = rankCounts(botCards);
    let pairRank = '2';
    for (const [r, c] of counts.entries()) if (c === 2) pairRank = r;
    const weak = RANK_VALUE[pairRank] <= 9;
    if (weak && rng() < 0.4) return 'fold';
    return 'call';
  }
  // High card — usually fold to a bet.
  return rng() < 0.6 ? 'fold' : 'call';
}

// Whether the bot opens with a check or bet when given action first.
// For simplicity we let the player act first, so this is unused — but exported
// for future symmetry.
export function botShouldBet(botCards) {
  return evaluate(botCards).rank >= 3;
}

// --- High-level helpers ---------------------------------------------------
export function newGame(rng) {
  const deck = freshShuffled(rng);
  const player = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];
  const bot = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];
  return { deck, player, bot };
}

// Replace cards at the given indexes from the top of the deck.
export function drawReplacements(deck, hand, discardIdxs) {
  const next = hand.slice();
  for (const i of discardIdxs) {
    next[i] = deck.pop();
  }
  return next;
}

export function settle(playerHand, botHand) {
  const res = winners([playerHand, botHand]);
  const playerEval = res.hands[0];
  const botEval = res.hands[1];
  let outcome;
  if (res.winners.length === 2) outcome = 'push';
  else if (res.winners[0] === 0) outcome = 'win';
  else outcome = 'loss';
  return { outcome, playerEval, botEval };
}
