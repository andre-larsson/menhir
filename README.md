# Menhir

*Raise the stones before dawn.*

Menhir is a small, deliberate puzzle game for the browser. You are a hooded keeper with a lantern, working
on tiny walled islands in a twilight lake. Stand a stone on every **socket**. The stones are tall 1×1×2
blocks: they topple, roll and rise as you push them, they **knock each other over like dominoes**, and on
**frost** they keep tipping across the ice and knock on whatever they hit. Plain stones count either way
up; the **marked stones** of the later islands only count with their sun mark facing the sky.

This build combines two earlier versions made from the same brief: the look, dominoes, previews, music
and level ideas of *Menhir* (`../game-a/`), with the simpler controls, frost, dead-end warning and some
levels of *Tipstone* (`../game-b/`). It is a demo with twelve islands, from a two-push tutorial to a
sixteen-push puzzle.

## How to run

It is plain static HTML/CSS/JavaScript, with no build step and no dependencies. Serve the folder with
any static file server and open it in a browser:

```sh
cd combined-x
python3 -m http.server 8000      # or: npx serve .   (any static server works)
# then open http://localhost:8000
```

Opening `index.html` straight from disk (`file://`) also works, since nothing is fetched at runtime.
Progress (best push counts and golden suns) and settings are saved in `localStorage`, under keys of
their own, so this build never mixes scores with the earlier Menhir.

## Controls

| Action | Keyboard / mouse | Touch (phone/tablet) |
| --- | --- | --- |
| Walk; walk into a stone to push it | Arrow keys or WASD | On-screen pad, or swipe on the board |
| Walk to a tile (never pushes) | Click the tile (hover shows the route) | Tap the tile |
| Push a stone right next to you | Click it | Tap it |
| Undo (unlimited) | `Z`, `Backspace`, `U` or `Ctrl/Cmd+Z` | **Undo** button |
| Rewind to the last winnable position | `Shift+Z`, or **Rewind** on the "no way forward" bar | **Rewind** on the bar |
| Restart (can itself be undone) | `R` | **Restart** button |
| Hint: the next push | `H` or the bulb button | **Hint** button |
| Push previews on/off | `P` or the eye button | Eye button |
| Level select | `Esc` or `L` | Grid button (top left) |
| Next island after solving | `Enter` or `N` | **Next island** |
| Previous / next island | `[` / `]` | Level select |
| Sound on/off | `M` or the speaker button | Speaker button |
| Music on/off | **Music** button in the level select | same |

The keeper is one tile and has no facing: every key moves one step that way, and walking into a stone
pushes it. **Holding a key keeps walking but never pushes**, so a stone only moves on a fresh key press.
Keys typed during an animation are queued, and the animation speeds up to keep pace. A click-to-walk
route is undone in one step.

## Rules

- **Pushing.** Walk into a stone to push it; you step into the tile it leaves. A **standing** stone
  **topples** onto the next two tiles. A lying stone pushed **along its length** **rises** on the tile
  beyond. Pushed **from the side**, it **rolls** one tile.
- **Dominoes.** A moving stone knocks on any stone in its way, in the same direction, and that stone can
  knock on the next. If anything in the chain is blocked, nothing moves. Standing stones two tiles apart
  topple in a chain; standing stones side by side jam. A stone falling onto the end of a lying stone
  stands it up.
- **Frost.** A pushed stone keeps tipping the same way while any part of it is on frost, and stops once
  it is completely off the ice. A stone that is blocked stops where it is, even on frost.
  A stone sliding on frost that hits another stone **knocks it on and stops**; the knocked stone slides
  on if it lands on frost. You walk on frost normally.
- **Sockets.** Stand a stone on every socket. **Plain stones** (cool grey) count whichever end is up.
  **Marked stones** (warmer grey, with a gold band) count only with the **sun mark facing the sky**;
  the band is at the marked end. A marked stone standing upside down on a socket gets a pulsing rose
  ring. A lying stone across a socket doesn't count.
