import { GameEngine } from '../../core/GameEngine.js';
import { Deck } from '../../core/Deck.js';
import { SUITS } from '../../core/Card.js';
import { trickWinner } from '../callbreak/tricks.js';

// Callbreak 13 (house variant) — 4 players, 13 cards, one round:
//
//   1. Deal 5 cards each.
//   2. AUCTION (with 5 cards): players in turn call a number (first call
//      >= 5). Each higher call cancels the previous one. The highest caller
//      wins: their suit becomes the TRUMP and they start the game.
//   3. Deal the remaining 8 cards (13 each). Only your own cards are visible.
//   4. CALLING: every player (the auction winner included) declares how many
//      tricks they will win, after seeing all 13 cards. Minimum 1.
//   5. PLAY: 13 tricks, follow suit if you can.
//   6. SCORE: made your call -> +call; missed it -> -call.
//   The lowest scorer deals the next round. Highest total after the last
//   round wins.
//
// Action types: 'auction' | 'pass' | 'trump' | 'declare' | 'play'

const ROUNDS = 5;
const HAND_SIZE = 13;
const FIRST_DEAL = 5;
const AUCTION_MIN = 5;
const AUCTION_MAX = 8; // 5..8, as in the house rule (easy to widen later)
const OVERRIDE_MIN = 10; // a final call of 10+ takes the trump choice

const SUIT_LABEL = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };

export class Callbreak8 extends GameEngine {
  createInitialState() {
    return {
      game: 'Callbreak 13',
      phase: 'auction',
      round: 1,
      totalRounds: ROUNDS,
      handSize: HAND_SIZE,
      dealerIndex: this.players.length - 1, // so the first auction starts at seat 0
      turnIndex: 0,
      startIndex: 0, // auction winner; leads the first trick
      trump: null,
      trumpCard: null, // one card shown to everyone as the trump indicator
      trumpHolderId: null, // who is choosing the trump right now
      auction: {}, // playerId -> number | 'pass'
      highestCall: null,
      highestCallerId: null,
      auctionActions: 0,
      callingActions: 0,
      bids: {}, // playerId -> declared tricks
      tricks: {}, // playerId -> tricks won this round
      scores: {}, // playerId -> cumulative points
      history: [],
      totalTricks: 0,
      currentTrick: [],
      revealHands: false,
      log: [],
      players: this.players,
    };
  }

  setup(state) {
    for (const p of state.players) state.scores[p.id] = 0;
    this.startRound(state);
  }

  startRound(state) {
    state.phase = 'auction';
    state.trump = null;
    state.trumpCard = null;
    state.auction = {};
    state.highestCall = null;
    state.highestCallerId = null;
    state.auctionActions = 0;
    state.callingActions = 0;
    state.bids = {};
    state.tricks = {};
    state.currentTrick = [];
    state.revealHands = false;

    for (const p of state.players) {
      p.reset();
      state.auction[p.id] = null;
      state.bids[p.id] = null;
      state.tricks[p.id] = 0;
    }

    this.deck = new Deck().shuffle(this.rng);
    for (let i = 0; i < FIRST_DEAL; i++) {
      for (const p of state.players) p.hand.push(this.deck.draw());
    }

    state.turnIndex = (state.dealerIndex + 1) % state.players.length;
    this.log(
      `--- Round ${state.round}/${state.totalRounds} --- ${FIRST_DEAL} cards dealt. ` +
        `Auction starts with ${state.players[state.turnIndex].name} (call ${AUCTION_MIN}+).`
    );
  }

