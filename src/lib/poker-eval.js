// Thin wrapper around pokersolver. All inputs are our card objects.
import { Hand } from 'pokersolver';
import { toSolver } from './deck.js';

// Returns { rank, name, descr, cards } for best 5 of N (5..7).
export function evaluate(cards) {
  const strs = cards.map(toSolver);
  const h = Hand.solve(strs);
  return {
    rank: h.rank,
    name: h.name,
    descr: h.descr,
    cards: h.cards.map((c) => ({ rank: c.value === '1' ? 'A' : c.value, suit: c.suit, id: (c.value === '1' ? 'A' : c.value) + c.suit })),
  };
}

// Compare two evaluations: returns positive if a beats b, negative if b beats a, 0 tie.
export function compare(aCards, bCards) {
  const a = Hand.solve(aCards.map(toSolver));
  const b = Hand.solve(bCards.map(toSolver));
  const winners = Hand.winners([a, b]);
  if (winners.length === 2) return 0;
  return winners[0] === a ? 1 : -1;
}

// Returns array of winning indexes from a list of player card-lists.
export function winners(playerCardLists) {
  const hands = playerCardLists.map((cards) => Hand.solve(cards.map(toSolver)));
  const w = Hand.winners(hands);
  const idx = [];
  hands.forEach((h, i) => { if (w.includes(h)) idx.push(i); });
  return { winners: idx, hands: hands.map((h) => ({ name: h.name, descr: h.descr, rank: h.rank })) };
}
