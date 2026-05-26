// Pure blackjack rules + hand evaluator.
// Card shape: { rank: '2'..'9'|'T'|'J'|'Q'|'K'|'A', suit: 's'|'h'|'d'|'c', id: 'As' }
// No state, no I/O — all functions are pure.

export const MIN_BET = 5;
export const MAX_BET = 500;
export const BLACKJACK_PAYOUT = 1.5; // 3:2

// Card -> numeric value (Ace counts as 1 here; soft-handling done in handTotal).
export function cardValue(card) {
  const r = card.rank;
  if (r === 'A') return 1;
  if (r === 'T' || r === 'J' || r === 'Q' || r === 'K') return 10;
  return Number(r);
}

// For split eligibility — T/J/Q/K all share rank-value 10.
export function splitRankKey(card) {
  const r = card.rank;
  if (r === 'T' || r === 'J' || r === 'Q' || r === 'K') return '10';
  return r;
}

// Compute best total. Returns { total, soft, bust }.
// "soft" means at least one Ace is counted as 11.
export function handTotal(cards) {
  if (!cards || !cards.length) return { total: 0, soft: false, bust: false };
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (c.rank === 'A') aces++;
  }
  // Upgrade aces from 1 -> 11 (add 10) while it stays <= 21.
  let soft = false;
  let acesUpgraded = 0;
  while (acesUpgraded < aces && total + 10 <= 21) {
    total += 10;
    acesUpgraded++;
  }
  soft = acesUpgraded > 0;
  return { total, soft, bust: total > 21 };
}

export function isBlackjack(cards) {
  if (!cards || cards.length !== 2) return false;
  const { total } = handTotal(cards);
  return total === 21;
}

export function canSplit(cards, bankroll, bet) {
  if (!cards || cards.length !== 2) return false;
  if (splitRankKey(cards[0]) !== splitRankKey(cards[1])) return false;
  if (bankroll < bet) return false;
  return true;
}

export function canDouble(cards, bankroll, bet) {
  if (!cards || cards.length !== 2) return false;
  if (bankroll < bet) return false;
  return true;
}

// Dealer policy: hits on soft 17, stands on hard 17+.
export function dealerShouldHit(cards) {
  const { total, soft, bust } = handTotal(cards);
  if (bust) return false;
  if (total < 17) return true;
  if (total === 17 && soft) return true;
  return false;
}

// Settle one player hand vs the dealer's final hand.
// Returns { result, multiplier } where multiplier is what the player gets BACK
// per unit of their (already-debited) bet on this hand:
//   blackjack -> 2.5  (stake + 1.5x winnings)
//   win       -> 2    (stake + 1x winnings)
//   push      -> 1    (stake returned)
//   lose      -> 0
// `playerBlackjackEligible` should be true only for the original 2-card hand
// (not for split hands or doubled hands that hit 21 on 3 cards).
export function settle(playerCards, dealerCards, { playerBlackjackEligible = true } = {}) {
  const p = handTotal(playerCards);
  const d = handTotal(dealerCards);
  const pBJ = playerBlackjackEligible && isBlackjack(playerCards);
  const dBJ = isBlackjack(dealerCards);

  if (p.bust) return { result: 'lose', multiplier: 0 };
  if (pBJ && dBJ) return { result: 'push', multiplier: 1 };
  if (pBJ) return { result: 'blackjack', multiplier: 1 + BLACKJACK_PAYOUT }; // 2.5
  if (dBJ) return { result: 'lose', multiplier: 0 };
  if (d.bust) return { result: 'win', multiplier: 2 };
  if (p.total > d.total) return { result: 'win', multiplier: 2 };
  if (p.total < d.total) return { result: 'lose', multiplier: 0 };
  return { result: 'push', multiplier: 1 };
}

// Format a hand total for display: "12" or "12 / 22" for soft, "21" capped, "Bust" if busted.
export function formatTotal(cards) {
  if (!cards || !cards.length) return '';
  const { total, soft, bust } = handTotal(cards);
  if (bust) return `${total} • Bust`;
  if (soft && total !== 21) return `${total - 10} / ${total}`;
  return String(total);
}

// Clamp a proposed bet against bankroll + table limits.
export function clampBet(amount, bankroll) {
  const cap = Math.min(bankroll, MAX_BET);
  if (cap < MIN_BET) return 0;
  return Math.max(MIN_BET, Math.min(cap, Math.round(amount)));
}
