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

### Phase 3 — Simple prediction score (Version 1, statistical) ✅ DONE 12 Aug 2026
`predParts()` in js/app.js: predicted GW points = blend(40% draft projection, 30% live
form, 30% official ep_next — weights renormalised over available signals) × fixture ×
availability (official chance-of-playing when present) × momentum. The planner ranks and
displays in predicted-points units; tapping a player shows every factor line by line.
Squads standings stay on fixed draft value by design. The repo was also restructured in
the same phase: index.html + css/app.css + js/data.js + js/app.js, no build step.

### Phase 4 — Prediction accuracy page ✅ DONE 12 Aug 2026
Relay worker + Cloudflare KV (`PREDICTIONS`, binding in relay/wrangler.toml). An hourly
GitHub Actions heartbeat (.github/workflows/snapshot.yml) pings `/snap`; the WORKER decides
in code whether to store — final 2h before the deadline only, immutable once the deadline
passes, last pre-deadline write wins. (Cloudflare cron was impossible: the free plan's 5
cron slots are all held by live OD workers — do not steal one.) The Accuracy tab recomputes
predictions from archived inputs with the same blend (momentum excluded — not archived) and
shows average miss + top-10 hit rate against `/live?event=N` results. Also fixed Leo's
loading-state flaw: 12s fetch timeout feeds the retry path, so a hang can no longer strand
the page on "Loading live data".

### Phases 5-8 — reshaped 12 Aug 2026 from Leo's product review
Leo's review (12 Aug) set the direction for everything below: Meta Rating weights, the
confidence bands, pitch-layout squad builder, and the priority order. His gap table was
partly stale (it predates phase 3 — predicted points, start probabilities and per-GW
predictions already exist) but the product instincts were right.

**Phase 5 — Squad Builder + Meta Rating (official game layer). ✅ DONE 12 Aug 2026**
Builder tab: £100m, 2/5/5/3, max 3 per club, pitch-style layout, per-player Meta chip.
`metaParts()` implements Leo's weights exactly (form 20, predicted points 25, next-5
fixtures 20, minutes 15, value 10, long-term 10), renormalised when a component has no
data yet, with a "Why N?" breakdown at squad level. Optimiser = greedy cheapest-feasible
start + best-single-swap local search to convergence (~0.6s, never brute force); verified
output: legal 15, £100.0m, club cap respected. Suggested swaps with Meta gain shown for
any full squad. Squad saves per device. Strategy toggles (safe/differential) deferred to
phase 6 alongside Best Picks.

**Phase 6 — Best Picks + confidence bands + Player Comparison. ✅ DONE 12 Aug 2026**
Two new tabs. **Best Picks** = the decision engine: captain (with ceiling = per-90 rate
× fixture), warnings from your own squad, transfer targets measured against your weakest
player, differentials under 10% owned, best-per-position, best next-5 fixture runs.
**Compare** = Leo's spec: 2-4 players, Meta bars, category table with the winner
highlighted, verdict (best overall / value / fixtures / differential / safest) and a
plain-English "Why?" that also states what would flip the call. "Find alternatives" pulls
the top 3 same-position players at the same price or cheaper. Builder swap rows and Best
Picks rows both open Compare, so the tools connect. `confidenceOf()` implements the five
bands from 50% minutes certainty + 30% signal agreement + 20% data completeness — it
measures model trust, NOT player quality; keep that distinction in the UI copy.
Ownership (`selected_by_percent`) is now captured from the feed.

**Positioning (Leo's competitor review, 12 Aug).** Fantasy Football Hub, FF Scout, FPL Team
and FPL Review already win the "more statistics" race. Do not enter it. The identity is
**"do not just give me data, tell me what to do and why"** — a decision engine with a
transparent Meta Rating, comparisons that end in a verdict, confidence on every number,
and a public accuracy record. Every future feature should answer "what do I do?" before it
answers "what is the number?".

**Phase 7 — Player prediction page.** Per player: goal %, assist %, clean-sheet %,
60+ minutes %, derived from the feed's expected_goals/assists per-90 suite (confirmed
present 12 Aug) + start probability + written reason. Match predictor stays parked until
this lands; team-level xG aggregates may then make a modest win/draw/loss card honest.

**Phase 8 — Visual redesign.** Premier League-inspired identity of our own (never copied
branding): dashboard command-centre homepage, player cards, pitch UI. Player photos remain
parked pending a properly licensed source; club colours and initials do the visual work
until then.

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
