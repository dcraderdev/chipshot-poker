// Texas Hold'em game engine. Pure logic — no DOM, no audio.
// Use createGame(opts) to construct, then call the action methods.
// The UI layer is responsible for animating between states and prompting
// the human when state.toAct === 0.

import { freshShuffled } from '../deck.js';
import { evaluate, winners as evalWinners } from '../poker-eval.js';

export const SMALL_BLIND = 5;
export const BIG_BLIND = 10;
export const STARTING_STACK = 1000;
export const BOT_RELOAD = 400;
export const NUM_SEATS = 4;

export const STREETS = ['preflop', 'flop', 'turn', 'river', 'showdown'];

// ---------- helpers ----------

export function nextLivePlayer(players, from) {
  const n = players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (from + step) % n;
    const p = players[idx];
    if (!p.folded && !p.sittingOut) return idx;
  }
  return -1;
}

export function activePlayers(players) {
  return players.filter((p) => !p.folded && !p.sittingOut);
}

export function playersInHand(players) {
  return players.filter((p) => !p.folded && !p.sittingOut);
}

// Players who can still take voluntary action (have chips remaining).
export function playersCanAct(players) {
  return players.filter((p) => !p.folded && !p.sittingOut && p.stack > 0);
}

export function highestBet(players) {
  let max = 0;
  for (const p of players) if (p.bet > max) max = p.bet;
  return max;
}

// ---------- engine factory ----------

