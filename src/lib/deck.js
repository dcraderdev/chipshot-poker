// Standard 52-card deck utilities. No state — pure functions.
// Card format: { rank: '2'..'A', suit: 's'|'h'|'d'|'c', id: string }

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
export const SUITS = ['s', 'h', 'd', 'c'];

export const SUIT_GLYPH = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const SUIT_NAME = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
export const SUIT_COLOR = { s: 'black', c: 'black', h: 'red', d: 'red' };

export function newDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (const r of RANKS) {
      deck.push({ rank: r, suit: s, id: r + s });
    }
  }
  return deck;
}

// Fisher–Yates, optionally seeded.
export function shuffle(deck, rng = Math.random) {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function freshShuffled(rng) {
  return shuffle(newDeck(), rng);
}

// Card -> pokersolver format ("As", "Td", "2c"). Already matches.
export function toSolver(card) {
  return card.rank + card.suit;
}

export function cardLabel(card) {
  return card.rank + SUIT_GLYPH[card.suit];
}
