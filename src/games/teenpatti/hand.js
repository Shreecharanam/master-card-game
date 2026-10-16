// Teen Patti hand evaluation. Pure functions, no engine state — which
// makes them easy to unit-test and reuse (e.g. for a bot's strength guess).

// Categories, strongest first.
export const CATEGORY = {
  HIGH_CARD: 1,
  PAIR: 2,
  COLOR: 3,
  SEQUENCE: 4,
  PURE_SEQUENCE: 5,
  TRAIL: 6,
};

const NAMES = {
  1: 'High Card',
  2: 'Pair',
  3: 'Color',
  4: 'Sequence',
  5: 'Pure Sequence',
  6: 'Trail',
};

// Returns a comparable object: { cat, tie:[...], name }.
// Compare two with compareHands(a, b) > 0 meaning a wins.
export function evaluateHand(cards) {
  const rs = cards.map((c) => c.rank).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);

  const flush = suits[0] === suits[1] && suits[1] === suits[2];
  const trips = rs[0] === rs[1] && rs[1] === rs[2];

  let straight = rs[0] - 1 === rs[1] && rs[1] - 1 === rs[2];
  let high = rs.slice();
  // A-2-3 counts as the lowest run in Teen Patti.
  if (rs[0] === 14 && rs[1] === 3 && rs[2] === 2) {
    straight = true;
    high = [3, 2, 1];
  }

  if (trips) return { cat: CATEGORY.TRAIL, tie: rs, name: NAMES[6] };
  if (straight && flush) return { cat: CATEGORY.PURE_SEQUENCE, tie: high, name: NAMES[5] };
  if (straight) return { cat: CATEGORY.SEQUENCE, tie: high, name: NAMES[4] };
  if (flush) return { cat: CATEGORY.COLOR, tie: rs, name: NAMES[3] };

  if (rs[0] === rs[1] || rs[1] === rs[2]) {
    const pair = rs[0] === rs[1] ? rs[0] : rs[1];
    const kicker = rs[0] === rs[1] ? rs[2] : rs[0];
    return { cat: CATEGORY.PAIR, tie: [pair, kicker], name: NAMES[2] };
  }

  return { cat: CATEGORY.HIGH_CARD, tie: rs, name: NAMES[1] };
}

// > 0  => a beats b ;  < 0 => b beats a ;  0 => tie
export function compareHands(a, b) {
  if (a.cat !== b.cat) return a.cat - b.cat;
  const len = Math.max(a.tie.length, b.tie.length);
  for (let i = 0; i < len; i++) {
    const av = a.tie[i] ?? 0;
    const bv = b.tie[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}
