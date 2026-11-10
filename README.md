# Menhir

*Raise the stones before dawn.*

Menhir is a small, deliberate puzzle game for the browser. You are a hooded keeper with a lantern on
tiny walled islands in a twilight lake. On each island, stand a stone on every socket. The stones are
tall blocks that topple, roll and rise as you push them, knock each other over like dominoes, and slide
across frost.

**Play it:** https://andre-larsson.github.io/menhir/ (desktop or phone, portrait or landscape)

There are twelve islands, from a two-push tutorial to a sixteen-push finale. You don't need to read
anything first: the game teaches each rule on the island that brings it in.

## How to play

- **Goal:** stand a stone on every socket. Marked stones (gold band) must stand with the sun to the sky.
- **Move** with the arrow keys or WASD, or click a tile to walk there. On a phone, swipe the board, use
  the pad, or tap a tile.
- **Push** by walking into a stone (or tapping it from beside it). Holding a key walks but never pushes.
- A standing stone **topples**. A lying stone **rises** when pushed along its length and **rolls** when
  pushed from the side.
- **Dominoes:** a moving stone knocks on any stone in its way. If anything in the chain is blocked,
  nothing moves.
- **Frost:** a stone keeps tipping until it is off the ice. If it hits another stone, it stops and
  knocks that one on.
- **Bog** swallows a stone and becomes firm ground. **Water** swallows it for good.

## Help when you want it

- **Dashed outlines** show where every push you can make right now would leave the stones, including
  whole chains and frost slides. Turn them off with the eye button or `P`.
- **No way forward:** as soon as a push leaves the island unwinnable, a bar says so. **Rewind** goes back
  to the last position that can still be won.
- **Hint** shows the next push. **Undo** is free and unlimited.
- **Par** is the fewest pushes that solve an island. Match it without hints for a **golden sun**.

| Action | Keyboard | Touch |
| --- | --- | --- |
| Walk, push | Arrow keys or WASD | Pad, swipe, or tap |
| Undo | `Z` or `Backspace` | Undo |
| Rewind from a dead end | `Shift Z` | Rewind on the bar |
| Restart (can be undone) | `R` | Restart |
| Hint | `H` | Hint |
| Push previews on/off | `P` | Eye button |
| Islands | `Esc` | Grid button |
| Next island | `Enter` | Next island |
| Sound | `M` | Speaker button |

Tips can be turned off, or shown again, in the island list. Progress and settings are saved in your
browser only.

## The islands

| # | Island | |
| --- | --- | --- |
| 1 | First Light | Push, topple and raise a stone |
| 2 | Domino Line | Dominoes |
| 3 | Hoarfrost | Frost |
| 4 | Black Ice | Frost and dominoes together |
| 5 | Cascade | Set up the dominoes |
| 6 | Frozen Lane | Two stones, two sockets, one lane of frost |
| 7 | Peat Bog | Bog and water |
| 8 | Sunside Up | The first marked stone |
| 9 | Knock-On | Billiards |
| 10 | Marsh Ice | Bog, frost and a marked stone |
| 11 | Odd One Out | One stone the wrong way up |
| 12 | Frost Cross | The finale |

Every island can be picked from the list at any time.

## Run it locally

It is plain HTML, CSS and JavaScript with no build step and no dependencies. Serve the folder with any
static file server:

```sh
python3 -m http.server 8861 --bind 127.0.0.1
# then open http://127.0.0.1:8861/
```

Opening `index.html` straight from disk also works.

## About

Menhir is an original game. From block-pushing puzzle games it borrows only the general idea of pushing
blocks that roll and turn over. The islands, the rules (dominoes, frost knock-ons, bog, sun-marked
stones), the art and the names are its own. Everything in play is drawn in code; the title painting was
generated with an image model. Music and sounds are synthesized in the browser.

Working notes, decisions and the development tools are in [GAME_NOTES.md](GAME_NOTES.md) and
[AGENTS.md](AGENTS.md).
