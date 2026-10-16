// A player seat at the table. Holds no game logic — just the data a
// game needs to track about someone: their hand, chips and status.

export class Player {
  constructor({ id, name, chips = 1000, isHuman = false, isBot = false }) {
    this.id = id;
    this.name = name;
    this.chips = chips;
    this.isHuman = isHuman;
    this.isBot = isBot;
    this.reset();
  }

  reset() {
    this.hand = [];
    this.folded = false;
    this.seen = false;
    this.bet = 0; // total chips this player put in this game
  }

  pay(amount) {
    const paid = Math.min(amount, this.chips);
    this.chips -= paid;
    this.bet += paid;
    return paid;
  }

  receive(amount) {
    this.chips += amount;
  }
}
