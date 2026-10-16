import { GameEngine } from '../../core/GameEngine.js';

// The simplest possible game, kept as a worked example of the contract:
// deal one card each, everyone shows, highest card wins.
// Use it to sanity-check the engine loop before adding real rules.

export class HighCard extends GameEngine {
  createInitialState() {
    return {
      game: 'HighCard',
      phase: 'show',
      pot: 0,
      turnIndex: 0,
      shown: 0,
      revealHands: false,
      log: [],
      players: this.players,
    };
  }

  setup(state) {
    state.players.forEach((p) => p.reset());
    this.deck.shuffle(this.rng);
    for (const p of state.players) p.hand.push(this.deck.draw());
    this.log('One card each. Highest card wins.');
  }

  legalActions(state = this.state) {
    return [{ type: 'show', label: 'Show card' }];
  }

  applyAction(action, state = this.state) {
    if (action.type !== 'show') throw new Error('HighCard only allows "show"');
    state.shown += 1;
    if (state.shown >= state.players.length) {
      state.revealHands = true;
      state.phase = 'done';
      const ranked = this.rank(state);
      const winner = ranked[0].player;
      winner.receive(state.pot); // payout happens here, once
      state.winnerId = winner.id;
      this.log(`${winner.name} wins with ${ranked[0].card.label}.`);
    } else {
      state.turnIndex = this.nextActiveIndex(state.turnIndex);
    }
    return state;
  }

  // Pure: reports the outcome without changing anything.
  rank(state) {
    return state.players
      .map((p) => ({ player: p, card: p.hand[0] }))
      .sort((a, b) => b.card.rank - a.card.rank);
  }

  result(state = this.state) {
    const ranked = this.rank(state);
    const winner = state.players.find((p) => p.id === state.winnerId) || ranked[0].player;
    return { winner, ranking: ranked };
  }
}
