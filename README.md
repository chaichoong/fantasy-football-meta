# FPL Season HQ · 2026/27

A single-page Fantasy Premier League planner for a 3-manager draft league (Kevin v Leo v James).

- **Squads** — the three drafted teams with value scores and grades
- **Players** — ~319 scored players, filterable, with a "free agents only" toggle
- **Fixtures** — every club ranked by opening-run difficulty, with gameweek notes
- **GW Plan** — recommended XI per gameweek, bench, waiver targets, injury flags

One score runs everywhere: `week score = draft value × fixture × availability × momentum`.

Everything is in `index.html`. No build step, no server, no dependencies. Picks and
injury flags save to the browser on whichever device you open it on.

**Live:** https://chaichoong.github.io/fpl-season-hq/
