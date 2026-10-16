import { Deck } from './Deck.js';
import { makeRng } from './RNG.js';

// The heart of the engine. GameEngine is HEADLESS: it knows nothing about
// terminals, browsers or buttons. It only holds state and exposes the
// turn loop. A game (TeenPatti, HighCard, ...) subclasses it and fills in
// the rules by overriding the five hook methods below.
//
// The external driver (CLI / web UI) runs the loop:
//
//     engine.start();
//     while (!engine.isOver()) {
//       const actions = engine.legalActions();
//       const action  = await controller.decide({ player: engine.currentPlayer, actions, view: engine.snapshot() });
//       engine.applyAction(action);
//     }
//     const outcome = engine.result();
//
// Because the engine never calls a UI, the SAME engine powers the terminal
// demo, the browser game, and a future mobile app.

export class GameEngine {
  constructor({ players, seed } = {}) {
    this.players = players ?? [];
    this.seed = seed ?? Date.now();
    this.rng = makeRng(this.seed);
    this.deck = new Deck();
    this.state = null;
  }

  start() {
    this.state = this.createInitialState();
    this.setup(this.state);
    this.log(`Game started (seed ${this.seed}).`);
    return this;
  }

  // ----- hooks every game must implement -------------------------------
  createInitialState() {
    throw new Error(`${this.constructor.name}: createInitialState() not implemented`);
  }
  setup(/* state */) {
    throw new Error(`${this.constructor.name}: setup() not implemented`);
  }
  legalActions(/* state */) {
    return [];
  }
  applyAction(/* action, state */) {
    throw new Error(`${this.constructor.name}: applyAction() not implemented`);
  }
  isOver(state = this.state) {
    return !!state && state.phase === 'done';
  }
  result(/* state */) {
    throw new Error(`${this.constructor.name}: result() not implemented`);
  }

  // ----- shared helpers available to every game ------------------------
  get currentPlayer() {
    return this.state.players[this.state.turnIndex];
  }

  activePlayers(state = this.state) {
    return state.players.filter((p) => !p.folded);
  }

  // Index of the next player who has not folded, wrapping around.
  nextActiveIndex(from, state = this.state) {
    const n = state.players.length;
    for (let step = 1; step <= n; step++) {
      const i = (from + step) % n;
      if (!state.players[i].folded) return i;
    }
    return from;
  }

  log(message) {
    if (this.state) this.state.log.push(message);
  }

  // A UI-safe view of the state. Other players' cards are hidden unless
  // the game reveals them (showdown) or the seat is the human's.
  // `viewerId` lets a server show one player their own cards while hiding
  // everyone else's. result() must be side-effect free (payouts happen when
  // a game ends, not when it is reported).
  snapshot(state = this.state, viewerId = null) {
    if (!state) return null;
    const over = this.isOver(state);
    const winnerName = over ? this.result(state)?.winner?.name ?? null : null;
    return {
      game: state.game,
      phase: state.phase,
      pot: state.pot ?? 0,
      turnIndex: state.turnIndex,
      currentPlayerId: over ? null : this.currentPlayer?.id ?? null,
      revealHands: !!state.revealHands,
      over,
      winnerName,
      log: state.log.slice(-10),
      legalActions: over ? [] : this.legalActions(state),
      players: state.players.map((p) => ({
        id: p.id,
        name: p.name,
        chips: p.chips,
        bet: p.bet,
        folded: p.folded,
        seen: p.seen,
        isHuman: p.isHuman,
        isBot: !!p.isBot,
        cards:
          state.revealHands || p.isHuman || p.id === viewerId
            ? p.hand.map((c) => c.label)
            : p.hand.map(() => '??'),
      })),
    };
  }
}
