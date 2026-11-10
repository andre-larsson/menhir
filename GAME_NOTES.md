# Menhir: working notes

Notes for the next session: decisions, what the user confirmed, what is still provisional, measurements,
tools and open questions. The README has the player-facing rules and controls.

## Where the game came from

- **An A/B test.** Two agents got the same brief: an original browser puzzle game inspired by the
  mechanics of Stephen's Sausage Roll, then "make it a LOT more fun". One built *Menhir* without the
  game-iteration skill (twilight-lake art, 3D tipping stones, dominoes, push previews, music, par and
  golden suns, a staff with facing). The other built *Tipstone* with it (frost, bog, plain and marked
  stones, hints, a "no way forward" bar with Rewind, measured fun proxies).
- **User verdict:** Menhir had the better look and the cool domino levels, but its controls were
  disliked and it was too close to Sausage Roll. Tipstone was simpler but fun, with good special tiles.
  Wanted: Menhir's game with Tipstone's controls and tiles.
- **Combined plan,** built twice in one unattended run each, by two models. The user played both and
  preferred this build's level design. Under the merged rules most of the original levels broke (walled
  shores make a stone in a three-row yard unable to tip north or south, frost became optional), so all
  twelve islands were rebuilt and re-checked with the solver.
- **Final pass ("Teach + polish"),** this repo. The user confirmed every provisional choice of the
  combined build and froze the rules, the twelve islands, their layouts and par. The work was teaching
  the rules in play and an interface pass. The bar for it came from the user's criticism of another game:
  a flat visual hierarchy (many equally weighted elements and texts), small text, and crucial rules
  hidden in a long help page instead of being taught in play.

## Decided (confirmed by the user)

- **Base:** the Menhir look, animation, music and effects; dominoes; sun-marked sockets; bog; tap or
  click to walk; push previews; par and golden suns; portrait rotation on phones; the solver.
- **Controls:** no staff, no facing. A one-tile keeper; walking into a stone pushes it; a held key walks
  but never pushes. Tap or click a tile to walk there; swipe and the on-screen pad on touch.
  **Tapping or clicking a stone next to the keeper pushes it.**
- **Frost:** after a push, a stone keeps tipping the same way while any part of it is on frost.
- **Frost and dominoes:** the push and its domino chain happen all or nothing. Then, wave by wave, every
  stone with momentum and any part on frost tips once more, front-most first. A blocked sliding stone
  stops where it is; one that knocks other stones takes its tip and stops, and the knocked stones carry
  the momentum on (sliding if they land on frost). Previews show every stone's resting pose plus a
  dotted trail through its tips.
- **Marks:** plain stones count either way up; marked stones count only sun-up and arrive at island 8.
- **Assists:** push previews, the "no way forward" bar with Rewind (on by default, switchable), hints.
  A golden sun needs par **and** no hints.
- **Par counts pushes**, not moves.
- **Name:** Menhir. **The keeper carries a lantern.** **Walled shores** (a low dry-stone wall; open water
  only inside an island, never against a wall). **The look** (cool grey plain stones with a carved ring,
  warmer marked stones with a gold band and sun). **The island set and order** below.
- **Difficulty:** don't make islands harder or easier. Islands the greedy bot finds "too easy" felt
  "a bit tricky" to the user (the bot simulates every push exactly; people have to imagine them), so a
  high greedy-bot rate is not a reason to change an island.
- **Rules, islands, layouts and par stay as they are.** A fix that needs a rule or level change goes to
  the open questions below instead.

## Provisional (taste calls in the final pass; the user hasn't seen them yet)

Each can be judged and undone on its own.

1. **Lessons live in a message row** under the island name (desktop and portrait phones) or above the
   pad (landscape phones), not in overlays on the board and not in a separate tutorial level. One step at
   a time, with what the step talks about outlined on the board.
2. **Six islands carry a lesson** (table below), with the copy in `js/coach.js`. First Light has three
   steps (goal and walking, pushing and the preview, rising); Peat Bog two; the rest one.
3. **One-off tips** in a gold-labelled toast for moments that can happen anywhere: a blocked push, a held
   key stopping at a stone, open water (when a preview or push first sinks a stone), and an offer of
   Hint. The dead-end bar adds one line explaining Rewind the first time it appears.
4. **When Hint is offered:** from island 3 on, after two dead ends or two restarts on one visit, or after
   90 seconds with at least par pushes made. Once ever; the Hint button glows for 7 seconds.
