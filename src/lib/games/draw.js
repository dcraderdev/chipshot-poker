// Five-Card Draw vs single bot opponent.
// Mounted from /games/draw.astro via init().
//
// State machine (UNCHANGED — presentation layer only):
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
import { setBadge, clearBadge, setActiveSeat } from './badge.js';
import { createActionLog } from './log.js';
import {
  playChip, playDeal, playFlip, playWin, playLose, playShuffle,
  playBet, playCall, playRaise, playFold, playCheck,
} from '../sfx.js';

const ANTE = 10;
const BET_SIZES = [20, 50, 100];

// Bot pacing (ms) — slowed so user can read each beat.
const BOT_THINK_MIN = 600;
const BOT_THINK_MAX = 1200;
const SHOWDOWN_REVEAL_DELAY = 500;
const BADGE_HOLD_MS = 1500;

// ---------- helpers ----------

const isRedSuit = (s) => s === 'h' || s === 'd';
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const botThinkDelay = () =>
  BOT_THINK_MIN + Math.floor(Math.random() * (BOT_THINK_MAX - BOT_THINK_MIN));

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

// ---------- bot AI (unchanged) ----------

function botKeepIndices(cards) {
  const RANK_ORDER = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
  const rankIdx = (r) => RANK_ORDER.indexOf(r);

  const byRank = {};
  cards.forEach((c, i) => { (byRank[c.rank] = byRank[c.rank] || []).push(i); });
  const groups = Object.values(byRank).filter((g) => g.length >= 2);

  if (groups.length > 0) {
    const keep = new Set();
    groups.forEach((g) => g.forEach((i) => keep.add(i)));
    return keep;
  }

  const bySuit = {};
  cards.forEach((c, i) => { (bySuit[c.suit] = bySuit[c.suit] || []).push(i); });
  for (const idxs of Object.values(bySuit)) {
    if (idxs.length === 4) return new Set(idxs);
  }

  const sorted = cards
    .map((c, i) => ({ i, v: rankIdx(c.rank) }))
    .sort((a, b) => a.v - b.v);
  for (let start = 0; start <= sorted.length - 4; start++) {
    const win = sorted.slice(start, start + 4);
    const vals = win.map((x) => x.v);
    const uniq = [...new Set(vals)];
    if (uniq.length === 4 && uniq[3] - uniq[0] === 3) {
      return new Set(win.map((x) => x.i));
    }
  }

  const top2 = sorted.slice(-2).map((x) => x.i);
  return new Set(top2);
}

