# Fantasy Football Meta

**Make smarter moves.**

A fantasy football decision engine: predicted points, Meta ratings, transfer calls and a public accuracy record.

- **Squads** — the three drafted teams with value scores and grades
- **Players** — ~319 scored players, filterable, with a "free agents only" toggle
- **Fixtures** — every club ranked by opening-run difficulty, with gameweek notes
- **GW Plan** — recommended XI per gameweek, bench, waiver targets, injury flags

One score runs everywhere: `week score = draft value × fixture × availability × momentum`.

Everything is in `index.html`. No build step, no dependencies. Prices, injuries,
chance-of-playing and fixture difficulty stream live from the official FPL feed via a small
Cloudflare Worker relay (`relay/worker.js`, deployed with `npx wrangler deploy`). Picks and
injury-override taps save to the browser on whichever device you open it on.

**Live:** https://fantasyfootballmeta.co.uk (pending DNS) · https://chaichoong.github.io/fantasy-football-meta/
