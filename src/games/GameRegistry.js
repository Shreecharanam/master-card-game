import { HighCard } from './highcard/HighCard.js';
import { TeenPatti } from './teenpatti/TeenPatti.js';
import { Callbreak } from './callbreak/Callbreak.js';
import { Callbreak8 } from './callbreak8/Callbreak8.js';

// The one place that knows which games exist. Adding a new game is a
// two-line change here — nothing else in the engine needs to know.

const registry = new Map();

export function registerGame(id, GameClass) {
  registry.set(id, GameClass);
}

export function getGame(id) {
  const GameClass = registry.get(id);
  if (!GameClass) {
    throw new Error(`Unknown game "${id}". Available: ${listGames().join(', ')}`);
  }
  return GameClass;
}

export function listGames() {
  return [...registry.keys()];
}

registerGame('highcard', HighCard);
registerGame('teenpatti', TeenPatti);
registerGame('callbreak', Callbreak);
registerGame('callbreak8', Callbreak8);
