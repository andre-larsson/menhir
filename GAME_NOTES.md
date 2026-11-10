# Menhir (combined build): working notes

Notes for the next session. Kept short on purpose. The README has the rules, controls and island list.

## Where this came from

- Built from `../COMBINED_PLAN.md` in one unattended run (no checkpoint; nobody was available to playtest).
  Started as an unchanged copy of `../game-a/`, which stays as the previous version for side-by-side comparison.
- Took from `../game-b/`: the push model and controls, frost, plain/marked stones, the dead-end bar with
  Rewind, hints, four levels, and the measurement ideas in its `tools/`.

## Decisions agreed with the user (fixed)

- Base: game A's code, art, animation, music, juice, dominoes, sun-marked sockets, bog, tap-to-walk,
  push previews, par and golden suns, portrait rotation on phones, solver.
- Controls from B: no staff (no facing, back-step or sweep). One-tile keeper; walking into a stone
  pushes it; a held key walks but never pushes. A's tap/click-to-walk, swipe and on-screen pad kept.
- Frost from B: after a push, a stone keeps tipping the same way while any part of it is on frost.
- Marks: plain stones only need to stand on a socket; marked stones must also stand mark-up and arrive later.
- Setting: A's twilight lake, but islands have walled shores; water is an occasional hazard tile.

## Provisional (accepted for this build, not yet confirmed by the user)

