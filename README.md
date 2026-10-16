# Master Card Game

Multi-game card engine — **Callbreak 13** (house variant), Callbreak, Teen Patti,
High Card — with:

- **Solo vs bots** (works fully offline)
- **Multiplayer** on Cloudflare (Workers + Durable Objects), max 4 players
- **Android app** (Capacitor) whose APK is built automatically by GitHub Actions

## Run locally

```bash
npm run play:callbreak8   # terminal, you + 3 bots
npm run serve             # browser at http://localhost:5173 (solo + local multiplayer)
npm test                  # engine tests
```

## Build the web app

```bash
npm run build:offline     # single-file offline HTML
npm run build:app         # Android app assets (www/)
```

## Android APK (no laptop needed)

Push to `main` → **Actions → Build Android APK** → download the artifact
`master-card-game-apk` (contains `app-debug.apk`). Install it on the phone
(allow "unknown sources").

## Cloudflare — multiplayer server

The Worker in `worker/` serves the web app **and** the multiplayer lobby
(one Durable Object per room, addressed by the 4-letter room code). Bots
advance lazily on each request, so no timers are needed and it stays inside
the Workers **free plan** (100k requests/day).

Deploy it one of two ways:

1. **Cloudflare dashboard** → *Workers & Pages* → *Create* → connect this
   repository (Cloudflare builds and deploys on every push), **or**
2. **GitHub Actions** → add repo secrets `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID`, then run the **Deploy Cloudflare Worker** workflow.

After deploy, open the Worker URL on the phone → **Play with Friends**.

## Layout

```
src/core/        game-agnostic engine (cards, deck, turn loop, RNG)
src/games/       games that plug in (callbreak8, callbreak, teenpatti, highcard)
src/players/     Human + Bot controllers
src/ui/web/      browser app + local Node server
worker/          Cloudflare Worker (multiplayer lobby + Durable Object)
tools/           build scripts (offline / pages / capacitor)
www/             built app used by the Android wrapper
```
