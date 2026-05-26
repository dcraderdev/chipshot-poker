// Pure paytable logic + hand classification for 9/6 Jacks or Better.
//
// All payouts are total chips returned to the player for a winning hand
// (i.e. payout already includes the original bet's worth). The bet is
// deducted up front when "Deal" is pressed, so PROFIT = payout - bet.
//
// PAYTABLE: rows are paytable categories; columns are coins bet (1..5).
// Royal Flush at 5 coins jumps from the per-coin trend (1000 -> 4000),
// which is the classic "5th coin" max-bet bonus.

export const PAYTABLE = {
  ROYAL_FLUSH:     [250, 500, 750, 1000, 4000],
  STRAIGHT_FLUSH:  [ 50, 100, 150,  200,  250],
  FOUR_OF_A_KIND:  [ 25,  50,  75,  100,  125],
  FULL_HOUSE:      [  9,  18,  27,   36,   45],
  FLUSH:           [  6,  12,  18,   24,   30],
  STRAIGHT:        [  4,   8,  12,   16,   20],
  THREE_OF_A_KIND: [  3,   6,   9,   12,   15],
  TWO_PAIR:        [  2,   4,   6,    8,   10],
  JACKS_OR_BETTER: [  1,   2,   3,    4,    5],
};

// Display label for each paytable key. Order matters: this is the
// top-to-bottom display order in the UI paytable.
export const PAYTABLE_ORDER = [
  ['ROYAL_FLUSH',     'Royal Flush'],
  ['STRAIGHT_FLUSH',  'Straight Flush'],
  ['FOUR_OF_A_KIND',  'Four of a Kind'],
  ['FULL_HOUSE',      'Full House'],
  ['FLUSH',           'Flush'],
  ['STRAIGHT',        'Straight'],
  ['THREE_OF_A_KIND', 'Three of a Kind'],
  ['TWO_PAIR',        'Two Pair'],
  ['JACKS_OR_BETTER', 'Jacks or Better'],
];

// Denominations the player can pick.
export const DENOMINATIONS = [1, 5, 25];

// Coin counts the player can pick (1..5).
export const COIN_OPTIONS = [1, 2, 3, 4, 5];

// Ranks that qualify a "Pair" as a payable Jacks-or-Better.
const HIGH_PAIR_RANKS = new Set(['J', 'Q', 'K', 'A']);

// Map a pokersolver evaluation `name` (and the 5 cards) to one of our
// paytable category keys, or null if the hand pays nothing.
//
// `cards` is the original 5-card array we dealt — we use it to verify
// a "Pair" is actually Jacks-or-Better (pokersolver only returns "Pair").
export function classify(evalName, cards) {
  switch (evalName) {
    case 'Royal Flush':     return 'ROYAL_FLUSH';
    case 'Straight Flush':  return 'STRAIGHT_FLUSH';
    case 'Four of a Kind':  return 'FOUR_OF_A_KIND';
    case 'Full House':      return 'FULL_HOUSE';
    case 'Flush':           return 'FLUSH';
    case 'Straight':        return 'STRAIGHT';
    case 'Three of a Kind': return 'THREE_OF_A_KIND';
    case 'Two Pair':        return 'TWO_PAIR';
    case 'Pair':            return isHighPair(cards) ? 'JACKS_OR_BETTER' : null;
    default:                return null;
  }
}

// True if the 5-card hand contains a pair of Jacks-or-better.
function isHighPair(cards) {
  if (!Array.isArray(cards)) return false;
  const counts = new Map();
  for (const c of cards) counts.set(c.rank, (counts.get(c.rank) || 0) + 1);
  for (const [rank, n] of counts) {
    if (n >= 2 && HIGH_PAIR_RANKS.has(rank)) return true;
  }
  return false;
}

// Display label for a paytable category key.
export function categoryLabel(key) {
  const row = PAYTABLE_ORDER.find(([k]) => k === key);
  return row ? row[1] : key;
}

// Payout (in coins) for a category at a given coin bet.
// coins is 1..5. Returns 0 for unknown categories.
export function payoutCoins(category, coins) {
  if (!category || !PAYTABLE[category]) return 0;
  const idx = Math.max(1, Math.min(5, coins)) - 1;
  return PAYTABLE[category][idx];
}

// Payout in chips (= coins × denomination).
export function payoutChips(category, coins, denomination) {
  return payoutCoins(category, coins) * denomination;
}

// Bet in chips: coins × denomination.
export function betChips(coins, denomination) {
  return coins * denomination;
}

// Indexes of the cards in `cards` that are part of the winning combination.
// Used to highlight winning cards in the UI. Returns [] for non-paying hands
// and for Royal/Straight Flush / Flush / Straight (all 5 cards are the win).
export function winningCardIndexes(category, cards) {
  if (!category) return [];
  if (
    category === 'ROYAL_FLUSH' ||
    category === 'STRAIGHT_FLUSH' ||
    category === 'FLUSH' ||
    category === 'STRAIGHT' ||
    category === 'FULL_HOUSE'
  ) {
    return cards.map((_, i) => i);
  }
  // Rank-count based categories.
  const byRank = new Map();
  cards.forEach((c, i) => {
    if (!byRank.has(c.rank)) byRank.set(c.rank, []);
    byRank.get(c.rank).push(i);
  });
  const out = [];
  if (category === 'FOUR_OF_A_KIND') {
    for (const ids of byRank.values()) if (ids.length === 4) out.push(...ids);
  } else if (category === 'THREE_OF_A_KIND') {
    for (const ids of byRank.values()) if (ids.length === 3) out.push(...ids);
  } else if (category === 'TWO_PAIR') {
    for (const ids of byRank.values()) if (ids.length === 2) out.push(...ids);
  } else if (category === 'JACKS_OR_BETTER') {
    for (const [rank, ids] of byRank) {
      if (ids.length === 2 && HIGH_PAIR_RANKS.has(rank)) out.push(...ids);
    }
  }
  return out;
}
