# Nerdle Rush

**An endless runner where the only way forward is the true equation.**

Three lanes. Equations race towards you on tile panels. Run through a true one and it shatters into a coin; run into a false one and the run is over, instantly. No shield, no second chance, no matter how far you've come. In between come Subway-Surfers-style walls, hurdles and beams, sometimes in the same row as the maths.

It's the Nerdle skill — *does this calculation hold?* — compressed into a second, under pressure, getting faster.

> An unsolicited prototype for [Nerdle](https://nerdlegame.com). Built by [Ravjoth Brar](https://ravjothbrar.com).

| Start | Tutorial | Running |
|---|---|---|
| ![Start screen](docs/start.jpg) | ![Tutorial](docs/tutorial.jpg) | ![Running](docs/running.jpg) |

| Caught out | Game over | Mathlete dark mode | Phone |
|---|---|---|---|
| ![Caught out](docs/caught.jpg) | ![Game over](docs/game-over.jpg) | ![Mathlete](docs/mathlete.jpg) | ![Phone](docs/mobile.jpg) |

---

## Play

```bash
npm install
npm run dev        # http://localhost:5173
```

| | Keyboard | Touch |
|---|---|---|
| Change lane | ← → or A D | swipe left / right |
| Jump (barriers) | ↑, W or Space | swipe up |
| Duck (beams) | ↓ or S | swipe down |
| Pause | P or Esc | ⏸ button |

The first time you press **PLAY** you get a short guided tutorial: steer, jump, duck, walls, and "equation or hurdle?". The world freezes at each teaching moment until you do the right thing, and a wrong move gets an explanation ("5+3=9 is false — 5+3 is 8") rather than a game over. It's skippable, and you can replay it from *All rules*.

## The design, in one paragraph

The maths is the point, so the maths is unforgiving: running into a false equation always ends the run. The platforming is not the point, so it's forgiving: walls, hurdles and beams follow standard runner rules — you carry one shield, the first hit costs the shield and your streak multiplier, the second hit ends the run. **Soft on reflexes, hard on maths.**

## How it plays

Everything arrives as a **row**: three lanes side by side, reaching you at the same moment, on an even beat. Rows are never bunched together. Each lane holds one of:

| Lane | What it is | What to do |
|---|---|---|
| **Equation panel** | a standing board of Nerdle tiles | run through it if it's **true** (coin); a false one ends the run |
| **Wall** | a tall 3D block of black tiles | can't be jumped or ducked — switch lanes (you can't sidestep into one that's passing you, either) |
| **Hurdle** | a low bar | jump |
| **Beam** | a tall overhead gantry with a hazard-striped underside | duck |
| Open | nothing | run straight through |

There are three kinds of row:

- **Maths rows:** three equations, exactly one true. This is the core of the game and always the majority (never more than two non-maths rows in a row).
- **Mixed rows:** maths next to physical obstacles. Either a true and a false equation beside a wall (pick the true one), or **one equation, true or false, beside a hurdle or beam and a wall**. Take the equation only if it's true; otherwise take the physical route.
- **Obstacle rows:** no maths, just per-lane walls, hurdles and beams in different combinations.

Every row always has at least one lane you can get through cleanly. A test plays 12 seeds for 3 minutes each with an autopilot to prove it.

**Exactly one of three is true in a maths row, and there's no shortcut.** Each equation is generated independently; one is left true and the others are perturbed. If the decoys were built from the true equation (7×8=56 / 7×8=54 / 7+8=56), you could find the answer without doing any maths — pick the lane that shares the most with the other two. With independent lanes every panel is an honest true-or-false check. (There's a test for this.)

**Big, readable maths.** The camera sits high and looks down the track, like Subway Surfers: the horizon is near the top of the screen and rows spread down its full height, so you can read two or three rows ahead. On laptops, panels show the equation in two lines (`12+39` / `=51`). On phones they switch to right-aligned column arithmetic (`12` / `+39` / `=51`), which roughly doubles the tile size. Tile size is uniform from row to row, so a near panel never hides the one behind it.

**Decoys are believable, and get sneakier as your score climbs.** Decoy sharpness is driven by *whichever is further along — time survived or correct answers* — so a strong player hits the hard stuff quickly:

| Decoy | Example | Why it fools you |
|---|---|---|
| Offset | 14+7=**19** | early: off by 3–8 · sharp: off by just 1–2 |
| Forgotten carry / borrow | 47+28=**65**, 52−17=**45** | off by exactly 10 — the units digit is *right*, so the lazy last-digit check fails |
| Times-table neighbour | 7×8=**48**, 56÷8=**6** | the row next door — the classic slip |
| Swapped operator | 9**+**3=6 | the numbers are right, the sign isn't (absurd swaps like 29×8=21 are filtered out) |

Decoys keep the same tile count as the true equation wherever possible, so length is never a tell. Equations never exceed **8 tiles** — the length of a classic Nerdle row.

**Difficulty ramp**