- **Walled shores.** Every island is ringed by a low dry-stone wall. Stones stop against it, and so do you.
- **Water.** Open water inside an island swallows a stone for good. **Bog** swallows a stone too, but
  the bog under it becomes firm ground. You can't wade into either.

## Help when you want it

- **Push previews.** While you stand still, dashed outlines show where the stones would come to rest
  for every push you can make right now, with an arrow for the key. Chains and frost slides are shown in
  full: every stone that would move gets an outline, and a dotted trail marks each tip across the ice.
  Gold means a stone would be set on its socket, rose means upside down, blue means it would sink in
  water, brown that it would sink into bog.
  A gold dot marks a marked stone's sun end. `P` turns previews off.
- **"No way forward."** The game solves each island when it loads. As soon as a push leaves the island
  unwinnable, a bar says so, and **Rewind** (`Shift+Z`) undoes back to the last position that can still
  be won. The bar can be switched off in the level select.
- **Hint** (`H`). Marks the tile to push from and the direction, and says how many pushes remain.
- **Par and golden suns.** Each island's par is the fewest pushes that solve it (found by the solver).
  Solving within par and without hints earns a golden sun. The level select shows your best and your suns.

## Islands

| # | Island | Idea | Par (pushes) |
| --- | --- | --- | --- |
| 1 | First Light | Tutorial: topple a stone, then raise it onto the socket. | 2 |
| 2 | Domino Line | Three stones in a row on a causeway. One push topples all three; a second raises all three onto their sockets at once. | 2 |
| 3 | Hoarfrost | Frost: a stone that lands on the ice keeps tipping until it is off it. | 3 |
| 4 | Black Ice | Frost meets dominoes: send a stone across the ice into one you can't reach. It knocks that one onto its socket and stops. | 2 |
| 5 | Cascade | Three sockets on a causeway, three stones in the yard, and you start between them. Line them up end to end so two pushes fire them all. | 6 |
| 6 | Frozen Lane | Two stones, two sockets, and a lane of frost between them. The last push raises both at once. | 6 |
| 7 | Peat Bog | A two-tile bog cuts the bridge. Stand one stone on exactly the right tile and topple it to fill both, then bring the other across. Open water waits for a careless push. | 9 |
| 8 | Sunside Up | The first marked stone. The straight route stands it upside down. | 5 |
| 9 | Knock-On | The stone at the tip of the spit would rise upside down. Bring the second stone behind it: the knock-on shoves the first into the water as the second rises sun-up in its place. | 7 |
| 10 | Marsh Ice | A marked stone needs a road across the bog, and the two plain stones are the road. | 8 |
| 11 | Odd One Out | A domino line in which one stone would land upside down. Move it aside, fire the other two, turn it around in the yard, then fire it. | 16 |
| 12 | Frost Cross | Two marked stones on a cross of frost, both sun to the sky. The ice decides how they land. | 10 |

Every island can be picked from the level select at any time. Islands 1–7 use only plain stones; marked
stones arrive at island 8, and after that they are mixed with plain ones.

On a portrait phone, wide islands are shown rotated by 90°. The rules are symmetric under rotation,
so it is the same puzzle with bigger tiles. If you rotate the device mid-puzzle, the board, push count
and undo history carry over.

## What this build takes from each earlier game

- **From Menhir (`game-a`):** the twilight-lake art, 3D tipping stones, animation, screen shake, beams of
  light and fireflies, the generative music and sounds, dominoes, sun-marked sockets, bog, tap-to-walk,
  push previews, par with golden suns, the portrait rotation on phones, and the levels First Light,
  Domino Line, Cascade, Peat Bog, Knock-On and Odd One Out (all re-solved, most rebuilt).
  Sunside Up keeps its name and idea but now lives in Tipstone's Moonstone room.
