# AGENTS.md instructions for menhir

<INSTRUCTIONS>
- Primary goal: Menhir, a small browser puzzle game (plain HTML/CSS/JS, no build step, no dependencies), published as a GitHub Pages project site at `https://andre-larsson.github.io/menhir/`.
- Repository: project Pages site; `.github/workflows/pages.yml` deploys from GitHub Actions on push to `main`.
- Run locally: `python3 -m http.server 8861 --bind 127.0.0.1`, then open `http://127.0.0.1:8861/`.
- Build: `sh tools/build-site.sh` copies only the runtime files (`index.html`, `css/`, `js/`, `art/`) into `_site/`.
- Tests (Node, seconds): `node tools/rules-test.js`, `node tools/solve.js --check`, `node tools/fun.js` (compare with the table in GAME_NOTES.md).
- Tests (headless Chrome, game served on port 8861 or `MENHIR_URL`): `node tools/input-test.js`, `node tools/check-browser.js`, `node tools/teach-test.js`.
- Checks: `node tools/shots.js out/` screenshots every screen at every target viewport; `node tools/opening.js [--phone]` measures the opening.
- Notes: read GAME_NOTES.md first (decisions the user confirmed, provisional calls, measurements, open questions). For game design or iteration work, follow the game-iteration skill. Keep paths relative (the site lives under `/menhir/`) and localStorage keys prefixed `menhir2.`.
</INSTRUCTIONS>