| When | What changes |
|---|---|
| 0s | + and − only, maths rows only, 2.5s between rows, two rows already on the track so the first coin lands at ~3.5s |
| 8s | walls, hurdles, beams and mixed rows join in |
| 20s | × unlocks |
| 45s | ÷ unlocks |
| ongoing | row interval eases 2.5s → 1s; a row is on screen for 5.9s at the start, easing to 2.4s; operands grow |
| score-driven | decoys sharpen from "obviously wrong" to near-misses and classic slips |
| 40+ correct | **overdrive**: the track keeps accelerating past the time curve (up to 1.5×), with a ⚡ callout every 15 more |

**Scoring.** Each true lane is a coin worth 10 × your multiplier. The multiplier goes up by one every 5 correct in a row (max ×5) and resets to ×1 when you hit an obstacle. Distance and time are tracked as secondary stats.

**Game over explains itself.** *"You picked 7×8=54 — it's actually 56"*, with your pick in plum, the corrected equation, and the true lane in teal — plus a Nerdle-style share card (🟩 correct · 🟨 shield lost · 🟪 caught out · ⬛ crashed).

**Daily Rush.** A seeded run that's identical for everyone on a given day (*Daily #N*), like Nerdle's daily puzzle.

## Brand

Classic mode mirrors nerdlegame.com: plum `#7A1F4B`, teal `#4E9E8E`, white chrome, rounded pill buttons, equation tiles exactly like the Nerdle board (unrevealed → white, true → teal, false → plum). The **mathlete** toggle mirrors Nerdle's mathlete spin-off: navy `#1e1e2e` with hot magenta `#c8447a`. Type is Nunito (tiles, UI) and Quicksand (wordmark), bundled locally. The runner is the Nerdle cube — from behind it wears the "n", and when you're caught out it spins round to face you, aghast.

## Performance

Built to hold 60fps on a mid-range phone. The renderer:

- caches everything static (sky, track, rails) once per resize
- rasterises each equation panel and obstacle face once into a sprite, then only scales it, at most one new sprite per frame
- batches the moving track seams into one fill
- clears only the region of the front layer that was painted last frame
- caps canvas resolution by pixel budget

If frames still run long, adaptive quality lowers the resolution a notch, keeping its sprites, and raises it back once there's headroom. React only re-renders when a HUD number changes.

`npm run perf` (headless Chromium, **no GPU**, in overdrive at top speed):

| Profile | Before optimisation | Now |
|---|---|---|
| Laptop 1440×900 @2x | 31 fps | **60 fps** |
| Phone 390×844 @3x, CPU throttled 4× | 17 fps | **57–60 fps** |
| Phone 390×844 @3x, CPU throttled 6× | 12 fps | **57 fps** |

## Tests

```bash
npm test           # 80 unit + component tests (Vitest)
npm run build && npm run e2e    # real Chromium: tutorial, runs, caught-out screens
npm run build && npm run perf   # frame-rate benchmark
```

The unit tests check things like:
- every maths row has exactly one true lane, verified by recomputing the maths rather than trusting the generator
- no negatives, fractions or more than 8 tiles
- lane lengths match; the true lane's position is uniform
- no "odd one out" shortcut
- ×/÷ unlock at 20s/45s
- decoy margins and kinds at each sharpness level; sharp decoys are mostly close cuts
- no absurd operator swaps
- every generated row has a survivable lane, never three walls, and maths stays the majority
- rows arrive on an even beat
- a false equation kills even with a shield and 30 correct behind you
- walls can't be jumped, ducked or sidestepped into mid-pass
- shield and multiplier rules; invulnerability frames; jump and duck timing
- overdrive speed-ups
- a perfect autopilot survives 3 minutes on 12 seeds, so every run is fair
- same seed gives the same run
- the tutorial can't be failed, even by random mashing
- share-card text

The e2e test plays with real key presses, deliberately steers into a false lane, and checks the "it's actually…" value is arithmetically correct.

## Architecture

```
src/
  game/            pure logic — no DOM, fully unit-tested
    equations.js     generator: true equations, decoys, explanations
    rows.js          what arrives in each lane: maths / mixed / obstacle rows
    difficulty.js    every difficulty knob, as pure functions of time/score
    engine.js        the simulation: createGame / step(game, dt, actions)
    tutorial.js      scripted first-play lessons on top of the real engine
    scoring.js  share.js  bot.js  rng.js
  render/          canvas renderer, projection, colour themes
  components/      React: GameView (rAF loop), HUD, screens, mascot, tiles
  audio.js         procedural Web Audio sound effects (no audio files)
  input.js         keyboard + swipe → 'left' | 'right' | 'jump' | 'duck'
e2e/               Playwright smoke test + performance benchmark
```

The engine runs on a fixed 120Hz timestep and emits events (`coin`, `death`, `shield`, `unlock`, `speedup`, …). The renderer, audio and HUD only ever *read* state and react to those events. The start screen's background is the same engine driven by an autopilot.

## Deploy

`npm run build` produces a fully static `dist/` with relative asset paths, so it works from any host or sub-path.

It deploys to **GitHub Pages** through `.github/workflows/deploy.yml` on every push to `main`. One-time setup: *Settings → Pages → Source: GitHub Actions*. With `ravjothbrar.com` configured on the user site, the game is served at **ravjothbrar.com/nerdle/**. There's deliberately no `CNAME` in this repo, because that would claim the whole domain. `ci.yml` runs unit tests, the build and the Chromium e2e test on every other branch and PR.