5. **Nothing repeats:** a lesson is remembered once its island is solved or its x is pressed; tips once
   shown. Switch "Tips while playing" and button "Show all tips again" in the island list.
   `?coach=0` hides lessons for one page load (used by tools).
6. **Riddle line:** islands without a lesson show their one-line riddle (the `hint` in `js/levels.js`)
   until solved; solved islands show no message row, so the board is bigger. The six lesson islands'
   riddles were shortened to one plain line, since the rules moved into lessons; Hoarfrost's was
   reworded ("A patch of ice lies between the stone and its socket.").
7. **Title screen:** a big Play button first ("Play", then "Continue" or "Play on", naming the island it
   goes to: the current one, or the next unsolved one after a win). Then the island grid, then settings,
   then a collapsed "How to play" reference (a short definition list). Enter starts. The help page no
   longer opens on the first visit.
8. **HUD hierarchy:** island number and name; push count large with "pushes · par N" beneath; Undo,
   Restart and Hint labelled with their keys on wide keyboard screens (Undo slightly raised); previews,
   sound and the island-list button as quiet borderless icons. On phones, Undo/Hint/Restart live on the
   pad (Undo the biggest).
9. **Type scale** 13 / 14 / 15 / 16 / 17 / 20-22 / 30 px with a 13 px floor everywhere (checked);
   lesson text 17 px (16 on phones), pad labels 13 px in normal case instead of tiny capitals.
10. **Win card:** "Next island" primary, "Replay" (or "Try again" when not a golden sun) secondary, an x to
    stay and look. The move count was dropped from the stats (par counts pushes). On landscape phones
    the card sits over the board column, not the pad. The message row dims after a win.
11. **Touch:** the d-pad glows during First Light's first step. The pad buttons are slightly larger
    (60x52) on tall phones.
12. **Short screens:** a slimmer title painting so Play stays in view on landscape phones.
13. **Favicon:** an inline gold sun on indigo (no extra file, no 404 on the shared domain).
14. **Storage keys** keep the `menhir2.` prefix from the combined build: `menhir2.progress`,
    `menhir2.muted`, `menhir2.music`, plus `menhir2.coach` for lessons and tips.

### Lessons and tips

| Island | Lesson (chip) | Steps advance on | Board outline |
| --- | --- | --- | --- |
| 1 First Light | How to play: the goal and walking (keys or touch wording) / walk into the stone, the dashed outline / it toppled, push along its length | move / push / win | stone and socket / stone / socket |
| 2 Domino Line | New: dominoes | win | stones, sockets |
| 3 Hoarfrost | New: frost (and the dotted trail) | win | frost |
| 4 Black Ice | New: frost and dominoes | win | the far stone, frost |
| 7 Peat Bog | New: bog and water / where it sank is firm ground | bog fill / win | bog and water / filled bog |
| 8 Sunside Up | New: marked stones (gold band, gold dot in the preview) | win | marked stone, socket |

Tips (once each): `blocked`, `held`, `water` (covered by the Peat Bog lesson), `hint`, `rewind` (in the
bar). Upside-down marked stones still get their per-visit toast and the rose ring.

## Measurements

### Puzzle proxies (`node tools/fun.js`, 200 seeded bot runs per island; unchanged by the final pass)

Chosen because the user's complaints were about complexity, controls and closeness to the reference
game, not balance:
- **Necessity:** solve again without the mechanic; "needed" = unsolvable, "shortcut" = saves pushes.
- **Greedy-bot solve rate:** a bot that always makes the push bringing stones closest to standing on
  sockets. High means no "aha" for the bot, but see "Difficulty" above: it overstates ease for people.
- **Dead-end share:** reachable positions from which the island can't be won.
- **Silent dead ends:** pushes a human-ish bot (greedy, 25% random) makes after the island is lost before
  the game says so, with and without the bar.
- **Busywork:** walking steps per push on the move-optimal solution; the longest island in moves.

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

Means: walk/push 2.0; longest island 48 moves; silent pushes 6.2 without the bar, 0 with it.
Frost is a shortcut everywhere, never strictly needed: a lone stone can always be followed and pushed
step by step. The knock-on rule is what makes ice essential (Black Ice).

### The opening (`node tools/opening.js [--phone]`)

From the title of a first visit, playing the optimal moves with a 250 ms reaction gap. Words are the
distinct instruction text put in front of the player, read at 200 words a minute. A person also thinks,
so these are floors for comparing versions.

