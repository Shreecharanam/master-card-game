import { evaluateHand, compareHands, CATEGORY } from '../src/games/teenpatti/hand.js';
import { Deck } from '../src/core/Deck.js';
import { Card } from '../src/core/Card.js';
import { makeRng } from '../src/core/RNG.js';
import { HighCard } from '../src/games/highcard/HighCard.js';
import { Callbreak } from '../src/games/callbreak/Callbreak.js';
import { Callbreak8 } from '../src/games/callbreak8/Callbreak8.js';
import { trickWinner, beats } from '../src/games/callbreak/tricks.js';
import { Player } from '../src/core/Player.js';
import { BotController } from '../src/players/BotController.js';

// A tiny zero-dependency test runner so `npm test` works with plain Node.
let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    passed++;
    console.log(`  ok  - ${name}`);
  } else {
    failed++;
    console.error(`  FAIL- ${name}`);
  }
}

const c = (rank, suit) => new Card(rank, suit);

// ---- Teen Patti hand ranking -------------------------------------------
check('trail beats everything',
  evaluateHand([c(9, 'S'), c(9, 'H'), c(9, 'D')]).cat === CATEGORY.TRAIL);
check('pure sequence detected',
  evaluateHand([c(10, 'S'), c(11, 'S'), c(12, 'S')]).cat === CATEGORY.PURE_SEQUENCE);
check('plain sequence detected',
  evaluateHand([c(10, 'S'), c(11, 'H'), c(12, 'D')]).cat === CATEGORY.SEQUENCE);
check('color detected',
  evaluateHand([c(2, 'S'), c(7, 'S'), c(11, 'S')]).cat === CATEGORY.COLOR);
check('pair detected',
  evaluateHand([c(5, 'S'), c(5, 'H'), c(12, 'D')]).cat === CATEGORY.PAIR);
check('A-2-3 is a valid low sequence',
  evaluateHand([c(14, 'S'), c(2, 'H'), c(3, 'D')]).cat === CATEGORY.SEQUENCE);
check('pair of aces beats pair of kings',
  compareHands(evaluateHand([c(14, 'S'), c(14, 'H'), c(4, 'D')]),
               evaluateHand([c(13, 'S'), c(13, 'H'), c(4, 'D')])) > 0);
check('color beats a pair',
  compareHands(evaluateHand([c(2, 'S'), c(7, 'S'), c(11, 'S')]),
               evaluateHand([c(14, 'S'), c(14, 'H'), c(4, 'D')])) > 0);

// ---- deck + RNG --------------------------------------------------------
const deck = new Deck();
check('a standard deck has 52 cards', deck.size === 52);
check('all 52 cards are unique', new Set(deck.cards.map((x) => x.label)).size === 52);

const d1 = new Deck().shuffle(makeRng(123));
const d2 = new Deck().shuffle(makeRng(123));
check('same seed => identical shuffle',
  d1.cards.map((x) => x.label).join() === d2.cards.map((x) => x.label).join());

// ---- Callbreak trick rules --------------------------------------------
// Led hearts: A♥ should beat K♥.
check('highest of led suit wins the trick',
  trickWinner([{ playerId: 'a', card: c(13, 'H') }, { playerId: 'b', card: c(14, 'H') },
               { playerId: 'c', card: c(2, 'D') }, { playerId: 'd', card: c(9, 'C') }]).playerId === 'b');
// A spade (trump) beats a higher heart.
check('trump (spade) beats the led suit',
  trickWinner([{ playerId: 'a', card: c(14, 'H') }, { playerId: 'b', card: c(2, 'S') },
               { playerId: 'c', card: c(3, 'D') }, { playerId: 'd', card: c(9, 'C') }]).playerId === 'b');
// Off-suit non-trump cannot win.
check('off-suit card cannot win a trick',
  beats(c(14, 'D'), c(2, 'H'), 'H', 'S') === false);
check('higher trump beats lower trump',
  beats(c(14, 'S'), c(13, 'S'), 'H', 'S') === true);

// ---- engine loop: HighCard (all bots) ---------------------------------
const hcPlayers = [new Player({ id: 'a', name: 'A' }), new Player({ id: 'b', name: 'B' })];
const hc = new HighCard({ players: hcPlayers, seed: 7 });
hc.start();
const bot = new BotController();

async function runToEnd(engine) {
  let guard = 0;
  while (!engine.isOver() && guard++ < 2000) {
    const action = await bot.decide({
      player: engine.currentPlayer,
      actions: engine.legalActions(),
      engine,
    });
    engine.applyAction(action);
  }
  return engine.isOver();
}

