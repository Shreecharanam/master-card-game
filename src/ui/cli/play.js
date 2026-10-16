import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { getGame, listGames } from '../../games/GameRegistry.js';
import { Player } from '../../core/Player.js';
import { HumanController } from '../../players/HumanController.js';
import { BotController } from '../../players/BotController.js';

// ---- terminal front-end -------------------------------------------------
// This file is ONLY presentation + the driver loop. All rules live in the
// game classes; all card logic lives in core. Swap this file for a web or
// mobile front-end and the game plays exactly the same.

const gameId = process.argv[2] || 'teenpatti';

if (!listGames().includes(gameId)) {
  console.error(`Unknown game "${gameId}". Choose one of: ${listGames().join(', ')}`);
  process.exit(1);
}

const GameClass = getGame(gameId);

// Seat layout: you, then three bots.
const players = [
  new Player({ id: 'p1', name: 'You', isHuman: true }),
  new Player({ id: 'p2', name: 'Bot Asha' }),
  new Player({ id: 'p3', name: 'Bot Bheem' }),
  new Player({ id: 'p4', name: 'Bot Chitra' }),
];

const rl = readline.createInterface({ input: stdin, output: stdout });

async function ask(question, options) {
  stdout.write(`\n${question}\n`);
  options.forEach((label, i) => stdout.write(`  ${i + 1}. ${label}\n`));
  while (true) {
    const answer = (await rl.question('> ')).trim();
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return n - 1;
    stdout.write('Please enter a number from the list.\n');
  }
}

const human = new HumanController(ask);
const bot = new BotController();
const controllers = new Map(players.map((p) => [p.id, p.isHuman ? human : bot]));

function render(engine) {
  const view = engine.snapshot();
  stdout.write('\n==============================\n');
  stdout.write(`  ${view.game}   Pot: ${view.pot}   Phase: ${view.phase}\n`);
  stdout.write('------------------------------\n');
  for (const p of view.players) {
    const turn = p.id === view.currentPlayerId ? ' <-- turn' : '';
    const status = p.folded ? ' (packed)' : '';
    stdout.write(
      `  ${p.name.padEnd(11)} chips:${String(p.chips).padStart(5)}  [${p.cards.join(' ')}]${status}${turn}\n`
    );
  }
  stdout.write('------------------------------\n');
  for (const line of view.log.slice(-4)) stdout.write(`  . ${line}\n`);
}

async function main() {
  const engine = new GameClass({ players, seed: 42 });
  engine.start();
  render(engine);

  let guard = 0;
  while (!engine.isOver()) {
    if (++guard > 2000) {
      stdout.write('\n(Stopped: too many turns — something is looping.)\n');
      break;
    }
    const player = engine.currentPlayer;
    const actions = engine.legalActions();
    const controller = controllers.get(player.id);
    const action = await controller.decide({ player, actions, engine });
    engine.applyAction(action);
    render(engine);
  }

  const outcome = engine.result();
  stdout.write('\n==============================\n');
  stdout.write(`  WINNER: ${outcome.winner.name}\n`);
  stdout.write('==============================\n');
  rl.close();
}

main().catch((err) => {
  console.error(err);
  rl.close();
  process.exit(1);
});
