import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, normalize, relative } from 'node:path';

// Builds ONE self-contained HTML file.
//   node tools/build-offline.js          -> src/ui/web/offline/master-card-game.html
//   node tools/build-offline.js --pages  -> dist-pages/index.html (GitHub Pages;
//                                           online/multiplayer button hidden,
//                                           since Pages cannot run a server)
//
// It bundles the ES modules with a tiny in-file module registry, so each
// module keeps its own scope and the whole thing runs as a plain <script>.

const root = fileURLToPath(new URL('..', import.meta.url)); // project root
const PAGES = process.argv.includes('--pages');
const CAPACITOR = process.argv.includes('--capacitor');
// Multiplayer server URL baked into the app (for the Android build).
const SERVER_URL = process.env.MCG_SERVER || '';

const FILES = [
  'src/core/RNG.js',
  'src/core/Card.js',
  'src/core/Deck.js',
  'src/core/Player.js',
  'src/games/callbreak/tricks.js',
  'src/games/teenpatti/hand.js',
  'src/core/GameEngine.js',
  'src/games/highcard/HighCard.js',
  'src/games/teenpatti/TeenPatti.js',
  'src/games/callbreak/Callbreak.js',
  'src/games/callbreak8/Callbreak8.js',
  'src/games/GameRegistry.js',
  'src/players/BotController.js',
  'src/ui/web/app.js',
];

const keyOf = (fromFile, spec) =>
  relative(root, normalize(join(dirname(join(root, fromFile)), spec)));

function transform(file, src) {
  const imports = [];
  const exports = new Set();
  const body = [];

  for (const line of src.split('\n')) {
    const imp = line.match(/^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/);
    if (imp) {
      imports.push({
        names: imp[1].split(',').map((s) => s.trim()).filter(Boolean),
        from: keyOf(file, imp[2]),
      });
      continue;
    }
    const exp = line.match(/^export\s+(?:const|let|var|function|class)\s+([A-Za-z0-9_$]+)/);
    if (exp) {
      exports.add(exp[1]);
      body.push(line.replace(/^export\s+/, ''));
      continue;
    }
    if (/^export\s*\{/.test(line)) {
      line
        .replace(/^export\s*\{|\}\s*;?\s*$/g, '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((n) => exports.add(n));
      continue;
    }
    body.push(line);
  }

  const importLines = imports
    .map((i) => `const { ${i.names.join(', ')} } = __mods[${JSON.stringify(i.from)}];`)
    .join('\n');
  const exportLine = `return { ${[...exports].join(', ')} };`;

  return `__mods[${JSON.stringify(file)}] = (function () {\n${importLines}\n${body.join('\n')}\n${exportLine}\n})();`;
}

const overrides = {};
if (PAGES || CAPACITOR) {
  const appPath = 'src/ui/web/app.js';
  const replacement = CAPACITOR
    ? 'const CAN_GO_ONLINE = !!(typeof window !== "undefined" && window.MCG_SERVER); // Android: online only when a server URL is set'
    : 'const CAN_GO_ONLINE = false; // GitHub Pages: static only';
  overrides[appPath] = readFileSync(join(root, appPath), 'utf8').replace(
    /const CAN_GO_ONLINE = .*;/,
    replacement
  );
}

const modules = FILES.map((f) => transform(f, overrides[f] ?? readFileSync(join(root, f), 'utf8'))).join('\n\n');
const bundle = `(function () {\nconst __mods = {};\n${modules}\n})();`;

const css = readFileSync(join(root, 'src/ui/web/style.css'), 'utf8');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Master Card Game</title>
<style>
${css}
</style>
</head>
<body>
<header><h1>Master <span>Card Game</span></h1></header>
<main id="app"></main>
${SERVER_URL ? `<script>window.MCG_SERVER = ${JSON.stringify(SERVER_URL)};</script>\n` : ''}<script>
${bundle}
</script>
</body>
</html>
`;

const outFile = PAGES
  ? join(root, 'dist-pages/index.html')
  : CAPACITOR
    ? join(root, 'www/index.html')
    : join(root, 'src/ui/web/offline/master-card-game.html');
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, html);
const label = PAGES ? 'Pages' : CAPACITOR ? 'Capacitor' : 'offline';
console.log(`Built ${label} app: ${html.length} bytes -> ${relative(root, outFile)}`);
