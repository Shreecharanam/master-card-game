import { GameEngine } from '../../core/GameEngine.js';
import { Deck } from '../../core/Deck.js';
import { TRUMP, trickWinner } from './tricks.js';

// Callbreak — 4 players, 13 cards each, no teams.
//   Phase 1 (bidding): every player calls how many tricks they will win.
//   Phase 2 (playing): 13 tricks. Spades are the fixed trump (hukum).
//                      You must follow suit if you can.
//   Scoring: made your call -> +call points. Missed it -> -call points.
//   A full game is 5 rounds; scores add up across rounds.

const ROUNDS = 5;

export class Callbreak extends GameEngine {
  createInitialState() {
    return {
      game: 'Callbreak',
      phase: 'bidding',
      trump: TRUMP,
      round: 1,
      totalRounds: ROUNDS,
      startIndex: 0,
      turnIndex: 0,
      bids: {}, // playerId -> this round's call
      tricks: {}, // playerId -> tricks won this round
      scores: {}, // playerId -> cumulative points
      history: [], // one entry per completed round
      totalTricks: 0, // sanity counter (should reach 13 * rounds)
      currentTrick: [], // [{ playerId, card }]
      revealHands: false,
      log: [],
      players: this.players,
    };
  }

  setup(state) {
    for (const p of state.players) state.scores[p.id] = 0;
    this.startRound(state, 0);
  }

  // Deal a fresh round. The starting player rotates each round.
  startRound(state, startIndex) {
    state.startIndex = startIndex;
    state.phase = 'bidding';
    state.bids = {};
    state.tricks = {};
    state.currentTrick = [];
    state.revealHands = false;
    state.turnIndex = startIndex;

    for (const p of state.players) {
      p.reset();
      state.bids[p.id] = null;
      state.tricks[p.id] = 0;
    }

    this.deck = new Deck().shuffle(this.rng);
    for (let i = 0; i < 13; i++) {
      for (const p of state.players) p.hand.push(this.deck.draw());
    }

    this.log(
      `--- Round ${state.round}/${state.totalRounds} --- 13 cards each. ` +
        `Bidding starts with ${state.players[startIndex].name}.`
    );
  }

  legalActions(state = this.state) {
    if (state.phase === 'bidding') {
      return Array.from({ length: 13 }, (_, i) => ({
        type: 'bid',
        amount: i + 1,
        label: `Bid ${i + 1}`,
      }));
    }

    if (state.phase === 'playing') {
      const p = state.players[state.turnIndex];
      const led = state.currentTrick[0]?.card.suit;
      const mustFollow = led && p.hand.some((c) => c.suit === led);
      const playable = mustFollow ? p.hand.filter((c) => c.suit === led) : p.hand;
      return playable.map((c) => ({ type: 'play', card: c.label, label: `Play ${c.label}` }));
    }

    return [];
  }

  applyAction(action, state = this.state) {
    if (state.phase === 'bidding') return this.applyBid(action, state);
    if (state.phase === 'playing') return this.applyPlay(action, state);
    throw new Error('Callbreak: game is already over');
  }

  applyBid(action, state) {
    if (action.type !== 'bid') throw new Error('Callbreak: expected a bid');
    const p = state.players[state.turnIndex];
    state.bids[p.id] = action.amount;
    this.log(`${p.name} called ${action.amount}.`);

    if (state.players.every((x) => state.bids[x.id] != null)) {
      state.phase = 'playing';
      state.turnIndex = state.startIndex; // round starter leads the first trick
      this.log('Bidding done. Play begins — follow suit if you can.');
    } else {
      state.turnIndex = (state.turnIndex + 1) % state.players.length;
    }
    return state;
  }

  applyPlay(action, state) {
    const p = state.players[state.turnIndex];
    const idx = p.hand.findIndex((c) => c.label === action.card);
    if (idx === -1) throw new Error(`${p.name} does not hold ${action.card}`);

    const led = state.currentTrick[0]?.card.suit;
    if (led && p.hand[idx].suit !== led && p.hand.some((c) => c.suit === led)) {
      throw new Error(`${p.name} must follow suit (${led})`);
    }

    const [card] = p.hand.splice(idx, 1);
    state.currentTrick.push({ playerId: p.id, card });
    this.log(`${p.name} played ${card.label}.`);

    if (state.currentTrick.length === state.players.length) {
      this.resolveTrick(state);
    } else {
      state.turnIndex = (state.turnIndex + 1) % state.players.length;
    }
    return state;
  }

  resolveTrick(state) {
    const winnerEntry = trickWinner(state.currentTrick, state.trump);
    const winner = state.players.find((p) => p.id === winnerEntry.playerId);
    state.tricks[winner.id] += 1;
    state.totalTricks += 1;
    this.log(`${winner.name} takes the trick.`);
    state.currentTrick = [];

    if (state.players.every((p) => p.hand.length === 0)) {
      this.endRound(state);
    } else {
      state.turnIndex = state.players.findIndex((p) => p.id === winner.id);
    }
  }

  endRound(state) {
    const deltas = {};
    for (const p of state.players) {
      const bid = state.bids[p.id];
      const won = state.tricks[p.id];
      const delta = won >= bid ? bid : -bid; // penalty = the call amount
      deltas[p.id] = delta;
      state.scores[p.id] += delta;
      const sign = delta >= 0 ? '+' : '';
      this.log(`${p.name}: called ${bid}, won ${won} → ${sign}${delta} (total ${state.scores[p.id]})`);
    }

    state.history.push({
      round: state.round,
      bids: { ...state.bids },
      tricks: { ...state.tricks },
      deltas,
      totals: { ...state.scores },
    });

    if (state.round >= state.totalRounds) {
      state.phase = 'done';
      state.revealHands = true;
      this.log(`All ${state.totalRounds} rounds complete.`);
    } else {
      state.round += 1;
      this.startRound(state, (state.startIndex + 1) % state.players.length);
    }
  }

  result(state = this.state) {
    const ranking = [...state.players].sort((a, b) => state.scores[b.id] - state.scores[a.id]);
    return { winner: ranking[0], ranking, scores: state.scores, history: state.history };
  }

  // Extend the base snapshot with Callbreak-specific public info.
  snapshot(state = this.state) {
    const base = super.snapshot(state);
    if (!base) return base;
    base.trump = state.trump;
    base.round = state.round;
    base.totalRounds = state.totalRounds;
    base.bids = state.bids;
    base.tricks = state.tricks;
    base.scores = state.scores;
    base.history = state.history;
    base.currentTrick = state.currentTrick.map((e) => ({
      playerId: e.playerId,
      card: e.card.label,
    }));
    return base;
  }
}