(async () => {
  check('HighCard loop terminates', await runToEnd(hc));
  check('HighCard declares a winner', !!hc.result().winner);

  // ---- engine loop: Callbreak (all bots, several seeds) ----------------
  let allTerminated = true;
  let allRoundsPlayed = true;
  let allTricksCounted = true;
  let penaltyRuleOk = true;
  let historyConsistent = true;

  for (let seed = 0; seed < 60; seed++) {
    const players = ['A', 'B', 'C', 'D'].map((n, i) => new Player({ id: 'p' + i, name: n }));
    const game = new Callbreak({ players, seed });
    game.start();
    if (!(await runToEnd(game))) { allTerminated = false; break; }

    const st = game.state;
    if (st.round !== st.totalRounds || st.history.length !== st.totalRounds) allRoundsPlayed = false;
    if (st.totalTricks !== 13 * st.totalRounds) allTricksCounted = false;

    // Replay the history: each round's delta must be +call or -call,
    // and the running total must equal the cumulative score.
    const running = Object.fromEntries(players.map((p) => [p.id, 0]));
    for (const h of st.history) {
      for (const p of players) {
        const bid = h.bids[p.id];
        const won = h.tricks[p.id];
        const expected = won >= bid ? bid : -bid; // penalty = the call amount
        if (h.deltas[p.id] !== expected) penaltyRuleOk = false;
        running[p.id] += h.deltas[p.id];
      }
    }
    for (const p of players) if (running[p.id] !== st.scores[p.id]) historyConsistent = false;
  }

  check('Callbreak terminates across 60 games', allTerminated);
  check('every game plays all 5 rounds', allRoundsPlayed);
  check('65 tricks are played per game (13 x 5)', allTricksCounted);
  check('penalty equals the call amount', penaltyRuleOk);
  check('cumulative scores match the round history', historyConsistent);

  // ---- auction rule: first call must be >= 5 ---------------------------
  {
    const ps = ['A', 'B', 'C', 'D'].map((n, i) => new Player({ id: 'p' + i, name: n }));
    const g8 = new Callbreak8({ players: ps, seed: 1 });
    g8.start();
    let threw = false;
    try {
      g8.applyAction({ type: 'auction', amount: 4 });
    } catch {
      threw = true;
    }
    check('first auction call below 5 is rejected', threw);
  }

  // ---- engine loop: Callbreak 8 (all bots, several seeds) --------------─
  let c8Terminated = true;
  let c8Rounds = true;
  let c8Tricks = true;
  let c8Trump = true;
  let c8Scoring = true;
  let c8Deal = true;

  for (let seed = 0; seed < 40; seed++) {
    const players = ['A', 'B', 'C', 'D'].map((n, i) => new Player({ id: 'p' + i, name: n }));
    const game = new Callbreak8({ players, seed });
    game.start();
    if (!(await runToEnd(game))) { c8Terminated = false; break; }

    const st = game.state;
    if (st.round !== st.totalRounds || st.history.length !== st.totalRounds) c8Rounds = false;
    if (st.totalTricks !== 13 * st.totalRounds) c8Tricks = false;

    const running = Object.fromEntries(players.map((p) => [p.id, 0]));
    for (const h of st.history) {
      if (!h.trump) c8Trump = false;
      for (const p of players) {
        const bid = h.bids[p.id];
        const won = h.tricks[p.id];
        const expected = won >= bid ? bid : -bid;
        if (h.deltas[p.id] !== expected) c8Scoring = false;
        running[p.id] += h.deltas[p.id];
      }
    }
    for (const p of players) if (running[p.id] !== st.scores[p.id]) c8Scoring = false;

    // The lowest scorer of round r must deal round r+1.
    for (let i = 0; i < st.history.length - 1; i++) {
      const h = st.history[i];
      const lowest = players.reduce((a, b) => (h.totals[b.id] < h.totals[a.id] ? b : a));
      const expectedDealer = players.findIndex((p) => p.id === lowest.id);
      if (st.history[i + 1].dealerIndex !== expectedDealer) c8Deal = false;
    }
  }

  check('Callbreak 8 terminates across 40 games', c8Terminated);
  check('Callbreak 8 plays all 5 rounds', c8Rounds);
  check('Callbreak 13 plays 65 tricks per game (13 x 5)', c8Tricks);

  // ---- Callbreak 13: a 10+ final call overrides the trump -------------
  {
    const ps = ['A', 'B', 'C', 'D'].map((n, i) => new Player({ id: 'p' + i, name: n }));
    const g8 = new Callbreak8({ players: ps, seed: 1 });
    g8.start();
    g8.applyAction({ type: 'auction', amount: 5 });
    g8.applyAction({ type: 'pass' });
    g8.applyAction({ type: 'pass' });
    g8.applyAction({ type: 'pass' });
    g8.applyAction({ type: 'trump', suit: 'H' });
    g8.applyAction({ type: 'declare', amount: 2 });
    g8.applyAction({ type: 'declare', amount: 10 }); // bold call
    g8.applyAction({ type: 'declare', amount: 3 });
    g8.applyAction({ type: 'declare', amount: 4 });
    check('a 10+ call moves to the trump-override phase', g8.state.phase === 'trump2');
    check('the 10+ caller holds the trump', g8.state.trumpHolderId === 'p1');
    g8.applyAction({ type: 'trump', suit: 'C' });
    check('override changes the trump', g8.state.trump === 'C' && g8.state.phase === 'playing');
  }
  check('Callbreak 8 sets a trump every round', c8Trump);
  check('Callbreak 8 scoring = +/- call and accumulates', c8Scoring);
  check('Callbreak 8 lowest scorer deals the next round', c8Deal);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