  legalActions(state = this.state) {
    const p = state.players[state.turnIndex];

    if (state.phase === 'auction') {
      const actions = [];
      const floor = state.highestCall === null ? AUCTION_MIN : state.highestCall + 1;
      for (let n = floor; n <= AUCTION_MAX; n++) {
        actions.push({
          type: 'auction',
          amount: n,
          label: state.highestCall === null ? `Call ${n}` : `Raise to ${n}`,
        });
      }
      actions.push({ type: 'pass', label: 'Pass' }); // anyone may pass, even the first
      return actions;
    }

    if (state.phase === 'trump' || state.phase === 'trump2') {
      return SUITS.map((s) => ({ type: 'trump', suit: s, label: `Trump ${SUIT_LABEL[s]}` }));
    }

    if (state.phase === 'calling') {
      return Array.from({ length: HAND_SIZE }, (_, i) => ({
        type: 'declare',
        amount: i + 1,
        label: `Call ${i + 1}`,
      }));
    }

    if (state.phase === 'playing') {
      const led = state.currentTrick[0]?.card.suit;
      const mustFollow = led && p.hand.some((c) => c.suit === led);
      const playable = mustFollow ? p.hand.filter((c) => c.suit === led) : p.hand;
      return playable.map((c) => ({ type: 'play', card: c.label, label: `Play ${c.label}` }));
    }

    return [];
  }

  applyAction(action, state = this.state) {
    switch (state.phase) {
      case 'auction':
        return this.applyAuction(action, state);
      case 'trump':
        return this.applyTrump(action, state);
      case 'calling':
        return this.applyDeclare(action, state);
      case 'trump2':
        return this.applyTrump2(action, state);
      case 'playing':
        return this.applyPlay(action, state);
      default:
        throw new Error('Callbreak 13: game is already over');
    }
  }

  // ---- auction ---------------------------------------------------------
  applyAuction(action, state) {
    const p = state.players[state.turnIndex];

    if (action.type === 'auction') {
      if (state.highestCall === null && action.amount < AUCTION_MIN) {
        throw new Error(`First call must be at least ${AUCTION_MIN}`);
      }
      if (state.highestCall !== null && action.amount <= state.highestCall) {
        throw new Error(`Call must beat ${state.highestCall}`);
      }
      state.auction[p.id] = action.amount;
      state.highestCall = action.amount;
      state.highestCallerId = p.id;
      this.log(`${p.name} calls ${action.amount}.`);
    } else if (action.type === 'pass') {
      state.auction[p.id] = 'pass';
      this.log(`${p.name} passes.`);
    } else {
      throw new Error('Callbreak 13: expected an auction call or pass');
    }

    state.auctionActions += 1;
    if (state.auctionActions >= state.players.length) {
      this.endAuction(state);
    } else {
      state.turnIndex = (state.turnIndex + 1) % state.players.length;
    }
    return state;
  }

  endAuction(state) {
    const n = state.players.length;
    if (state.highestCallerId) {
      // Trump is chosen with only the first 5 cards visible.
      const winner = state.players.find((p) => p.id === state.highestCallerId);
      state.startIndex = state.players.findIndex((p) => p.id === winner.id);
      state.phase = 'trump';
      state.turnIndex = state.startIndex;
      this.log(
        `${winner.name} wins the auction with ${state.highestCall}. ` +
          `${winner.name} picks the trump (with 5 cards).`
      );
    } else {
      // Everyone passed -> the trump stays hukum (Spades).
      state.trump = 'S';
      state.startIndex = (state.dealerIndex + 1) % n;
      state.turnIndex = state.startIndex;
      state.trumpCard = this.pickTrumpCard(state, state.startIndex, 'S');
      this.dealRest(state);
      state.phase = 'calling';
      this.log('Everyone passed — trump stays hukum (Spades). Cards completed to 13.');
    }
  }

  // Deal the remaining cards so each player has a full hand (13).
  dealRest(state) {
    for (let i = 0; i < HAND_SIZE - FIRST_DEAL; i++) {
      for (const p of state.players) p.hand.push(this.deck.draw());
    }
  }

  applyTrump(action, state) {
    if (action.type !== 'trump' || !SUITS.includes(action.suit)) {
      throw new Error('Callbreak 13: expected a trump suit');
    }
    state.trump = action.suit;
    state.trumpHolderId = state.players[state.turnIndex].id;
    state.trumpCard = this.pickTrumpCard(state, state.turnIndex, action.suit);
    this.dealRest(state); // now the remaining 8 cards are dealt (13 each)
    state.phase = 'calling';
    state.turnIndex = (state.dealerIndex + 1) % state.players.length;
    this.log(
      `Trump is ${SUIT_LABEL[action.suit]}. Cards completed to ${HAND_SIZE}. ` +
        `Everyone declares their call (min 1).`
    );
    return state;
  }

