// Vanilla JS SVG card renderer. Use renderCard({rank,suit}, {faceDown,small}) -> string.

import { SUIT_GLYPH, SUIT_COLOR } from './deck.js';

export function renderCard(card, opts = {}) {
  const w = opts.small ? 44 : 64;
  const h = opts.small ? 64 : 92;
  const fontSize = opts.small ? 12 : 16;
  const pipSize = opts.small ? 14 : 22;
  if (opts.faceDown || !card) {
    return `<div class="cs-card cs-card--back" style="width:${w}px;height:${h}px;">
      <div class="cs-card__back-pattern"></div>
    </div>`;
  }
  const color = SUIT_COLOR[card.suit] === 'red' ? 'var(--color-card-red)' : 'var(--color-card-ink)';
  const glyph = SUIT_GLYPH[card.suit];
  const rankDisplay = card.rank === 'T' ? '10' : card.rank;
  return `<div class="cs-card cs-card--face" style="width:${w}px;height:${h}px;color:${color}" data-card="${card.rank}${card.suit}">
    <div class="cs-card__corner cs-card__corner--tl" style="font-size:${fontSize}px;line-height:1;">
      <span class="cs-card__rank">${rankDisplay}</span>
      <span class="cs-card__suit">${glyph}</span>
    </div>
    <div class="cs-card__pip" style="font-size:${pipSize}px;">${glyph}</div>
    <div class="cs-card__corner cs-card__corner--br" style="font-size:${fontSize}px;line-height:1;">
      <span class="cs-card__rank">${rankDisplay}</span>
      <span class="cs-card__suit">${glyph}</span>
    </div>
  </div>`;
}

// Helper: render an array as a hand row.
export function renderHand(cards, opts = {}) {
  const overlap = opts.overlap || 0;
  const items = cards.map((c, i) => {
    const offset = i * overlap;
    return `<div class="cs-hand__slot" style="margin-left:${i === 0 ? 0 : offset}px;">${renderCard(c, opts)}</div>`;
  });
  return `<div class="cs-hand">${items.join('')}</div>`;
}
