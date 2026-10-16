import { GameEngine } from '../../core/GameEngine.js';
import { evaluateHand, compareHands } from './hand.js';

// Teen Patti: 3 cards each, a few rounds of betting, best hand at the
// showdown takes the pot. This is the "real" game that proves the engine
// can carry non-trivial rules.

const BOOT = 10; // ante every player puts in up front
const MAX_ROUNDS = 3; // betting rounds before forced showdown

export class TeenPatti extends GameEngine {
  createInitialState() {
    return {
      game: 'TeenPatti',
      phase: 'betting',
      pot: 0,
      stake: BOOT, // current amount to call
      round: 1,
      maxRounds: MAX_ROUNDS,
      actedThisRound: 0,
      turnIndex: 0,
      revealHands: false,
      log: [],
      players: this.players,
    };
  }

  setup(state) {
    state.players.forEach((p) => p.reset());
    this.deck.shuffle(this.rng);

    // Deal 3 cards to each seat.
    for (let round = 0; round < 3; round++) {
      for (const p of state.players) p.hand.push(this.deck.draw());
    }

    // Collect the boot.
    for (const p of state.players) {
      const paid = p.pay(BOOT);
      state.pot += paid;
    }
    this.log(`Boot of ${BOOT} collected from every player. Cards dealt.`);
  }

  legalActions(state = this.state) {
    const p = state.players[state.turnIndex];
    const actions = [{ type: 'pack', label: 'Pack (fold)' }];
    if (p.chips >= state.stake) {
      actions.push({ type: 'call', amount: state.stake, label: `Call ${state.stake}` });
    }
    if (p.chips >= state.stake * 2) {
      actions.push({ type: 'raise', amount: state.stake * 2, label: `Raise to ${state.stake * 2}` });
    }
    if (!p.seen) actions.push({ type: 'see', label: 'See cards' });
    return actions;
  }

  applyAction(action, state = this.state) {
    const p = state.players[state.turnIndex];

    // "see" only reveals your own cards — it does not end your turn.
    if (action.type === 'see') {
      p.seen = true;
      this.log(`${p.name} looked at their cards.`);
      return state;
    }

    if (action.type === 'pack') {
      p.folded = true;
      this.log(`${p.name} packed.`);
    } else if (action.type === 'call') {
      const paid = p.pay(state.stake);
      state.pot += paid;
      this.log(`${p.name} called ${paid}.`);
    } else if (action.type === 'raise') {
      const paid = p.pay(state.stake * 2);
      state.pot += paid;
      state.stake = state.stake * 2;
      this.log(`${p.name} raised — stake is now ${state.stake}.`);
    } else {
      throw new Error(`TeenPatti: unknown action "${action.type}"`);
    }

    state.actedThisRound += 1;
    this.advance(state);
    return state;
  }

  advance(state) {
    const active = this.activePlayers(state);

    // Everyone else folded — last player standing wins.
    if (active.length === 1) {
      this.finish(state, active);
      return;
    }

    // Round complete when every still-active player has acted once.
    if (state.actedThisRound >= active.length) {
      state.actedThisRound = 0;
      state.round += 1;
      if (state.round > state.maxRounds) {
        this.finish(state, active);
        return;
      }
      this.log(`--- Round ${state.round} ---`);
    }

    state.turnIndex = this.nextActiveIndex(state.turnIndex, state);
  }

  finish(state, active) {
    state.revealHands = true;
    state.phase = 'done';

    if (active.length === 1) {
      const winner = active[0];
      winner.receive(state.pot);
      this.log(`${winner.name} wins ${state.pot} (everyone else packed).`);
      state.winnerId = winner.id;
      return;
    }

    const ranked = active
      .map((player) => ({ player, hand: evaluateHand(player.hand) }))
      .sort((a, b) => compareHands(b.hand, a.hand));

    const winner = ranked[0].player;
    winner.receive(state.pot);
    this.log(
      `${winner.name} wins ${state.pot} with ${ranked[0].hand.name}.`
    );
    state.winnerId = winner.id;
  }

  result(state = this.state) {
    const winner = state.players.find((p) => p.id === state.winnerId);
    const ranking = this.activePlayers(state).map((player) => ({
      player,
      hand: evaluateHand(player.hand),
    }));
    return { winner, ranking };
  }
}
