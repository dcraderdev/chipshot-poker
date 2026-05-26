// Five-Card Draw vs single bot opponent.
// Mounted from /games/draw.astro via init().
//
// State machine:
//   idle          -> waiting for "Deal"
//   draw          -> hero picks discards, hero presses "Draw"
//   bet           -> hero bets/checks; bot responds
//   showdown      -> reveal, payout, "Next Hand"
//
// All money is integer dollars. Ante = $10 per player.

import { freshDeck, shuffle, toShort, fromShort, RANK_LABEL, SUIT_GLYPH } from '../deck.js';
import { getBalance, adjustBalance, onBalanceChange } from '../bankroll.js';
import { recordHand } from '../history.js';
import { Hand } from 'pokersolver';

const ANTE = 10;
const BET_SIZES = [20, 50, 100];

const DEAL_STAGGER_MS = 90;
const DEAL_DUR_MS = 320;
const TOSS_DUR_MS = 320;
const FLIP_DUR_MS = 400;
const CHIP_FLY_MS = 480;

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---------- helpers ----------

const isRedSuit = (s) => s === 'h' || s === 'd';

function cardEl(card, { interactive = false, facedown = false, extraClass = '' } = {}) {
  const el = document.createElement('div');
  const colorClass = facedown ? '' : (isRedSuit(card.suit) ? 'is-red' : 'is-black');
  el.className = [
    'playing-card', 'pc-md',
    facedown ? 'is-facedown' : colorClass,
    interactive ? 'is-interactive' : '',
    extraClass,
  ].filter(Boolean).join(' ');
  el.dataset.rank = card.rank;
  el.dataset.suit = card.suit;
  if (facedown) {
    const back = document.createElement('div');
    back.className = 'pc-back';
    el.appendChild(back);
  } else {
    const glyph = SUIT_GLYPH[card.suit];
    const label = RANK_LABEL[card.rank];
    el.innerHTML = `
      <div class="pc-corner pc-tl"><span class="pc-rank">${label}</span><span class="pc-suit">${glyph}</span></div>
      <div class="pc-center">${glyph}</div>
      <div class="pc-corner pc-br"><span class="pc-rank">${label}</span><span class="pc-suit">${glyph}</span></div>
    `;
  }
  return el;
}

function shortToCard(s) { return fromShort(s); }
function cardsToShort(cards) { return cards.map(toShort); }

// ---------- bot AI ----------

// Decide which indices the bot keeps (returns Set of indices to KEEP).
function botKeepIndices(cards) {
  const RANK_ORDER = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
  const rankIdx = (r) => RANK_ORDER.indexOf(r);

  // Count rank groupings
  const byRank = {};
  cards.forEach((c, i) => { (byRank[c.rank] = byRank[c.rank] || []).push(i); });
  const groups = Object.values(byRank).filter((g) => g.length >= 2);

  // Pair or better — keep all paired cards, discard others
  if (groups.length > 0) {
    const keep = new Set();
    groups.forEach((g) => g.forEach((i) => keep.add(i)));
    // If trips or quads, keep them all; if pair, keep pair only (draw 3).
    return keep;
  }

  // 4-flush draw
  const bySuit = {};
  cards.forEach((c, i) => { (bySuit[c.suit] = bySuit[c.suit] || []).push(i); });
  for (const idxs of Object.values(bySuit)) {
    if (idxs.length === 4) return new Set(idxs);
  }

  // 4 to an open-ended straight
  const sorted = cards
    .map((c, i) => ({ i, v: rankIdx(c.rank) }))
    .sort((a, b) => a.v - b.v);
  // try every contiguous window of 4 with span === 3
  for (let start = 0; start <= sorted.length - 4; start++) {
    const win = sorted.slice(start, start + 4);
    const vals = win.map((x) => x.v);
    const uniq = [...new Set(vals)];
    if (uniq.length === 4 && uniq[3] - uniq[0] === 3) {
      return new Set(win.map((x) => x.i));
    }
  }

  // Otherwise keep top 2 (highest) and draw 3
  const top2 = sorted.slice(-2).map((x) => x.i);
  return new Set(top2);
}