  // A final call of 10+ overrides the auction winner's trump.
  applyTrump2(action, state) {
    if (action.type !== 'trump' || !SUITS.includes(action.suit)) {
      throw new Error('Callbreak 13: expected a trump suit');
    }
    state.trump = action.suit;
    state.trumpCard = this.pickTrumpCard(state, state.turnIndex, action.suit);
    state.phase = 'playing';
    state.turnIndex = state.startIndex; // the auction winner still leads
    this.log(`Trump overridden to ${SUIT_LABEL[action.suit]}. Play begins.`);
    return state;
  }

  // A card of the trump suit from the chooser's hand — shown to everyone.
  pickTrumpCard(state, index, suit) {
    const cards = state.players[index].hand.filter((c) => c.suit === suit);
    if (cards.length === 0) return null;
    const highest = cards.reduce((a, b) => (b.rank > a.rank ? b : a));
    return highest.label;
  }

  // ---- trick calls -----------------------------------------------------
  applyDeclare(action, state) {
    if (action.type !== 'declare') throw new Error('Callbreak 13: expected a call');
    const p = state.players[state.turnIndex];
    state.bids[p.id] = action.amount;
    this.log(`${p.name} calls ${action.amount}.`);

    state.callingActions += 1;
    if (state.callingActions >= state.players.length) {
      this.finishCalling(state);
    } else {
      state.turnIndex = (state.turnIndex + 1) % state.players.length;
    }
    return state;
  }

  finishCalling(state) {
    const maxCall = Math.max(...state.players.map((p) => state.bids[p.id]));
    if (maxCall >= OVERRIDE_MIN) {
      // The boldest caller takes the trump choice.
      const holder = state.players.find((p) => state.bids[p.id] === maxCall);
      state.trumpHolderId = holder.id;
      state.phase = 'trump2';
      state.turnIndex = state.players.findIndex((p) => p.id === holder.id);
      this.log(
        `${holder.name} called ${maxCall} (10+) — they may change the trump before play.`
      );
    } else {
      state.phase = 'playing';
      state.turnIndex = state.startIndex; // auction winner leads
      this.log('Play begins — follow suit if you can.');
    }
  }

  // ---- play ------------------------------------------------------------
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
      trump: state.trump,
      dealerIndex: state.dealerIndex,
      bids: { ...state.bids },
      tricks: { ...state.tricks },
      deltas,
      totals: { ...state.scores },
    });

    if (state.round >= state.totalRounds) {
      state.phase = 'done';
      state.revealHands = true;
      this.log(`All ${state.totalRounds} rounds complete.`);
      return;
    }

    // The lowest scorer deals the next round.
    const lowest = state.players.reduce((a, b) =>
      state.scores[b.id] < state.scores[a.id] ? b : a
    );
    state.dealerIndex = state.players.findIndex((p) => p.id === lowest.id);
    this.log(`${lowest.name} has the fewest points and deals the next round.`);
    state.round += 1;
    this.startRound(state);
  }

  result(state = this.state) {
    const ranking = [...state.players].sort((a, b) => state.scores[b.id] - state.scores[a.id]);
    return { winner: ranking[0], ranking, scores: state.scores, history: state.history };
  }

  snapshot(state = this.state, viewerId = null) {
    const base = super.snapshot(state, viewerId);
    if (!base) return base;
    base.trump = state.trump;
    base.trumpCard = state.trumpCard;
    base.trumpHolderId = state.trumpHolderId;
    base.round = state.round;
    base.totalRounds = state.totalRounds;
    base.auction = state.auction;
    base.highestCall = state.highestCall;
    base.highestCallerId = state.highestCallerId;
    base.bids = state.bids;
    base.tricks = state.tricks;
    base.scores = state.scores;
    base.currentTrick = state.currentTrick.map((e) => ({
      playerId: e.playerId,
      card: e.card.label,
    }));
    return base;
  }
}
