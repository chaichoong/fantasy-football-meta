# FPL Season HQ — Roadmap

Based on research and planning done by Leo/James (Aug 2026) plus a feasibility review.
Decision made 12 Aug 2026: the app serves **both games, draft league first** — the draft
tools stay, live data serves everything, official-game features arrive as their own layer.

## Principles (from the research, kept on purpose)

1. **Probabilities, never guarantees.** "Start probability 92%", never "guaranteed starter".
2. **The AI never invents the data.** Data feed → prediction score → optimiser → AI explains.
   The model produces the numbers; language only wraps them.
3. **Backtest before boasting.** No accuracy claims until a page records what was predicted
   and what actually happened, every gameweek.

## Confirmed feasible (checked 12 Aug 2026)

- The official FPL API is free, live and complete: 577 players, prices (Haaland £15.5m),
  injury/availability status, chance-of-playing, form, ownership, all 38 gameweek deadlines.
  Endpoints: `bootstrap-static/`, `fixtures/`.
- It sends no CORS headers, so a browser page cannot call it directly. A small relay
  (Cloudflare Worker: fetch, cache ~15 min, add CORS) is required and is standard kit here.

## Phases

### Phase 1 — Live data relay ✅ DONE 12 Aug 2026
Worker live at `https://fpl-relay.kevinbrittain.workers.dev` (`relay/worker.js`): proxies
`/bootstrap` + `/fixtures` only, CORS on, 15-min edge cache, all other paths 404. The app
fetches on load and on refresh: real prices, injuries, chance-of-playing, and official
fixture difficulty for all 38 gameweeks (blank GW = 0, double GW = both games summed).
Manual Fit/Doubt/Out taps override the feed; cycling back to the feed's value returns
control to it. 318 of 319 players mapped to official IDs (`FPLID` in index.html); Rodri is
not in this season's game and stays on static data. The pasted "data pack" now only carries
momentum.

### Phase 2 — Player database upgrade
Price beside every name. Sort by price, predicted points, value (points per £m), start
probability. Better search and filters. Club-badge initials instead of photos.

### Phase 3 — Simple prediction score (Version 1, statistical)
Form + fixture + expected minutes + last season, weights shown openly on the page as
"prediction factors" so anyone can audit why the model likes a player. No ML yet.

### Phase 4 — Prediction accuracy page
Each week, record the predicted top 10 before the deadline; show the real top 10 after.
Simple hit-rate. This is what proves whether the model is any good.

### Phase 5 — Official-game layer
£100m budget tracker, 2 GK / 5 DEF / 5 MID / 3 FWD, max 3 per club, and the squad builder
as a proper constrained optimiser (never brute force). Strategy toggles: safe / balanced /
differential. Multi-gameweek horizon.

### Phase 6 — Captain picker + team news alerts
Expected points AND ceiling (chance of a 10+ haul). Alert when a start probability drops.

## Parked (good ideas, wrong time)

- **Machine-learning models (XGBoost etc.)** — needs historical training data we do not
  hold and months of tuning. Version 1 statistical model first; revisit only if the
  accuracy page shows it is needed.
- **Match win/draw/loss and goal probabilities** — a full match-prediction engine is its
  own product. Fixture difficulty covers most of the value for FPL purposes.
- **Player photos** — licensing risk, and the safe sources cost money. Badge initials
  give most of the visual payoff at zero risk.
- **Betting odds** — not doing gambling odds in any form. Probabilities only.

## Business pivot (12 Aug 2026)

Kevin's call: this is now being built toward a sellable subscription product, not just the
family tool. Two standing risks to carry into every phase:

1. **Data dependency.** The whole product leans on the Premier League's free feed, which has
   no formal commercial licence. Before charging anyone: check the position properly and
   have a plan B data source.
2. **Trademark.** "Fantasy Premier League" and "FPL" branding belong to the Premier League.
   A paid product needs its own name and identity before launch.

Also: the current public repo shows the family's squads and first names. Fine today; strip
or genericise before any public product launch.

## Standing cautions

- Double and blank gameweeks change everything; the optimiser must model them explicitly
  (two fixtures = two scores added), not discover them by accident.
- Prices change during the season; always read them from the live feed, never store them
  in the page.
- The current single-file app will not survive many more features. Restructure into a
  proper small app when Phase 3 lands, not before it is needed.