function botPostDrawAction(handShort, heroBet) {
  // pokersolver rank: 1=high card, 2=pair, 3=two pair, 4=three-of-a-kind, ...
  const solved = Hand.solve(handShort);
  const rank = solved.rank; // numeric
  if (heroBet > 0) {
    if (rank >= 4) return { action: 'raise', amount: Math.min(heroBet * 2, 100) };
    if (rank >= 2) return { action: 'call' };
    return { action: 'fold' };
  } else {
    // hero checked
    if (rank >= 4) return { action: 'bet', amount: 50 };
    if (rank >= 3) return { action: 'bet', amount: 20 };
    return { action: 'check' };
  }
}

// ---------- main ----------

export function init() {
  const seatBot = document.querySelector('[data-seat-bot]');
  const seatHero = document.querySelector('[data-seat-hero]');
  const botCardsEl = document.querySelector('[data-bot-cards]');
  const heroCardsEl = document.querySelector('[data-hero-cards]');
  const potEl = document.querySelector('[data-pot]');
  const potChipEl = document.querySelector('[data-pot-chip]');
  const heroBankEl = document.querySelector('[data-hero-bank]');
  const botBankEl = document.querySelector('[data-bot-bank]');
  const actionBar = document.querySelector('[data-action-bar]');
  const logEl = document.querySelector('[data-game-log]');
  const lowChipsHint = document.querySelector('[data-low-chips]');
  const deckEl = document.querySelector('[data-deck]');
  const muckEl = document.querySelector('[data-muck]');
  const bannerEl = document.querySelector('[data-hand-banner]');

  if (!seatHero || !heroCardsEl || !actionBar) return;

  // ---------- animation helpers ----------

  function rectCenter(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function flyChip(fromEl, toEl, { red = false, delay = 0 } = {}) {
    if (prefersReducedMotion()) return;
    const from = rectCenter(fromEl);
    const to = rectCenter(toEl || potChipEl);
    if (!from || !to) return;
    const chip = document.createElement('span');
    chip.className = `chip-fly${red ? ' is-red' : ''}`;
    chip.style.left = `${from.x - 11}px`;
    chip.style.top = `${from.y - 11}px`;
    document.body.appendChild(chip);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const peakY = Math.min(dy * 0.4, -40);
    const anim = chip.animate(
      [
        { transform: 'translate(0,0) scale(0.6)', opacity: 0, offset: 0 },
        { transform: `translate(${dx * 0.45}px, ${peakY}px) scale(1.1)`, opacity: 1, offset: 0.4 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.85)`, opacity: 0.9, offset: 1 },
      ],
      { duration: CHIP_FLY_MS, delay, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'forwards' }
    );
    anim.onfinish = () => {
      chip.remove();
      pulsePot();
    };
  }

  function pulsePot() {
    if (!potChipEl || prefersReducedMotion()) return;
    potChipEl.classList.remove('is-pulsing');
    // force reflow so the animation restarts
    // eslint-disable-next-line no-unused-expressions
    void potChipEl.offsetWidth;
    potChipEl.classList.add('is-pulsing');
    setTimeout(() => potChipEl.classList.remove('is-pulsing'), 500);
  }

  function showHandBanner(text, kind = '') {
    if (!bannerEl) return;
    bannerEl.innerHTML = '';
    const inner = document.createElement('div');
    inner.className = `hand-banner-inner${kind === 'loss' ? ' is-loss' : ''}`;
    inner.textContent = text;
    bannerEl.appendChild(inner);
    bannerEl.hidden = false;
    const dur = prefersReducedMotion() ? 1600 : 1800;
    setTimeout(() => {
      bannerEl.hidden = true;
      bannerEl.innerHTML = '';
    }, dur);
  }

  // Set per-card --deal-dx/--deal-dy CSS vars so they animate from the deck position.
  function applyDealStagger(rowEl) {
    if (!rowEl || prefersReducedMotion()) return;
    const cards = rowEl.querySelectorAll('.playing-card');
    const deckCenter = rectCenter(deckEl);
    cards.forEach((c, i) => {
      let dx = 0, dy = -200;
      if (deckCenter) {
        const cr = c.getBoundingClientRect();
        dx = (deckCenter.x - (cr.left + cr.width / 2));
        dy = (deckCenter.y - (cr.top + cr.height / 2));
      }
      c.style.setProperty('--deal-dx', `${dx}px`);
      c.style.setProperty('--deal-dy', `${dy}px`);
      c.style.setProperty('--deal-rot', `${-6 + (i * 2)}deg`);
      c.style.animationDelay = `${i * DEAL_STAGGER_MS}ms`;
      c.classList.add('is-dealing-stagger');
      setTimeout(() => {
        c.classList.remove('is-dealing-stagger');
        c.style.animationDelay = '';
        c.style.removeProperty('--deal-dx');
        c.style.removeProperty('--deal-dy');
        c.style.removeProperty('--deal-rot');
      }, DEAL_DUR_MS + i * DEAL_STAGGER_MS + 50);
    });
  }

  function flipCards(rowEl) {
    if (!rowEl) return;
    const cards = rowEl.querySelectorAll('.playing-card');
    cards.forEach((c, i) => {
      c.style.animationDelay = `${i * 60}ms`;
      c.classList.add('is-flipping');
      setTimeout(() => {
        c.classList.remove('is-flipping');
        c.style.animationDelay = '';
      }, FLIP_DUR_MS + i * 60 + 30);
    });
  }

  function foldCards(rowEl) {
    if (!rowEl) return;
    const cards = rowEl.querySelectorAll('.playing-card');
    cards.forEach((c, i) => {
      c.style.setProperty('--fold-dx', `${(i - 2) * 8}px`);
      c.style.setProperty('--fold-rot', `${(i - 2) * 6 + 4}deg`);
      c.style.animationDelay = `${i * 40}ms`;
      c.classList.add('is-folding');
    });
  }

  // Bot has its own "stack" — not real money, just for show.
  let botStack = 1000;

  const state = {
    phase: 'idle', // idle | draw | bet | showdown
    deck: [],
    hero: [], // {rank, suit}
    bot: [],
    heroDiscards: new Set(), // indices marked to discard
    pot: 0,
    heroBet: 0,
    botBet: 0,
    heroDiscardsApplied: [], // record what was discarded
    botDiscardsApplied: [],
  };

  function log(msg, kind = '') {
    if (!logEl) return;
    const line = document.createElement('div');
    if (kind) line.className = `log-${kind}`;
    line.textContent = msg;
    logEl.prepend(line);
    while (logEl.children.length > 30) logEl.removeChild(logEl.lastChild);
  }

  function renderPot() {
    if (potEl) potEl.textContent = `$${state.pot}`;
  }
  function renderBanks() {
    if (heroBankEl) heroBankEl.textContent = `$${getBalance()}`;
    if (botBankEl) botBankEl.textContent = `$${botStack}`;
  }

  function renderHeroCards({ winIdx = new Set() } = {}) {
    heroCardsEl.innerHTML = '';
    state.hero.forEach((c, i) => {
      const interactive = state.phase === 'draw';
      const isWin = winIdx.has(i);
      const el = cardEl(c, { interactive, extraClass: isWin ? 'is-win' : '' });
      if (state.phase === 'draw') {
        if (state.heroDiscards.has(i)) el.classList.add('is-toss');
        else el.classList.add('is-keep');
      }
      el.addEventListener('click', () => {
        if (state.phase !== 'draw') return;
        if (state.heroDiscards.has(i)) {
          state.heroDiscards.delete(i);
        } else {
          if (state.heroDiscards.size >= 3) {
            log('You can discard at most 3 cards.');
            return;
          }
          state.heroDiscards.add(i);
        }
        renderHeroCards();
        renderActions();
      });
      heroCardsEl.appendChild(el);
    });
  }

  function renderBotCards({ reveal = false, winIdx = new Set() } = {}) {
    botCardsEl.innerHTML = '';
    state.bot.forEach((c, i) => {
      const isWin = winIdx.has(i);
      const el = cardEl(c, { facedown: !reveal, extraClass: isWin ? 'is-win' : '' });
      botCardsEl.appendChild(el);
    });
  }

  function clearActions() {
    actionBar.innerHTML = '';
  }
  function btn(label, { primary = false, danger = false, disabled = false } = {}, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = ['action-btn', primary ? 'is-primary' : '', danger ? 'is-danger' : ''].filter(Boolean).join(' ');
    b.textContent = label;
    if (disabled) b.disabled = true;
    if (onClick) b.addEventListener('click', onClick);
    actionBar.appendChild(b);
    return b;
  }

  function renderActions() {
    clearActions();
    if (state.phase === 'idle') {
      const canAnte = getBalance() >= ANTE;
      if (lowChipsHint) lowChipsHint.hidden = canAnte;
      btn('Deal', { primary: true, disabled: !canAnte }, dealHand);
      return;
    }
    if (lowChipsHint) lowChipsHint.hidden = true;
    if (state.phase === 'draw') {
      const n = state.heroDiscards.size;
      btn(n === 0 ? 'Stand pat' : `Draw ${n}`, { primary: true }, doDraw);
      return;
    }
    if (state.phase === 'bet') {
      btn('Check', {}, () => heroAct({ action: 'check' }));
      BET_SIZES.forEach((amt) => {
        const can = getBalance() >= amt;
        btn(`Bet $${amt}`, { disabled: !can }, () => heroAct({ action: 'bet', amount: amt }));
      });
      const allIn = getBalance();
      if (allIn > 0 && !BET_SIZES.includes(allIn)) {
        btn(`All-in $${allIn}`, { disabled: allIn <= 0 }, () => heroAct({ action: 'bet', amount: allIn }));
      }
      btn('Fold', { danger: true }, () => heroAct({ action: 'fold' }));
      return;
    }
    if (state.phase === 'showdown') {
      const canAnte = getBalance() >= ANTE;
      btn('Next Hand', { primary: true, disabled: !canAnte }, () => { resetTable(); renderActions(); });
      if (!canAnte && lowChipsHint) lowChipsHint.hidden = false;
      return;
    }
  }

  function resetTable() {
    state.phase = 'idle';
    state.deck = [];
    state.hero = [];
    state.bot = [];
    state.heroDiscards = new Set();
    state.pot = 0;
    state.heroBet = 0;
    state.botBet = 0;
    state.heroDiscardsApplied = [];
    state.botDiscardsApplied = [];
    heroCardsEl.innerHTML = '';
    botCardsEl.innerHTML = '';
    seatBot?.classList.remove('is-winner', 'is-folded');
    seatHero?.classList.remove('is-winner', 'is-folded');
    renderPot();
    renderBanks();
  }

  function dealHand() {
    if (getBalance() < ANTE) {
      log('Not enough chips to ante.', 'loss');
      return;
    }
    // Clear any leftover folded/dealing classes from the previous hand
    heroCardsEl.innerHTML = '';
    botCardsEl.innerHTML = '';
    if (bannerEl) { bannerEl.hidden = true; bannerEl.innerHTML = ''; }

    adjustBalance(-ANTE, { game: 'draw', reason: 'ante' });
    botStack -= ANTE;
    state.pot = ANTE * 2;
    state.deck = shuffle(freshDeck());
    state.hero = state.deck.splice(0, 5);
    state.bot = state.deck.splice(0, 5);
    state.heroDiscards = new Set();
    state.phase = 'draw';
    renderBanks();
    renderPot();
    renderHeroCards();
    renderBotCards({ reveal: false });
    // Stagger deal animations
    applyDealStagger(botCardsEl);
    applyDealStagger(heroCardsEl);
    // Ante chips fly into the pot
    flyChip(seatHero, potChipEl, { delay: 0 });
    flyChip(seatBot, potChipEl, { red: true, delay: 80 });
    renderActions();
    log(`New hand. Antes $${ANTE} each. Pot $${state.pot}.`);
  }

  function doDraw() {
    const dropIdx = [...state.heroDiscards].sort((a, b) => a - b);

    // Animate hero discards out toward the muck pile.
    const heroCardEls = [...heroCardsEl.querySelectorAll('.playing-card')];
    const reduced = prefersReducedMotion();
    if (!reduced && dropIdx.length > 0) {
      dropIdx.forEach((i, n) => {
        const el = heroCardEls[i];
        if (!el) return;
        // Toss direction biased toward the muck pile (left side)
        const muckCenter = rectCenter(muckEl);
        const cardCenter = rectCenter(el);
        if (muckCenter && cardCenter) {
          const dx = muckCenter.x - cardCenter.x;
          el.style.setProperty('--toss-dx', `${dx}px`);
        }
        el.style.animationDelay = `${n * 50}ms`;
        el.classList.remove('is-toss');
        el.classList.add('is-tossing');
      });
    }

    const finalize = () => {
      // Hero state: actually drop selected indices and refill
      state.heroDiscardsApplied = dropIdx.map((i) => toShort(state.hero[i]));
      [...dropIdx].reverse().forEach((i) => { state.hero.splice(i, 1); });
      while (state.hero.length < 5) state.hero.push(state.deck.shift());

      // Bot discards
      const keep = botKeepIndices(state.bot);
      const botDrop = [];
      for (let i = 0; i < state.bot.length; i++) {
        if (!keep.has(i)) botDrop.push(i);
      }
      state.botDiscardsApplied = botDrop.map((i) => toShort(state.bot[i]));
      botDrop.sort((a, b) => b - a).forEach((i) => state.bot.splice(i, 1));
      while (state.bot.length < 5) state.bot.push(state.deck.shift());

      log(`You drew ${dropIdx.length}. Bot drew ${botDrop.length}.`);

      state.heroDiscards = new Set();
      state.phase = 'bet';
      renderHeroCards();
      renderBotCards({ reveal: false });
      // Re-deal the new cards from the deck
      applyDealStagger(heroCardsEl);
      applyDealStagger(botCardsEl);
      renderActions();
    };

    if (!reduced && dropIdx.length > 0) {
      setTimeout(finalize, TOSS_DUR_MS + 60);
    } else {
      finalize();
    }
  }

  function heroAct({ action, amount = 0 }) {
    if (action === 'fold') {
      log('You fold.', 'loss');
      finish({ heroFolded: true });
      return;
    }
    if (action === 'check') {
      state.heroBet = 0;
      log('You check.');
      botRespond();
      return;
    }
    if (action === 'bet') {
      const bal = getBalance();
      const bet = Math.min(amount, bal);
      if (bet <= 0) return;
      adjustBalance(-bet, { game: 'draw', reason: 'bet' });
      state.pot += bet;
      state.heroBet = bet;
      renderBanks();
      renderPot();
      flyChip(seatHero, potChipEl);
      if (bet >= 50) flyChip(seatHero, potChipEl, { delay: 80 });
      log(`You bet $${bet}.`);
      botRespond();
    }
  }

  function botRespond() {
    const decision = botPostDrawAction(cardsToShort(state.bot), state.heroBet);
    if (decision.action === 'fold') {
      log('Bot folds.', 'win');
      finish({ botFolded: true });
      return;
    }
    if (decision.action === 'check') {
      log('Bot checks.');
      finish({});
      return;
    }
    if (decision.action === 'call') {
      const call = Math.min(state.heroBet, botStack);
      botStack -= call;
      state.pot += call;
      state.botBet = call;
      log(`Bot calls $${call}.`);
      renderBanks();
      renderPot();
      flyChip(seatBot, potChipEl, { red: true });
      finish({});
      return;
    }
    if (decision.action === 'bet' || decision.action === 'raise') {
      const amt = Math.min(decision.amount || 20, botStack);
      botStack -= amt;
      state.pot += amt;
      state.botBet = amt;
      log(decision.action === 'raise' ? `Bot raises $${amt}.` : `Bot bets $${amt}.`);
      renderBanks();
      renderPot();
      flyChip(seatBot, potChipEl, { red: true });
      if (amt >= 50) flyChip(seatBot, potChipEl, { red: true, delay: 80 });
      // give hero a call/fold opportunity
      offerCallOrFold(amt);
    }
  }

  function offerCallOrFold(amt) {
    clearActions();
    const call = Math.min(amt, getBalance());
    btn(`Call $${call}`, { primary: true, disabled: call <= 0 }, () => {
      adjustBalance(-call, { game: 'draw', reason: 'call' });
      state.pot += call;
      state.heroBet += call;
      renderBanks();
      renderPot();
      flyChip(seatHero, potChipEl);
      log(`You call $${call}.`);
      finish({});
    });
    btn('Fold', { danger: true }, () => {
      log('You fold.', 'loss');
      finish({ heroFolded: true });
    });
  }

  function finish({ heroFolded = false, botFolded = false } = {}) {
    state.phase = 'showdown';
    let result, delta, summary;
    const heroShort = cardsToShort(state.hero);
    const botShort = cardsToShort(state.bot);

    if (heroFolded) {
      // bot takes pot (already deducted hero's bets)
      botStack += state.pot;
      result = 'loss';
      delta = -(ANTE + state.heroBet);
      summary = `You folded. Bot wins $${state.pot}.`;
      seatBot?.classList.add('is-winner');
      seatHero?.classList.add('is-folded');
      // Hero folds: hero cards slide off, bot reveals its hand (flip).
      foldCards(heroCardsEl);
      renderBotCards({ reveal: true });
      flipCards(botCardsEl);
      showHandBanner('You fold', 'loss');
      setTimeout(() => flyChip(potChipEl, seatBot, { red: true }), 250);
    } else if (botFolded) {
      adjustBalance(state.pot, { game: 'draw', reason: 'win' });
      result = 'win';
      delta = state.pot - (ANTE + state.heroBet);
      summary = `Bot folded. You win $${state.pot}.`;
      seatHero?.classList.add('is-winner');
      seatBot?.classList.add('is-folded');
      foldCards(botCardsEl);
      showHandBanner('Bot folds — pot is yours');
      setTimeout(() => flyChip(potChipEl, seatHero), 250);
    } else {
      // Showdown
      const heroSolved = Hand.solve(heroShort);
      const botSolved = Hand.solve(botShort);
      heroSolved.name = 'Hero';
      botSolved.name = 'Bot';
      const winners = Hand.winners([heroSolved, botSolved]);
      const heroDesc = heroSolved.descr || heroSolved.name;
      const botDesc = botSolved.descr || botSolved.name;

      // Map winning card shorts back to indices
      const winShorts = new Set();
      winners.forEach((w) => {
        (w.cards || []).forEach((c) => winShorts.add(`${c.value}${c.suit}`));
      });
      const heroWinIdx = new Set();
      const botWinIdx = new Set();
      state.hero.forEach((c, i) => { if (winShorts.has(toShort(c))) heroWinIdx.add(i); });
      state.bot.forEach((c, i) => { if (winShorts.has(toShort(c))) botWinIdx.add(i); });

      const heroWon = winners.includes(heroSolved);
      const botWon = winners.includes(botSolved);

      if (heroWon && botWon) {
        // split
        const half = Math.floor(state.pot / 2);
        const rem = state.pot - half * 2;
        adjustBalance(half + rem, { game: 'draw', reason: 'split' });
        botStack += half;
        result = 'push';
        delta = (half + rem) - (ANTE + state.heroBet);
        summary = `Split pot. Both held ${heroDesc}.`;
        seatHero?.classList.add('is-winner');
        seatBot?.classList.add('is-winner');
      } else if (heroWon) {
        adjustBalance(state.pot, { game: 'draw', reason: 'win' });
        result = 'win';
        delta = state.pot - (ANTE + state.heroBet);
        summary = `${heroDesc} beats ${botDesc}.`;
        seatHero?.classList.add('is-winner');
      } else {
        botStack += state.pot;
        result = 'loss';
        delta = -(ANTE + state.heroBet);
        summary = `${botDesc} beats ${heroDesc}.`;
        seatBot?.classList.add('is-winner');
      }

      renderHeroCards({ winIdx: heroWinIdx });
      renderBotCards({ reveal: true, winIdx: botWinIdx });
      // Flip the bot cards from face-down to face-up
      flipCards(botCardsEl);
      log(summary, result === 'win' ? 'win' : (result === 'loss' ? 'loss' : ''));

      // Show hand-rank banner after the flip lands
      const bannerKind = result === 'loss' ? 'loss' : '';
      const bannerText = result === 'push'
        ? `Split pot · ${heroDesc}`
        : (heroWon ? heroDesc : botDesc);
      setTimeout(() => showHandBanner(bannerText, bannerKind), 420);

      // Pot sweep
      setTimeout(() => {
        if (heroWon && botWon) {
          flyChip(potChipEl, seatHero);
          flyChip(potChipEl, seatBot, { red: true, delay: 80 });
        } else if (heroWon) {
          flyChip(potChipEl, seatHero);
          flyChip(potChipEl, seatHero, { delay: 90 });
        } else {
          flyChip(potChipEl, seatBot, { red: true });
          flyChip(potChipEl, seatBot, { red: true, delay: 90 });
        }
      }, 700);
    }

    renderBanks();
    renderPot();

    recordHand('draw', {
      result,
      delta,
      summary,
      payload: {
        heroFinal: heroShort,
        botFinal: botShort,
        heroDiscards: state.heroDiscardsApplied,
        botDiscards: state.botDiscardsApplied,
        pot: state.pot,
      },
    });

    renderActions();
  }

  // Keep bank-display fresh if balance changes elsewhere
  onBalanceChange(() => renderBanks());

  // initial paint
  renderBanks();
  renderPot();
  renderActions();
}