function botPostDrawAction(handShort, heroBet) {
  const solved = Hand.solve(handShort);
  const rank = solved.rank;
  if (heroBet > 0) {
    if (rank >= 4) return { action: 'raise', amount: Math.min(heroBet * 2, 100) };
    if (rank >= 2) return { action: 'call' };
    return { action: 'fold' };
  } else {
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
  const heroBankEl = document.querySelector('[data-hero-bank]');
  const botBankEl = document.querySelector('[data-bot-bank]');
  const actionBar = document.querySelector('[data-action-bar]');
  const logEl = document.querySelector('[data-game-log]');
  const lowChipsHint = document.querySelector('[data-low-chips]');
  const drawStatusEl = document.querySelector('[data-draw-status]');
  const handRevealEl = document.querySelector('[data-hand-reveal]');

  if (!seatHero || !heroCardsEl || !actionBar) return;

  const actionLog = createActionLog(logEl, { visible: 8 });

  let botStack = 1000;
  let busy = false; // disables clicks during bot animations

  const state = {
    phase: 'idle',
    deck: [],
    hero: [],
    bot: [],
    heroDiscards: new Set(),
    pot: 0,
    heroBet: 0,
    botBet: 0,
    heroDiscardsApplied: [],
    botDiscardsApplied: [],
  };

  function log(msg, kind = '') {
    if (actionLog) actionLog.push(msg, kind);
  }

  function renderPot() { if (potEl) potEl.textContent = `$${state.pot}`; }
  function renderBanks() {
    if (heroBankEl) heroBankEl.textContent = `$${getBalance()}`;
    if (botBankEl) botBankEl.textContent = `$${botStack}`;
  }

  function setTurn(who) {
    // who: 'hero' | 'bot' | null
    if (who === 'hero') setActiveSeat([seatHero, seatBot], seatHero);
    else if (who === 'bot') setActiveSeat([seatHero, seatBot], seatBot);
    else setActiveSeat([seatHero, seatBot], null);
  }

  function showDrawStatus(holdN, dropN) {
    if (!drawStatusEl) return;
    drawStatusEl.hidden = false;
    drawStatusEl.innerHTML = `
      <span class="draw-status">
        <span><span class="ds-hold">HOLD ${holdN}</span></span>
        <span class="ds-sep">·</span>
        <span><span class="ds-drop">DRAW ${dropN}</span></span>
      </span>`;
  }
  function hideDrawStatus() {
    if (!drawStatusEl) return;
    drawStatusEl.hidden = true;
    drawStatusEl.innerHTML = '';
  }

  function showHandReveal(heroDesc, botDesc, outcome) {
    if (!handRevealEl) return;
    const cls = outcome.kind === 'win' ? 'win' : outcome.kind === 'loss' ? 'loss' : 'push';
    handRevealEl.hidden = false;
    handRevealEl.innerHTML = `
      <div class="hand-reveal">
        <div class="hand-reveal__row">
          <span class="hand-reveal__label">YOU</span>
          <span class="hand-reveal__value">${heroDesc}</span>
        </div>
        <div class="hand-reveal__row">
          <span class="hand-reveal__label">BOT</span>
          <span class="hand-reveal__value">${botDesc}</span>
        </div>
        <div class="hand-reveal__outcome hand-reveal__outcome--${cls}">${outcome.text}</div>
      </div>`;
  }
  function hideHandReveal() {
    if (!handRevealEl) return;
    handRevealEl.hidden = true;
    handRevealEl.innerHTML = '';
  }

  function renderHeroCards({ winIdx = new Set() } = {}) {
    heroCardsEl.innerHTML = '';
    state.hero.forEach((c, i) => {
      const interactive = state.phase === 'draw' && !busy;
      const isWin = winIdx.has(i);
      const el = cardEl(c, { interactive, extraClass: isWin ? 'is-win' : '' });
      if (state.phase === 'draw') {
        if (state.heroDiscards.has(i)) el.classList.add('is-discard');
        else el.classList.add('is-held');
      }
      el.addEventListener('click', () => {
        if (state.phase !== 'draw' || busy) return;
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
        const holdN = 5 - state.heroDiscards.size;
        showDrawStatus(holdN, state.heroDiscards.size);
        renderActions();
      });
      heroCardsEl.appendChild(el);
    });
  }

  function renderBotCards({ reveal = false, winIdx = new Set(), flip = false } = {}) {
    botCardsEl.innerHTML = '';
    state.bot.forEach((c, i) => {
      const isWin = winIdx.has(i);
      const extra = [isWin ? 'is-win' : '', reveal && flip ? 'is-flipping' : ''].filter(Boolean).join(' ');
      const el = cardEl(c, { facedown: !reveal, extraClass: extra });
      botCardsEl.appendChild(el);
    });
  }

  function clearActions() { actionBar.innerHTML = ''; }
  function btn(label, { primary = false, danger = false, disabled = false } = {}, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = ['action-btn', primary ? 'is-primary' : '', danger ? 'is-danger' : ''].filter(Boolean).join(' ');
    b.textContent = label;
    if (disabled || busy) b.disabled = true;
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
    busy = false;
    heroCardsEl.innerHTML = '';
    botCardsEl.innerHTML = '';
    seatBot?.classList.remove('is-winner', 'is-folded');
    seatHero?.classList.remove('is-winner', 'is-folded');
    clearBadge(seatHero);
    clearBadge(seatBot);
    setTurn(null);
    hideDrawStatus();
    hideHandReveal();
    renderPot();
    renderBanks();
  }

  function dealHand() {
    if (getBalance() < ANTE) {
      log('Not enough chips to ante.', 'loss');
      return;
    }
    hideHandReveal();
    adjustBalance(-ANTE, { game: 'draw', reason: 'ante' });
    botStack -= ANTE;
    state.pot = ANTE * 2;
    state.deck = shuffle(freshDeck());
    state.hero = state.deck.splice(0, 5);
    state.bot = state.deck.splice(0, 5);
    state.heroDiscards = new Set();
    state.phase = 'draw';
    seatBot?.classList.remove('is-winner', 'is-folded');
    seatHero?.classList.remove('is-winner', 'is-folded');
    playShuffle();
    setTimeout(playDeal, 200);
    renderBanks();
    renderPot();
    renderHeroCards();
    renderBotCards({ reveal: false });
    showDrawStatus(5, 0);
    setBadge(seatHero, 'ante', `ANTE $${ANTE}`, { clearAfter: BADGE_HOLD_MS });
    setBadge(seatBot, 'ante', `ANTE $${ANTE}`, { clearAfter: BADGE_HOLD_MS });
    setTurn('hero');
    log(`New hand. Antes $${ANTE} each. Pot $${state.pot}.`);
    renderActions();
  }

  async function doDraw() {
    if (busy) return;
    busy = true;
    setTurn(null);

    // Hero discards
    const dropIdx = [...state.heroDiscards].sort((a, b) => a - b);
    const heroDropN = dropIdx.length;
    state.heroDiscardsApplied = dropIdx.map((i) => toShort(state.hero[i]));
    dropIdx.reverse().forEach((i) => { state.hero.splice(i, 1); });
    while (state.hero.length < 5) state.hero.push(state.deck.shift());

    if (heroDropN === 0) {
      setBadge(seatHero, 'standpat', 'STAND PAT', { clearAfter: BADGE_HOLD_MS });
      log('You stand pat.', 'draw');
    } else {
      setBadge(seatHero, 'draw', `DRAW ${heroDropN}`, { clearAfter: BADGE_HOLD_MS });
      log(`You hold ${5 - heroDropN}, draw ${heroDropN}.`, 'draw');
    }
    playDeal();

    hideDrawStatus();
    state.heroDiscards = new Set();
    renderHeroCards();

    // Telegraph + bot discards
    await sleep(botThinkDelay());
    const keep = botKeepIndices(state.bot);
    const botDrop = [];
    for (let i = 0; i < state.bot.length; i++) {
      if (!keep.has(i)) botDrop.push(i);
    }
    state.botDiscardsApplied = botDrop.map((i) => toShort(state.bot[i]));
    botDrop.sort((a, b) => b - a).forEach((i) => state.bot.splice(i, 1));
    while (state.bot.length < 5) state.bot.push(state.deck.shift());

    if (botDrop.length === 0) {
      setBadge(seatBot, 'standpat', 'STAND PAT', { clearAfter: BADGE_HOLD_MS });
      log('Bot stands pat.', 'draw');
    } else {
      setBadge(seatBot, 'draw', `DRAW ${botDrop.length}`, { clearAfter: BADGE_HOLD_MS });
      log(`Bot holds ${5 - botDrop.length}, draws ${botDrop.length}.`, 'draw');
    }
    playDeal();

    state.phase = 'bet';
    renderBotCards({ reveal: false });
    setTurn('hero');
    busy = false;
    renderActions();
  }

  function heroAct({ action, amount = 0 }) {
    if (busy) return;
    if (action === 'fold') {
      setBadge(seatHero, 'fold', 'FOLD', { clearAfter: BADGE_HOLD_MS });
      playFold();
      log('You fold.', 'loss');
      finish({ heroFolded: true });
      return;
    }
    if (action === 'check') {
      state.heroBet = 0;
      setBadge(seatHero, 'check', 'CHECK', { clearAfter: BADGE_HOLD_MS });
      playCheck();
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
      setBadge(seatHero, 'bet', `BET $${bet}`, { clearAfter: BADGE_HOLD_MS });
      playBet();
      renderBanks();
      renderPot();
      log(`You bet $${bet}.`, 'bet');
      botRespond();
    }
  }

  async function botRespond() {
    busy = true;
    setTurn('bot');
    renderActions(); // disables buttons via `busy`

    // Bot telegraph: thinking pause
    await sleep(botThinkDelay());

    const decision = botPostDrawAction(cardsToShort(state.bot), state.heroBet);

    if (decision.action === 'fold') {
      setBadge(seatBot, 'fold', 'FOLD', { clearAfter: BADGE_HOLD_MS });
      playFold();
      log('Bot folds.', 'win');
      busy = false;
      finish({ botFolded: true });
      return;
    }
    if (decision.action === 'check') {
      setBadge(seatBot, 'check', 'CHECK', { clearAfter: BADGE_HOLD_MS });
      playCheck();
      log('Bot checks.');
      busy = false;
      finish({});
      return;
    }
    if (decision.action === 'call') {
      const call = Math.min(state.heroBet, botStack);
      botStack -= call;
      state.pot += call;
      state.botBet = call;
      setBadge(seatBot, 'call', `CALL $${call}`, { clearAfter: BADGE_HOLD_MS });
      playCall();
      log(`Bot calls $${call}.`, 'bet');
      renderBanks();
      renderPot();
      busy = false;
      finish({});
      return;
    }
    if (decision.action === 'bet' || decision.action === 'raise') {
      const amt = Math.min(decision.amount || 20, botStack);
      botStack -= amt;
      state.pot += amt;
      state.botBet = amt;
      const isRaise = decision.action === 'raise';
      setBadge(seatBot, isRaise ? 'raise' : 'bet',
        isRaise ? `RAISE +$${amt}` : `BET $${amt}`,
        { clearAfter: BADGE_HOLD_MS });
      if (isRaise) playRaise(); else playBet();
      log(isRaise ? `Bot raises $${amt}.` : `Bot bets $${amt}.`, 'bet');
      renderBanks();
      renderPot();
      busy = false;
      offerCallOrFold(amt);
    }
  }

  function offerCallOrFold(amt) {
    setTurn('hero');
    clearActions();
    const call = Math.min(amt, getBalance());
    btn(`Call $${call}`, { primary: true, disabled: call <= 0 }, () => {
      adjustBalance(-call, { game: 'draw', reason: 'call' });
      state.pot += call;
      state.heroBet += call;
      setBadge(seatHero, 'call', `CALL $${call}`, { clearAfter: BADGE_HOLD_MS });
      playCall();
      renderBanks();
      renderPot();
      log(`You call $${call}.`, 'bet');
      finish({});
    });
    btn('Fold', { danger: true }, () => {
      setBadge(seatHero, 'fold', 'FOLD', { clearAfter: BADGE_HOLD_MS });
      playFold();
      log('You fold.', 'loss');
      finish({ heroFolded: true });
    });
  }

  async function finish({ heroFolded = false, botFolded = false } = {}) {
    state.phase = 'showdown';
    setTurn(null);
    let result, delta, summary;
    const heroShort = cardsToShort(state.hero);
    const botShort = cardsToShort(state.bot);

    if (heroFolded) {
      botStack += state.pot;
      result = 'loss';
      delta = -(ANTE + state.heroBet);
      summary = `You folded. Bot wins $${state.pot}.`;
      seatBot?.classList.add('is-winner');
      seatHero?.classList.add('is-folded');
      setBadge(seatBot, 'win', `WIN $${state.pot}`);
      playLose();
      renderBotCards({ reveal: true, flip: true });
      log(summary, 'loss');
    } else if (botFolded) {
      adjustBalance(state.pot, { game: 'draw', reason: 'win' });
      result = 'win';
      delta = state.pot - (ANTE + state.heroBet);
      summary = `Bot folded. You win $${state.pot}.`;
      seatHero?.classList.add('is-winner');
      seatBot?.classList.add('is-folded');
      setBadge(seatHero, 'win', `WIN $${state.pot}`);
      playWin();
      renderBotCards({ reveal: true, flip: true });
      log(summary, 'win');
    } else {
      // Both stay in — true showdown.
      setBadge(seatHero, 'showdown', 'SHOWDOWN', { clearAfter: SHOWDOWN_REVEAL_DELAY + 200 });
      setBadge(seatBot, 'showdown', 'SHOWDOWN', { clearAfter: SHOWDOWN_REVEAL_DELAY + 200 });
      log('Showdown.', 'showdown');

      // 500ms pause before simultaneous flip
      await sleep(SHOWDOWN_REVEAL_DELAY);

      const heroSolved = Hand.solve(heroShort);
      const botSolved = Hand.solve(botShort);
      heroSolved.name = 'Hero';
      botSolved.name = 'Bot';
      const winners = Hand.winners([heroSolved, botSolved]);
      const heroDesc = heroSolved.descr || heroSolved.name;
      const botDesc = botSolved.descr || botSolved.name;

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

      // Simultaneous flip
      playFlip();
      renderBotCards({ reveal: true, winIdx: botWinIdx, flip: true });
      renderHeroCards({ winIdx: heroWinIdx });

      let outcome;
      if (heroWon && botWon) {
        const half = Math.floor(state.pot / 2);
        const rem = state.pot - half * 2;
        adjustBalance(half + rem, { game: 'draw', reason: 'split' });
        botStack += half;
        result = 'push';
        delta = (half + rem) - (ANTE + state.heroBet);
        summary = `Split pot. Both held ${heroDesc}.`;
        seatHero?.classList.add('is-winner');
        seatBot?.classList.add('is-winner');
        setBadge(seatHero, 'win', `SPLIT $${half + rem}`);
        setBadge(seatBot, 'win', `SPLIT $${half}`);
        outcome = { kind: 'push', text: `SPLIT POT — ${heroDesc.toUpperCase()}` };
      } else if (heroWon) {
        adjustBalance(state.pot, { game: 'draw', reason: 'win' });
        result = 'win';
        delta = state.pot - (ANTE + state.heroBet);
        summary = `${heroDesc} beats ${botDesc}. You win $${state.pot}.`;
        seatHero?.classList.add('is-winner');
        setBadge(seatHero, 'win', `WIN $${state.pot}`);
        outcome = { kind: 'win', text: `YOU WIN — ${heroDesc.toUpperCase()}` };
      } else {
        botStack += state.pot;
        result = 'loss';
        delta = -(ANTE + state.heroBet);
        summary = `${botDesc} beats ${heroDesc}. Bot wins $${state.pot}.`;
        seatBot?.classList.add('is-winner');
        setBadge(seatBot, 'win', `WIN $${state.pot}`);
        outcome = { kind: 'loss', text: `BOT WINS — ${botDesc.toUpperCase()}` };
      }

      showHandReveal(heroDesc.toUpperCase(), botDesc.toUpperCase(), outcome);

      // Hand-rank-tinted chime
      if (result === 'win') playWin();
      else if (result === 'loss') playLose();
      else { playWin(); /* small chime for push too */ }

      log(summary, result === 'win' ? 'win' : (result === 'loss' ? 'loss' : 'showdown'));
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

  onBalanceChange(() => renderBanks());

  renderBanks();
  renderPot();
  renderActions();
}