- **From Tipstone (`game-b`):** a one-tile keeper with no staff, walk-into-to-push, held keys that never
  push, frost, plain and marked stones, the "no way forward" bar with Rewind, hints, and the levels
  Hoarfrost, Frozen Lane, Marsh Ice and Frost Cross. Its measurement tools were the starting point for
  `tools/`.
- **New:** walled shores with water as an occasional hazard, the frost-and-dominoes interaction, previews
  that show whole chains and slides, the keeper's lantern, a new title painting, and Black Ice.

## Design notes

- **What is borrowed from the reference game, and what isn't.** The brief was a puzzle game inspired by
  the mechanics of Stephen's Sausage Roll. This build borrows only the general idea of pushing
  multi-tile objects that roll and turn over. It does not have a tool that reaches ahead or sweeps when
  turning, the islands are walled rather than open to the water, and the objects are tipping standing
  stones whose footprint alternates between one and two tiles. Dominoes, frost slides that pass their
  momentum on, bog-filling and sun marks are this game's own. The theme, art, names and levels are original.
- **Levels were built and checked with a solver.** Each island was drawn around one idea, then the
  solver checked that it can be won, set its par, and confirmed that the idea is actually needed
  (`node tools/solve.js --check`, below). Searches in `tools/climb.js` helped place stones on the
  hand-drawn islands.
- **Art.** Everything in play is drawn on a canvas. Stones are real 3D boxes in an oblique projection, so
  they visibly tip over an edge. When a tall stone stands in front of the keeper, a faint outline of the
  keeper shows through it. The only raster image is the title painting (`art/title.jpg`), generated with
  the Codex CLI image tool; its prompt is in `assets-src/prompts.md`.
- **Sound and music** are synthesized with the Web Audio API (no audio files). They start after your first input.
- **All islands are unlocked**, because this is a demo and reviewers may want to jump ahead.

## Verifying the game (optional, for developers)

The Node tools import the same rules module the game uses (`js/logic.js`). The browser checks need
Google Chrome and the game served at `http://127.0.0.1:8861/index.html` (or set `MENHIR_URL`).

```sh
node tools/rules-test.js       # every rule above, on tiny boards (64 checks)
node tools/solve.js --check    # solve every island; fail if a par is wrong or an island doesn't need what it teaches
node tools/solve.js --show 7   # also print the move-optimal key presses
node tools/show.js 7           # print island 7's push-optimal solution as a sequence of boards
node tools/fun.js              # puzzle proxies per island (greedy bot, dead ends, busywork); see GAME_NOTES.md
python3 -m http.server 8861 --bind 127.0.0.1 &
node tools/input-test.js       # real keyboard, mouse and touch input in headless Chrome (47 checks)
node tools/check-browser.js    # replay every island's solution in the page and check the win
node tools/shot.js out.png "level=4" 390 844 3 mobile   # screenshot an island, here as a phone
```

The page exposes a small `window.menhir` object (state, `load(i)`, `input(dir)`, `tap(x, y)`, `undo()`,
`rewind()`, `hint()`) and accepts `?level=N` and `?play=NESW…` in the URL; the automated checks use
them. Players never need them.

## Files

```
index.html        page shell, HUD, menus, touch pad
css/style.css     layout and UI styling (desktop, portrait and landscape phone)
js/logic.js       pure game rules (parsing, pushes, domino chains, frost slides, win check, rotation)
js/solver.js      push-level solver shared by the page (dead ends, hints) and the tools
js/levels.js      island definitions (ASCII maps, hints, par)
js/render.js      canvas renderer (projection, stones as 3D boxes, walls, frost, previews, effects)
js/audio.js       synthesized sound effects and generative music
js/main.js        input (keys, pad, swipe, tap), undo/rewind/hints, animation scheduling, level flow, saving
art/title.jpg     title painting
assets-src/       full-size original of the title painting and its prompt
tools/            development tools (tests, solver, proxies, level search); not needed to play
```
