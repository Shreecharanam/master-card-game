import { Card, SUITS, RANKS } from './Card.js';

// A deck of cards. Games never touch raw arrays of cards directly —
// they always draw from a Deck, so the "where do cards come from"
// concern lives in exactly one place.

export class Deck {
  constructor(cards) {
    this.cards = cards ? cards.slice() : Deck.standard();
  }

  static standard() {
    const out = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) out.push(new Card(rank, suit));
    }
    return out;
  }

  // Fisher-Yates, driven by the engine's seedable RNG.
  shuffle(rng = Math.random) {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
    return this;
  }

  draw() {
    if (this.cards.length === 0) throw new Error('Deck is empty');
    return this.cards.pop();
  }

  get size() {
    return this.cards.length;
  }
}