From the plan's "proposed" list:
- **Frost + dominoes.** As implemented: the keeper's push and its domino chain happen all or nothing
  (A's rule). Then, wave by wave, every stone that still has momentum and any part on frost tips once
  more, front-most first. A sliding stone that is blocked stops where it is; one that knocks other
  stones takes its tip and stops, and the knocked stones carry the momentum on (and slide if they are
  on frost). Previews show every stone's resting pose plus a dotted trail through its tips.
- **Assists:** A's push previews, B's "no way forward" bar with Rewind, and B's hints (`H`).
- **Name:** Menhir.

Taste calls made in this run (all provisional):
- **Par counts pushes**, not key presses as in A: with tap-to-walk, walking is free, and pushes are the
  decisions. A golden sun needs par **and no hints**.
- **Tapping or clicking a stone next to the keeper pushes it** (A's tap only walked). Saves reaching
  for the pad on a phone.
- **The keeper carries a lantern** instead of the staff, with a warm pool of light; facing is cosmetic.
  **New title painting** to match (walled island, lantern, a patch of frost); the old one showed the staff.
- **Walled shore look:** a low dry-stone wall just outside the tile edge. Open water has reedy banks and
  no wall, and is always inside an island (a wall never borders water; `tools/rules-test.js` checks it).
- **Stone looks:** plain stones cool grey with a carved ring on both ends; marked stones warmer grey
  with A's gold band and sun.
- **Dead-end bar on by default**, with a switch in the level select. When too few stones are left it
  says "A stone was lost" and shows even with the switch off.
- **Touch layout:** Hint and Restart sit on the pad next to Undo, so the HUD keeps room for the island name.
- **Level set and order** (below), including keeping Knock-On's story with a pool past the socket, and
  putting Sunside Up in B's Moonstone room.
- Storage keys `menhir2.*`, so A's saved progress is untouched.

## Proxies for "fun", and the latest numbers

Run `node tools/fun.js` (200 bot runs per island, seeded) and `node tools/solve.js --check`.
Chosen from the puzzle proxies in `game-iteration/references/measuring-fun.md`, because the user's
complaints were about complexity, controls and closeness to the reference game, not balance:
- **Necessity** (does the island need what it teaches?): solve again without the mechanic. "needed" =
  unsolvable; "shortcut" = it saves pushes; "SAME" fails `--check`. Stands in for "every island has a point".
- **Greedy-bot solve rate:** a bot that always makes the push bringing stones closest to standing on
  sockets (single-stone push distances, best assignment), never repeats a position. High = no "aha".
- **Dead-end share:** reachable positions from which the island can't be won. How much each push matters.
- **Silent dead ends:** pushes a human-ish bot (greedy, 25% random) makes after the island is lost before
  the game says so, with and without the bar.
- **Busywork:** walking steps per push on the move-optimal solution, and the longest island in moves.
- rand% (random pushes that solve it) as a rough difficulty order.

| # | Island | pushes (par) | moves | walk/push | positions | dead% | greedy% | rand% | detours | silent: no bar / bar | needs |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | First Light | 2 | 4 | 1.0 | 71 | 54 | 100 | 22.5 | 0 | 55.7 / 0 | tutorial |
| 2 | Domino Line | 2 | 3 | 0.5 | 3 | 0 | 100 | 100 | 0 | 0 / 0 | domino needed |
| 3 | Hoarfrost | 3 | 9 | 2.0 | 19 | 63 | 100 | 12.3 | 0 | 1.2 / 0 | frost shortcut (4) |
| 4 | Black Ice | 2 | 7 | 2.5 | 3 | 0 | 100 | 100 | 0 | 0 / 0 | domino needed, frost shortcut (4) |
| 5 | Cascade | 6 | 16 | 1.7 | 33 | 46 | 100 | 10.5 | 2 | 0.8 / 0 | domino needed |
| 6 | Frozen Lane | 6 | 21 | 2.5 | 64 | 70 | 53.5 | 5.8 | 1 | 4.1 / 0 | frost shortcut (7) |
| 7 | Peat Bog | 9 | 32 | 2.6 | 39 | 62 | 1.5 | 0 | 0 | 1.2 / 0 | bog needed |
| 8 | Sunside Up | 5 | 13 | 1.6 | 27 | 78 | 100 | 4.3 | 0 | 1.4 / 0 | mark matters (2 if plain) |
| 9 | Knock-On | 7 | 21 | 2.0 | 154 | 49 | 100 | 12 | 0 | 1.0 / 0 | mark matters, domino shortcut (9) |
| 10 | Marsh Ice | 8 | 23 | 1.9 | 235 | 94 | 0 | 0 | 0 | 3.1 / 0 | bog needed, mark matters, frost shortcut |
| 11 | Odd One Out | 16 | 48 | 2.0 | 243 | 59 | 0 | 0 | 2 | 1.8 / 0 | domino needed, mark matters |
| 12 | Frost Cross | 10 | 42 | 3.2 | 860 | 97 | 0 | 0 | 4 | 4.6 / 0 | domino needed, mark matters, frost shortcut |

Means: walk/push 2.0; longest island 48 moves (A: 60, B: 48); silent pushes 6.2 without the bar, 0 with it.

What the numbers say, and don't:
- **Under the merged rules most of A's and B's levels broke**, as the plan's critique expected:
  Knock-On, Odd One Out and Frost Cross became unsolvable (with walled shores a stone in a 3-row yard can
  never be tipped north or south, so its mark can't be turned), Hoarfrost and Frozen Lane no longer
  needed frost, and A's Sunside Up didn't need its mark. All were rebuilt and re-checked.
- **Walled shores make the bar matter more.** Stones are rarely lost, so without the bar a player on
  First Light would be told nothing for 56 pushes on average after the island is lost.
- **Greedy > 20% on 4 of 8 non-tutorial islands** (Cascade, Frozen Lane, Sunside Up, Knock-On), against
  0 of 6 in B. The bot knows exactly which way up each marked stone will land, which a person doesn't,
  so it understates Sunside Up and Knock-On. Cascade and Frozen Lane are genuinely the gentle middle; the
  hard end (Peat Bog, Marsh Ice, Odd One Out, Frost Cross) defeats the bot completely.
- Frost is a "shortcut" everywhere, never strictly needed: a lone stone can always be followed and pushed
  step by step, so ice only saves pushes or constrains where stones stop. The knock-on rule is what makes
  ice essential (Black Ice).
- The numbers can't tell whether the frost slides are readable, whether the controls feel right, or
  whether Odd One Out's 48 moves feel long.

## Tools (`tools/`, development only)

- `rules-test.js` (64 checks), `solve.js` (par, necessity, `--check`, `--show`), `show.js` (solution as
  boards), `fun.js` (proxies), `climb.js` (hill-climbing placement search; seeds in `tools/seeds/`).
- Browser (headless Chrome over a pipe, `cdp.js`; game served on port 8861): `input-test.js` (47 checks:
  keys, held keys, queueing, undo/restart/rewind, bar switch, hints, previews, click/tap/swipe/pad,
  portrait rotation, device rotation mid-puzzle, page errors), `check-browser.js` (replays every
  solution in the page), `shot.js` (screenshots, e.g. a phone viewport).
- Page hooks: `window.menhir`, `?level=N`, `?play=NESW…`, `?touch=1|0`.

## Determinism

The rules are a pure function of the level and the key presses: no randomness, no clocks, integer
positions, stable iteration order (front-most stone first in frost waves, then index). A replay is just
a key string (`?play=`). Cosmetic randomness (particles, fireflies, music) never touches the state. The
bots use a seeded PRNG. The in-page analysis is time-sliced but its result doesn't depend on the slicing.

## Art style preamble (for any new images)

"Painterly, soft brush texture, like a gouache illustration. Twilight over a still lake: deep indigo
starry sky, warm orange and rose glow low on the horizon, distant blue mountains. Small grassy islands
ringed by low dry-stone walls, mossy weathered standing stones, a small hooded keeper in an orange-red
cloak carrying a glowing lantern. No text." In-game art is drawn in code in the same palette
(`COL` in `js/render.js`).

## Open questions for playtesting

- How do the controls feel now, on a keyboard and on a phone? Is tap-a-stone-to-push welcome or a hazard?
- Can you predict where a frost slide stops, and who gets knocked, before pushing? Do the dotted trails help?
- Does counting pushes (not moves) for par feel right?
- Do the assists (previews, bar, hints) make it feel too guided? Does anyone turn them off?
- Is the ramp right: plain stones for 7 islands, then marked ones? Is Odd One Out (16 pushes) too long?
- Do the walled shores and lantern read as a different game from Sausage Roll?
