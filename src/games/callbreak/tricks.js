// Callbreak trick rules. Pure functions, no engine state — same style as
// teenpatti/hand.js, so they are easy to unit-test.

export const TRUMP = 'S'; // Spades are always the trump ("hukum") in Callbreak.

// Does `challenger` beat the `current` best card of a trick?
// led  = suit that was led ; trump = trump suit
export function beats(challenger, current, led, trump = TRUMP) {
  const cTrump = challenger.suit === trump;
  const bTrump = current.suit === trump;

  // A trump always beats a non-trump.
  if (cTrump !== bTrump) return cTrump;
  // Two trumps: higher rank wins.
  if (cTrump && bTrump) return challenger.rank > current.rank;

  // Neither is a trump: only the led suit can win, by rank.
  const cLed = challenger.suit === led;
  const bLed = current.suit === led;
  if (cLed !== bLed) return cLed;
  if (cLed && bLed) return challenger.rank > current.rank;

  // Both are off-suit and non-trump: nobody wins.
  return false;
}

// Given a completed trick [{playerId, card}], return the winning entry.
export function trickWinner(trick, trump = TRUMP) {
  const led = trick[0].card.suit;
  let best = trick[0];
  for (let i = 1; i < trick.length; i++) {
    if (beats(trick[i].card, best.card, led, trump)) best = trick[i];
  }
  return best;
}

// Would `card` win the trick as it currently stands?
export function wouldWin(card, trickSoFar, trump = TRUMP) {
  if (trickSoFar.length === 0) return true;
  const led = trickSoFar[0].card.suit;
  let best = trickSoFar[0].card;
  for (const entry of trickSoFar) {
    if (beats(entry.card, best, led, trump)) best = entry.card;
  }
  return beats(card, best, led, trump);
}