export function createGame({ heroName = 'You', botNames = ['Riley', 'Cassie', 'Marco'] } = {}) {
  const players = [
    { id: 0, name: heroName, isHero: true,  stack: STARTING_STACK, bet: 0, folded: false, sittingOut: false, acted: false, hole: [] },
    { id: 1, name: botNames[0], isHero: false, stack: STARTING_STACK, bet: 0, folded: false, sittingOut: false, acted: false, hole: [] },
    { id: 2, name: botNames[1], isHero: false, stack: STARTING_STACK, bet: 0, folded: false, sittingOut: false, acted: false, hole: [] },
    { id: 3, name: botNames[2], isHero: false, stack: STARTING_STACK, bet: 0, folded: false, sittingOut: false, acted: false, hole: [] },
  ];

  const state = {
    players,
    button: 0,             // dealer button; rotates each hand
    deck: [],
    board: [],
    pot: 0,
    street: 'idle',        // 'idle' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'
    toAct: -1,             // index of player whose turn it is
    lastRaiser: -1,        // who made the last aggressive action this street
    minRaise: BIG_BLIND,   // minimum raise increment (delta over current bet)
    currentBet: 0,         // highest bet this street
    handNumber: 0,
    log: [],               // text events for the status panel
    lastResult: null,      // populated after settle()
    awaitingHero: false,
  };

  function logEvent(msg) {
    state.log.push(msg);
    if (state.log.length > 60) state.log.shift();
  }

  // -------- hand lifecycle --------

  function startHand() {
    // reload busted players
    for (const p of players) {
      if (p.stack <= 0) {
        if (p.isHero) {
          p.sittingOut = true;
        } else {
          p.stack = BOT_RELOAD;
          p.sittingOut = false;
        }
      }
    }
    // reset per-hand state
    for (const p of players) {
      p.bet = 0;
      p.folded = false;
      p.acted = false;
      p.hole = [];
      p.lastAction = null;
      p.allIn = false;
    }
    state.deck = freshShuffled();
    state.board = [];
    state.pot = 0;
    state.street = 'preflop';
    state.lastResult = null;
    state.log = [];
    state.handNumber += 1;
    state.currentBet = 0;
    state.minRaise = BIG_BLIND;
    state.lastRaiser = -1;

    // rotate the button after the first hand
    if (state.handNumber > 1) {
      state.button = nextLivePlayer(players, state.button);
    }
    if (state.button < 0) state.button = 0;

    // post blinds
    const sbIdx = nextLivePlayer(players, state.button);
    const bbIdx = nextLivePlayer(players, sbIdx);
    postBet(sbIdx, SMALL_BLIND, 'small blind');
    postBet(bbIdx, BIG_BLIND, 'big blind');
    state.currentBet = BIG_BLIND;
    state.minRaise = BIG_BLIND;

    // deal hole cards (2 to each, starting left of button)
    let dealIdx = sbIdx;
    for (let round = 0; round < 2; round++) {
      let cur = dealIdx;
      for (let i = 0; i < players.length; i++) {
        const p = players[cur];
        if (!p.sittingOut) p.hole.push(state.deck.pop());
        cur = (cur + 1) % players.length;
      }
    }

    // first to act preflop = UTG (left of BB)
    state.toAct = nextLivePlayer(players, bbIdx);
    state.awaitingHero = state.toAct === 0;
    logEvent(`Hand #${state.handNumber} dealt. Blinds ${SMALL_BLIND}/${BIG_BLIND}.`);
  }

  function postBet(idx, amt, label) {
    const p = players[idx];
    const take = Math.min(amt, p.stack);
    p.stack -= take;
    p.bet += take;
    state.pot += take;
    if (p.stack === 0) p.allIn = true;
    logEvent(`${p.name} posts ${label} ${take}.`);
  }

  // -------- legal actions for current player --------

  function legalActions(idx = state.toAct) {
    const p = players[idx];
    if (!p || p.folded || p.sittingOut || p.stack <= 0) {
      return { canFold: false, canCheck: false, canCall: false, callAmt: 0, canRaise: false, minRaiseTo: 0, maxRaiseTo: 0 };
    }
    const toCall = Math.max(0, state.currentBet - p.bet);
    const canCheck = toCall === 0;
    const callAmt = Math.min(toCall, p.stack);
    const canCall = toCall > 0 && p.stack > 0;
    const minRaiseTo = Math.min(state.currentBet + state.minRaise, p.bet + p.stack);
    const maxRaiseTo = p.bet + p.stack; // all-in
    const canRaise = p.stack > toCall; // need chips beyond the call
    return {
      canFold: true,
      canCheck,
      canCall,
      callAmt,
      canRaise,
      minRaiseTo,
      maxRaiseTo,
      toCall,
    };
  }

  // -------- applying actions --------

  function doFold(idx = state.toAct) {
    const p = players[idx];
    p.folded = true;
    p.acted = true;
    p.lastAction = 'fold';
    logEvent(`${p.name} folds.`);
    return advance();
  }

  function doCheck(idx = state.toAct) {
    const p = players[idx];
    p.acted = true;
    p.lastAction = 'check';
    logEvent(`${p.name} checks.`);
    return advance();
  }

  function doCall(idx = state.toAct) {
    const p = players[idx];
    const toCall = Math.max(0, state.currentBet - p.bet);
    const take = Math.min(toCall, p.stack);
    p.stack -= take;
    p.bet += take;
    state.pot += take;
    if (p.stack === 0) p.allIn = true;
    p.acted = true;
    p.lastAction = take === 0 ? 'check' : 'call';
    if (take > 0) logEvent(`${p.name} calls ${take}.`);
    else logEvent(`${p.name} checks.`);
    return advance();
  }

  // raiseTo: total bet level this street the player wants to bring their bet up to.
  function doRaise(raiseTo, idx = state.toAct) {
    const p = players[idx];
    const max = p.bet + p.stack;
    let target = Math.max(state.currentBet + state.minRaise, raiseTo);
    if (target > max) target = max; // all-in cap
    const delta = target - p.bet;
    if (delta <= 0) return doCall(idx);
    const take = Math.min(delta, p.stack);
    p.stack -= take;
    p.bet += take;
    state.pot += take;
    if (p.stack === 0) p.allIn = true;
    const raiseIncrement = target - state.currentBet;
    if (raiseIncrement >= state.minRaise) {
      state.minRaise = raiseIncrement;
    }
    state.currentBet = Math.max(state.currentBet, p.bet);
    state.lastRaiser = idx;
    // Re-open action for everyone else still in
    for (const other of players) {
      if (other === p) continue;
      if (other.folded || other.sittingOut) continue;
      if (other.stack <= 0) continue;
      other.acted = false;
    }
    p.acted = true;
    p.lastAction = state.currentBet === BIG_BLIND && p.bet === BIG_BLIND ? 'call' : 'raise';
    logEvent(`${p.name} raises to ${p.bet}.`);
    return advance();
  }

  // -------- advance turn / street --------

  function bettingComplete() {
    const acting = playersCanAct(players);
    const inHand = playersInHand(players);
    if (inHand.length <= 1) return true;
    // everyone still able to act has acted AND matched current bet
    for (const p of acting) {
      if (!p.acted) return false;
      if (p.bet !== state.currentBet) return false;
    }
    return true;
  }

  function nextStreet() {
    // collect bets — pot already has them; clear per-street bet counters
    for (const p of players) p.bet = 0;
    state.currentBet = 0;
    state.minRaise = BIG_BLIND;
    state.lastRaiser = -1;
    for (const p of players) if (!p.folded && !p.sittingOut) p.acted = false;

    if (state.street === 'preflop') {
      // burn + 3
      state.deck.pop();
      state.board.push(state.deck.pop(), state.deck.pop(), state.deck.pop());
      state.street = 'flop';
      logEvent('Flop.');
    } else if (state.street === 'flop') {
      state.deck.pop();
      state.board.push(state.deck.pop());
      state.street = 'turn';
      logEvent('Turn.');
    } else if (state.street === 'turn') {
      state.deck.pop();
      state.board.push(state.deck.pop());
      state.street = 'river';
      logEvent('River.');
    } else if (state.street === 'river') {
      state.street = 'showdown';
      return;
    }
    // first to act post-flop is left of button
    state.toAct = nextLivePlayer(players, state.button);
    // if first-to-act is all-in or busted, scan
    let safety = 0;
    while (state.toAct !== -1 && (players[state.toAct].stack <= 0)) {
      state.toAct = nextLivePlayer(players, state.toAct);
      if (++safety > 8) break;
    }
    state.awaitingHero = state.toAct === 0;
  }

  // If only one player remains (everyone else folded) — award pot, end hand.
  function checkFoldout() {
    const inHand = playersInHand(players);
    if (inHand.length === 1) {
      const winner = inHand[0];
      winner.stack += state.pot;
      state.lastResult = {
        winners: [winner.id],
        method: 'foldout',
        pot: state.pot,
        amounts: { [winner.id]: state.pot },
        hands: null,
      };
      logEvent(`${winner.name} wins ${state.pot} (everyone else folded).`);
      state.pot = 0;
      state.street = 'showdown';
      state.toAct = -1;
      state.awaitingHero = false;
      return true;
    }
    return false;
  }

  // If betting cannot continue (only one not-all-in or zero), fast-forward the
  // remaining streets without prompting anyone.
  function shouldRunOut() {
    const inHand = playersInHand(players);
    if (inHand.length < 2) return false;
    const canAct = inHand.filter((p) => p.stack > 0);
    return canAct.length <= 1;
  }

  function advance() {
    if (checkFoldout()) return state;

    if (bettingComplete()) {
      if (state.street === 'river') {
        // collect any remaining bets (already in pot via doCall/doRaise),
        // go to showdown.
        for (const p of players) p.bet = 0;
        state.street = 'showdown';
        state.toAct = -1;
        state.awaitingHero = false;
        settleShowdown();
        return state;
      }
      nextStreet();
      // If no one can act anymore, run the rest of the streets out.
      while (shouldRunOut() && state.street !== 'showdown' && state.street !== 'river') {
        nextStreet();
      }
      if (shouldRunOut() && state.street === 'river') {
        state.street = 'showdown';
        state.toAct = -1;
        state.awaitingHero = false;
        settleShowdown();
        return state;
      }
      return state;
    }

    // move to next player
    let next = nextLivePlayer(players, state.toAct);
    // skip players that can't act (all-in, no chips)
    let safety = 0;
    while (next !== -1 && players[next].stack <= 0 && !players[next].folded) {
      // they're all-in — treat as acted, skip
      players[next].acted = true;
      if (bettingComplete()) return advance();
      next = nextLivePlayer(players, next);
      if (++safety > 8) break;
    }
    state.toAct = next;
    state.awaitingHero = next === 0;
    return state;
  }

  function settleShowdown() {
    const inHand = playersInHand(players);
    if (inHand.length === 1) {
      const w = inHand[0];
      w.stack += state.pot;
      state.lastResult = {
        winners: [w.id],
        method: 'foldout',
        pot: state.pot,
        amounts: { [w.id]: state.pot },
        hands: null,
      };
      logEvent(`${w.name} wins ${state.pot}.`);
      state.pot = 0;
      return;
    }
    const cardLists = inHand.map((p) => [...p.hole, ...state.board]);
    const res = evalWinners(cardLists);
    const winnerIdsLocal = res.winners; // indices into `inHand`
    const winnerPlayerIds = winnerIdsLocal.map((i) => inHand[i].id);
    const share = Math.floor(state.pot / winnerPlayerIds.length);
    const remainder = state.pot - share * winnerPlayerIds.length;
    const amounts = {};
    winnerPlayerIds.forEach((pid, i) => {
      const give = share + (i === 0 ? remainder : 0);
      players[pid].stack += give;
      amounts[pid] = give;
    });
    const handsByPlayerId = {};
    inHand.forEach((p, i) => {
      handsByPlayerId[p.id] = res.hands[i];
      // Store the best 5 cards for highlighting
      try {
        handsByPlayerId[p.id].best = evaluate([...p.hole, ...state.board]).cards;
      } catch (_) {}
    });
    state.lastResult = {
      winners: winnerPlayerIds,
      method: 'showdown',
      pot: state.pot,
      amounts,
      hands: handsByPlayerId,
    };
    const namesWin = winnerPlayerIds.map((id) => players[id].name).join(', ');
    const descrParts = winnerPlayerIds.map((id) => `${players[id].name} (${handsByPlayerId[id].descr})`);
    logEvent(`${namesWin} win${winnerPlayerIds.length > 1 ? '' : 's'} ${state.pot}. ${descrParts.join('; ')}.`);
    state.pot = 0;
  }

  // -------- bot decision heuristic --------
  // Very simple but watchable: evaluate current 5-7 cards, score 0..1,
  // map to fold/check/call/raise probabilities. Adds bluff variance.
  function botDecide(idx = state.toAct) {
    const p = players[idx];
    const legal = legalActions(idx);
    const toCall = legal.toCall;

    let strength;
    if (state.street === 'preflop') {
      strength = preflopStrength(p.hole);
    } else {
      strength = postflopStrength(p.hole, state.board);
    }
    // Pot odds influence
    const potOdds = toCall > 0 ? toCall / (state.pot + toCall) : 0;
    const bluff = Math.random() < 0.07;
    if (bluff) strength = Math.min(1, strength + 0.35);

    // Decide
    if (toCall === 0) {
      // check or bet
      if (strength > 0.7 && legal.canRaise && Math.random() < 0.7) {
        // make a pot-sized-ish bet
        const target = clampRaise(state.currentBet + Math.max(BIG_BLIND, Math.floor(state.pot * 0.6)), legal);
        return { type: 'raise', amount: target };
      }
      if (strength > 0.45 && legal.canRaise && Math.random() < 0.35) {
        const target = clampRaise(state.currentBet + Math.max(BIG_BLIND, Math.floor(state.pot * 0.4)), legal);
        return { type: 'raise', amount: target };
      }
      return { type: 'check' };
    }
    // Facing a bet
    if (strength < 0.22 && potOdds > 0.18) return { type: 'fold' };
    if (strength < 0.4) {
      // fold unless cheap
      if (potOdds < 0.12) return { type: 'call' };
      return Math.random() < 0.6 ? { type: 'fold' } : { type: 'call' };
    }
    if (strength > 0.78 && legal.canRaise && Math.random() < 0.6) {
      const target = clampRaise(state.currentBet * 2.2 + BIG_BLIND, legal);
      return { type: 'raise', amount: target };
    }
    if (strength > 0.55 && legal.canRaise && Math.random() < 0.25) {
      const target = clampRaise(state.currentBet * 2 + BIG_BLIND, legal);
      return { type: 'raise', amount: target };
    }
    return { type: 'call' };
  }

  function clampRaise(target, legal) {
    const t = Math.round(target);
    if (t < legal.minRaiseTo) return legal.minRaiseTo;
    if (t > legal.maxRaiseTo) return legal.maxRaiseTo;
    return t;
  }

  return {
    state,
    startHand,
    legalActions,
    fold: doFold,
    check: doCheck,
    call: doCall,
    raise: doRaise,
    botDecide,
    logEvent,
  };
}

