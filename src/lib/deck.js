// Shared deck/card utilities. Format used everywhere:
//   card = { rank: 'A'|'K'|'Q'|'J'|'T'|'9'..'2', suit: 's'|'h'|'d'|'c' }
//   short = 'As', 'Td', '9h' ...
// pokersolver consumes short[] arrays directly.

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
export const SUITS = ['s', 'h', 'd', 'c'];
export const SUIT_GLYPH = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const SUIT_COLOR = { s: 'black', h: 'red', d: 'red', c: 'black' };

export const RANK_LABEL = {
  '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8',
  '9': '9', 'T': '10', 'J': 'J', 'Q': 'Q', 'K': 'K', 'A': 'A',
};

export function freshDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ rank: r, suit: s });
  return d;
}

// Fisher-Yates shuffle. Optional rng for tests.
export function shuffle(deck, rng = Math.random) {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const toShort = (c) => `${c.rank}${c.suit}`;
export const fromShort = (s) => ({ rank: s[0], suit: s[1] });
export const cardsToShort = (cs) => cs.map(toShort);
export const shortToCards = (ss) => ss.map(fromShort);

// Blackjack value (Ace = 1 OR 11 — caller decides via best/all)
export function bjValues(card) {
  if (card.rank === 'A') return [1, 11];
  if (['T', 'J', 'Q', 'K'].includes(card.rank)) return [10];
  return [parseInt(card.rank, 10)];
}

// Best non-busting blackjack total for a hand, or lowest if all bust.
export function bjBestTotal(cards) {
  let totals = [0];
  for (const c of cards) {
    const vs = bjValues(c);
    const next = [];
    for (const t of totals) for (const v of vs) next.push(t + v);
    totals = [...new Set(next)];
  }
  totals.sort((a, b) => a - b);
  const nonBust = totals.filter((t) => t <= 21);
  return nonBust.length ? nonBust[nonBust.length - 1] : totals[0];
}

export function bjIsSoft(cards) {
  // soft = ace counted as 11 in best total
  const best = bjBestTotal(cards);
  let hardSum = 0;
  for (const c of cards) hardSum += bjValues(c)[0]; // ace=1
  return cards.some((c) => c.rank === 'A') && best - hardSum === 10;
}

export function isBlackjack(cards) {
  return cards.length === 2 && bjBestTotal(cards) === 21;
}
