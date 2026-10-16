// A single playing card. Rank is numeric (2..14, 14 = Ace) so that
// comparisons are trivial; suit is one of S/H/D/C.

export const SUITS = ['S', 'H', 'D', 'C'];
export const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

export class Card {
  constructor(rank, suit) {
    this.rank = rank;
    this.suit = suit;
  }

  get label() {
    return (RANK_LABEL[this.rank] || String(this.rank)) + this.suit;
  }

  toString() {
    return this.label;
  }

  toJSON() {
    return this.label;
  }
}
