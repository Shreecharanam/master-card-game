# Architecture

Ye document batata hai ki engine **andar se kaise bana hai** aur ek turn
ka data kaise flow hota hai. README quick-start ke liye hai; ye deeper
reference hai.

## Layers

Project teen saaf layers me bata hua hai. Ek layer sirf apne se upar wali
layer ko jaanta hai — kabhi neeche wali ko nahi.

```
  ┌──────────────────────────────────────────────────────┐
  │  UI layer        src/ui/{cli,web}                     │  dikhata hai + input leta hai
  ├──────────────────────────────────────────────────────┤
  │  Controllers     src/players/{Human,Bot}Controller    │  "kya karna hai" decide karta hai
  ├──────────────────────────────────────────────────────┤
  │  Rules layer     src/games/*                          │  ek game ke rules
  ├──────────────────────────────────────────────────────┤
  │  Core engine     src/core/*                           │  cards, deck, turn loop, RNG
  └──────────────────────────────────────────────────────┘
```

Niyam: **core** ko `games` ke baare me nahi pata; **games** ko UI ke baare
me nahi pata; **UI** me ek bhi rule nahi. Isi wajah se ek hi engine kai
games aur kai platforms par chalta hai.

## Har file ka kaam

| File | Zimmedari | Kya NAHI karta |
|---|---|---|
| `core/Card.js` | rank (2–14) + suit rakhta hai | koi rule nahi |
| `core/Deck.js` | 52 cards, shuffle, draw | ye nahi jaanta kaun khel raha |
| `core/Player.js` | hand, chips, folded, seen | koi decision nahi |
| `core/RNG.js` | seedable random | — |
| `core/GameEngine.js` | turn loop + state + hooks | koi game rule nahi |
| `games/*/X.js` | us game ke rules | UI/IO bilkul nahi |
| `players/*Controller.js` | move chunna | rules lagana nahi |
| `ui/*` | render + input | koi rule nahi |

## GameEngine ka contract (hooks)

`GameEngine` ek abstract base hai. Har game in paanch hooks ko bharta hai:

| Hook | Kab chalta hai | Kya return karta hai |
|---|---|---|
| `createInitialState()` | `start()` par ek baar | state ka shuruaati object |
| `setup(state)` | turant baad | deck shuffle + deal (state ko badalta hai) |
| `legalActions(state)` | har turn | `[{ type, label, ... }]` |
| `applyAction(action, state)` | player ke move par | state update (turn aage badhata hai) |
| `result(state)` | game khatam hone par | `{ winner, ranking }` |

Base class ye shared helpers deta hai: `currentPlayer`, `activePlayers()`,
`nextActiveIndex()`, `log()`, `isOver()`, aur `snapshot()`.

## Ek turn ka poora flow

```
 driver (play.js / app.js)
   │
   │  engine.start()
   ├──────────────────────────────► GameEngine.createInitialState() -> setup()
   │
   │  while (!engine.isOver()) {
   │
   │     engine.currentPlayer        -> state.players[turnIndex]
   │     engine.legalActions()       -> GameClass.legalActions(state)
   │     controller.decide(...)      -> Human/Bot ek action chunta hai
   │     engine.applyAction(action)  -> GameClass.applyAction(state)
   │                                     ├─ action lagao (pay/fold/raise)
   │                                     ├─ turnIndex = nextActiveIndex()
   │                                     ├─ round pura? -> round++
   │                                     └─ khatam? -> finish() -> phase='done'
   │     engine.snapshot()           -> UI-safe view (doosron ke cards chhupe)
   │  }
   │
   └─ engine.result()               -> winner + pot payout
```

## State: sach ek jagah

Engine ki poori sach `this.state` object me hai. `snapshot()` uski ek
**UI-safe copy** deta hai jisme doosre players ke cards `??` ho jaate hain
(jab tak showdown na ho). Iska matlab:

- UI ke paas kabhi poora state nahi hota — cheating possible nahi.
- Networking aasan: sirf `snapshot()` bhejna hai, aur `applyAction()`
  receive karna hai (multiplayer ke liye ready).

## Teen Patti ke rules (jo implement hue)

- Har player ko **3 cards**; sab **boot (ante)** daalte hain.
- Betting rounds (default 3). Har turn par: **pack** (fold), **call**,
  **raise** (stake double), ya **see** (apne cards dekho).
- `see` turn khatam nahi karta — pehle dekho, phir decide karo.
- Sab fold kar dein → bacha hua player pot le jaata hai.
- Warna showdown: hand ranking se jeet tay hoti hai.

Hand ranking (upar wala jeetta hai):

```
Trail (3 same) > Pure Sequence (straight flush) > Sequence (straight)
> Color (flush) > Pair > High Card
```

A-2-3 ko sabse chhota valid sequence maana gaya hai (asli Teen Patti ki tarah).

## Callbreak ke rules (jo implement hue)

- **4 players**, 52-card deck, **13 cards** each, koi team nahi.
- **Bidding phase:** har player 1–13 ke beech call karta hai. Bidding poora
  hone par hi playing shuru hoti hai.
- **Playing phase:** 13 tricks. **Spades fixed trump (hukum)** hain.
  Follow-suit rule: agar led suit haath me hai to wahi khelna padta hai,
  warna kuch bhi. Trick winner = sabse badi trump, warna sabse badi led-suit.
- **Scoring:** tricks >= call → `+call`; warna `-call` (penalty call ke
  barabar / "mines").
- **5 rounds:** scores cumulative jodte hain; `state.history` me har round
  ka call/tricks/delta record rehta hai. Round ka starting player rotate
  hota hai.
- Trick logic `callbreak/tricks.js` me hai (`beats`, `trickWinner`,
  `wouldWin`) — pure functions, isliye alag se test kiye ja sakte hain.

## Callbreak 13 ke rules (house variant)

- **13 cards** per player (5 first, then 8), 4 players, 5 rounds.
- **Deal 5 cards** → **auction** (first call >= 5, raise or pass; each
  higher call cancels the previous; highest caller wins).
- Deal the **remaining 8** cards. The auction winner picks the **trump**
  (any suit) and leads.
- **Calling phase:** all four players (winner included) declare their
  tricks after seeing 13 cards, minimum 1. A final call of **10+** lets
  that player **override the trump** (a second `trump2` phase).
- **13 tricks** with the follow-suit rule; scoring `+call` / `-call`.
- The **lowest scorer deals** the next round.
- Action types: `auction` | `pass` | `trump` | `declare` | `play`.

## Multiplayer

`server.js` ek chhota lobby API deta hai (`/api/create`, `/api/join`,
`/api/state`, `/api/start`, `/api/action`, `/api/restart`). Server ek
`Callbreak8` engine rakhta hai, bot seats ko khud chalata hai, aur har
player ko `snapshot(state, viewerId)` ke through **sirf uske cards** bhejta
hai. Isi wajah se headless engine ka faayda milta hai — same engine solo
(browser me) aur online (server par) dono jagah chalta hai.

## Testing

`tests/engine.test.js` zero-dependency hai (plain Node + chhota `check()`).
Ye hand-ranking, deck integrity, seeded-RNG reproducibility aur engine loop
ko verify karta hai. `npm test` → 14/14 pass.

## Extensibility kyun aasan hai

- **Naya game:** `GameEngine` extend karo + registry me ek line. Bas.
- **Naya platform:** UI layer badlo, engine same rehta hai.
- **Behtar AI:** `BotController` replace karo, baaki kuch nahi badalta.
- **Multiplayer:** headless engine + `snapshot()`/`applyAction()` — server
  par wahi engine chalega jo browser me chalta hai.