// ---------- bot heuristics ----------

// Preflop strength 0..1 derived from a tiny Chen-style approximation.
export function preflopStrength(hole) {
  if (!hole || hole.length < 2) return 0;
  const [a, b] = hole;
  const rankValue = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14 };
  const hi = Math.max(rankValue[a.rank], rankValue[b.rank]);
  const lo = Math.min(rankValue[a.rank], rankValue[b.rank]);
  const pair = a.rank === b.rank;
  const suited = a.suit === b.suit;
  const gap = hi - lo - 1;

  let score;
  if (pair) {
    // AA=1.0, 22~0.45
    score = 0.45 + (hi - 2) * (0.55 / 12);
  } else {
    // base from high card
    score = (hi - 5) * 0.07; // A(14)->0.63, 6->0.07
    if (hi >= 14) score = 0.55;
    if (hi === 13) score = 0.48;
    if (hi === 12) score = 0.42;
    if (hi === 11) score = 0.38;
    if (hi === 10) score = 0.34;
    // kicker contribution
    score += Math.max(0, (lo - 7) * 0.02);
    // connectors
    if (gap === 0) score += 0.06;
    else if (gap === 1) score += 0.03;
    else if (gap >= 4) score -= 0.05;
    if (suited) score += 0.07;
  }
  return Math.max(0, Math.min(1, score));
}

// Postflop strength: map pokersolver rank into 0..1.
// pokersolver ranks: 1=Highcard..10=RoyalFlush.
export function postflopStrength(hole, board) {
  try {
    const ev = evaluate([...hole, ...board]);
    const r = ev.rank; // 1..10
    if (r >= 8) return 0.97;       // quads+
    if (r === 7) return 0.92;      // full house
    if (r === 6) return 0.85;      // flush
    if (r === 5) return 0.78;      // straight
    if (r === 4) return 0.7;       // trips
    if (r === 3) return 0.55;      // two pair
    if (r === 2) {
      // pair — quality depends on rank value
      // use evaluator descr to peek (e.g. "Pair, A's")
      const m = /Pair,\s+(\w)/.exec(ev.descr || '');
      const rank = m ? m[1] : '';
      const map = { A: 0.55, K: 0.5, Q: 0.45, J: 0.4, T: 0.35, '9': 0.3 };
      return map[rank] ?? 0.25;
    }
    return 0.18; // high card
  } catch (_) {
    return 0.2;
  }
}
