import { evaluateHand } from '../games/teenpatti/hand.js';
import { wouldWin } from '../games/callbreak/tricks.js';

// A bot that plays any game from the engine's legal-actions list. Its
// "brain" is small but replaceable: swap this file for a smarter one and
// no game or UI ever notices.

export class BotController {
  constructor({ aggression = 0.5 } = {}) {
    this.aggression = aggression;
  }

  async decide({ player, actions, engine }) {
    if (actions.some((a) => a.type === 'pack')) {
      return this.teenPatti(player, actions);
    }
    if (actions.some((a) => a.type === 'bid')) {
      return this.callbreakBid(player, actions);
    }
    if (actions.some((a) => a.type === 'auction' || a.type === 'pass')) {
      return this.callbreak8Auction(player, actions);
    }
    if (actions.some((a) => a.type === 'trump')) {
      return this.callbreak8Trump(player, actions);
    }
    if (actions.some((a) => a.type === 'declare')) {
      return this.callbreak8Declare(player, actions, engine);
    }
    if (actions.some((a) => a.type === 'play')) {
      return this.callbreakPlay(player, actions, engine);
    }
    // Generic fallback (e.g. High Card).
    const byType = Object.fromEntries(actions.map((a) => [a.type, a]));
    if (byType.call) return byType.call;
    if (byType.show) return byType.show;
    return actions[0];
  }

  // ---- Teen Patti ------------------------------------------------------
  teenPatti(player, actions) {
    const byType = Object.fromEntries(actions.map((a) => [a.type, a]));
    const { cat } = evaluateHand(player.hand); // 1 high card .. 6 trail
    if (cat >= 4 && byType.raise) return byType.raise;
    if (cat === 3 && byType.call) return byType.call;
    if (cat === 2 && byType.call && Math.random() < 0.7) return byType.call;
    if (cat === 1 && byType.pack && Math.random() < 0.8) return byType.pack;
    if (byType.call && Math.random() < this.aggression + 0.2) return byType.call;
    if (byType.pack) return byType.pack;
    return actions[0];
  }

  // ---- Callbreak 8: auction (5 cards) ---------------------------------
  callbreak8Auction(player, actions) {
    const raises = actions.filter((a) => a.type === 'auction');
    const pass = actions.find((a) => a.type === 'pass');

    let s = 0;
    for (const c of player.hand) {
      if (c.rank === 14) s += 2;
      else if (c.rank === 13) s += 1.5;
      else if (c.rank === 12) s += 1;
      if (c.suit === 'S' && c.rank >= 11) s += 1;
    }

    if (!pass) {
      // First caller: must open the bidding.
      const amt = s >= 4 ? 7 : s >= 2.5 ? 6 : 5;
      return raises.find((a) => a.amount === amt) || raises[0];
    }

    const next = raises[0]; // lowest available raise
    if (next && s >= 3 && Math.random() < 0.6) return next;
    return pass || raises[0];
  }

  // ---- Callbreak 8: pick the trump suit -------------------------------
  callbreak8Trump(player, actions) {
    const counts = {};
    for (const c of player.hand) counts[c.suit] = (counts[c.suit] || 0) + 1;
    let best = actions[0];
    let bestCount = -1;
    for (const a of actions) {
      const n = counts[a.suit] || 0;
      if (n > bestCount) {
        bestCount = n;
        best = a;
      }
    }
    return best;
  }

  // ---- Callbreak 8: declare your tricks -------------------------------
  callbreak8Declare(player, actions, engine) {
    const trump = engine?.state?.trump ?? 'S';
    let strength = 0;
    for (const c of player.hand) {
      if (c.rank === 14) strength += 1;
      else if (c.rank === 13) strength += 0.75;
      else if (c.rank === 12) strength += 0.35;
      if (c.suit === trump && c.rank >= 11) strength += 0.6;
    }
    let call = Math.round(strength + 0.5);
    call = Math.max(1, Math.min(13, call));
    return actions.find((a) => a.amount === call) || actions[0];
  }

  // ---- Callbreak: bidding ---------------------------------------------
  // Rough trick estimate from high cards + trump (spade) honours.
  callbreakBid(player, actions) {
    let strength = 0;
    for (const c of player.hand) {
      if (c.rank === 14) strength += 1.0; // Ace
      else if (c.rank === 13) strength += 0.75; // King
      else if (c.rank === 12) strength += 0.35; // Queen
      if (c.suit === 'S' && c.rank >= 11) strength += 0.6; // trump honour
    }
    // A 13-card hand wins ~3.25 tricks on average, so aim near that.
    let bid = Math.round(strength + 0.5);
    bid = Math.max(1, Math.min(13, bid));
    return actions.find((a) => a.amount === bid) || actions[0];
  }

  // ---- Callbreak: playing a card --------------------------------------
  callbreakPlay(player, actions, engine) {
    const state = engine?.state;
    const trick = state?.currentTrick ?? [];
    const trump = state?.trump ?? 'S';
    const led = trick[0]?.card.suit;

    const options = actions
      .map((a) => ({ action: a, card: player.hand.find((c) => c.label === a.card) }))
      .filter((x) => x.card);

    const lowFirst = (a, b) => a.card.rank - b.card.rank;

    // Last to play: win as cheaply as possible, else dump the lowest card.
    if (trick.length === 3) {
      const winners = options.filter((o) => wouldWin(o.card, trick, trump)).sort(lowFirst);
      if (winners.length) return winners[0].action;
      return [...options].sort(lowFirst)[0].action;
    }

    // Otherwise play low, keeping trumps for later.
    const follow = options.filter((o) => o.card.suit === led);
    const pool = follow.length ? follow : options;
    pool.sort((a, b) => (a.card.suit === trump) - (b.card.suit === trump) || lowFirst(a, b));
    return pool[0].action;
  }
}