| | Inputs | Playing | Words shown | Reading | About |
| --- | --- | --- | --- | --- | --- |
| Title to First Light solved, before the final pass | 5 | 3.0 s | 320 (How to play opened itself) | 96 s | 99 s |
| Title to First Light solved, now (keys) | 5 | 3.0 s | 57 | 17 s | 20 s |
| Title to First Light solved, now (phone pad) | 5 | 3.1 s | 65 | 20 s | 23 s |
| Title to Domino Line solved, before | 9 | 6.2 s | 345 | 104 s | 110 s |
| Title to Domino Line solved, now (keys) | 9 | 6.3 s | 76 | 23 s | 29 s |
| Title to Domino Line solved, now (phone pad) | 9 | 6.5 s | 84 | 25 s | 32 s |

Inputs and playing time are unchanged (Enter or one tap starts; nothing to dismiss). What changed is the
reading: the rules arrive one at a time on the island that needs them.

### Readability

`tools/teach-test.js` lists every rendered text node below 13 px on the title, the help reference, a
lesson and the win card, at 1280x800, 390x844, 360x640, 844x390 and 640x360: none. No sideways scrolling
on any of them, and the Play button is in view on the title without scrolling.

## Tools (`tools/`, development only; never shipped)

- Node only (seconds): `rules-test.js` (64 rule checks), `solve.js` (par and necessity; `--check`,
  `--show N`), `show.js N` (solution as boards), `fun.js` (proxies above), `climb.js` (hill-climbing
  stone placement; seeds in `tools/seeds/`).
- Headless Chrome over a pipe (`cdp.js`), game served on port 8861 or `MENHIR_URL`:
  `input-test.js` (48 checks: keys, held keys, queueing, undo, restart, rewind, the bar switch, hints,
  previews, click, tap, swipe, pad, portrait rotation, turning the phone mid-puzzle),
  `check-browser.js` (replays every solution in the page), `teach-test.js` (66 checks: title, lessons,
  tips, no repeats, the tips switch, text sizes, and a full run from the title through all 12 islands;
  `--quick` skips the full run), `opening.js` (above), `shots.js <dir>` (every screen at every target
  viewport), `shot.js` (one screenshot).
- `build-site.sh [dir]` copies the runtime files (index.html, css/, js/, art/) to `_site/`; the Pages
  workflow runs it after the Node checks. To check the sub-path, build into `<tmp>/menhir`, serve
  `<tmp>`, and set `MENHIR_URL=http://127.0.0.1:<port>/menhir/` for the browser tests.
- Page hooks: `window.menhir` (state, `load`, `input`, `tap`, `undo`, `rewind`, `hint`, `coach()`),
  `?level=N`, `?play=NESW…`, `?touch=1|0`, `?coach=0`.

## Determinism

The rules are a pure function of the level and the key presses: no randomness, no clocks, integer
positions, stable iteration order (front-most stone first in frost waves, then index). A replay is a key
string (`?play=`). Cosmetic randomness (particles, fireflies, music) never touches the state. The bots
use a seeded PRNG. The in-page analysis is time-sliced, but its result doesn't depend on the slicing.
Lessons react to the same move events and never change the state.

## Art style preamble (for any new images)

"Painterly, soft brush texture, like a gouache illustration. Twilight over a still lake: deep indigo
starry sky, warm orange and rose glow low on the horizon, distant blue mountains. Small grassy islands
ringed by low dry-stone walls, mossy weathered standing stones, a small hooded keeper in an orange-red
cloak carrying a glowing lantern. No text." In-game art is drawn in code in the same palette (`COL` in
`js/render.js`). The title painting's prompt is in `assets-src/prompts.md`; no images are queued.

## Open questions for playtesting

- Could you play from the title through all twelve islands without opening How to play?
- What did you look at first on the title, in play and on the win card?
- Do the lessons say the right thing at the right moment? Is anything missing (rolling a lying stone
  isn't taught in a lesson; the previews show it), or does anything nag?
- Is the message row in the right place on your phone, or does it take too much of the board?
- How do the controls feel on a keyboard and on a phone? Is tap-a-stone-to-push welcome or a hazard?
- Can you predict where a frost slide stops, and who gets knocked, before pushing?
- Would need a level change (not made): First Light has 54% dead positions, so most new players will
  meet the "no way forward" bar on the very first island. That teaches Rewind early, but it may feel
  like a stumble at the door.
- Would need a level change (not made): Odd One Out is 16 pushes and 48 moves; is it too long?
- Would need a rule or level change (not made): frost is never strictly needed except through the
  knock-on rule. Does that matter to you?
