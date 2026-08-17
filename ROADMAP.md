# Fantasy Football Meta — Roadmap

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

**Phase 7 — Player prediction page. ✅ DONE 12 Aug 2026**
`eventProbs()` = Poisson off the official expected-goals suite (xG/90, xA/90, xGC/90),
scaled by expected minutes (start prob → ~82 mins starter / ~22 sub) and by fixture
(attacking rates × fixture multiplier, conceding ÷ it). Gives P(goal), P(assist),
P(60+ mins), P(any return), and P(clean sheet) for GK/DEF. **Returns null under 180
minutes of evidence — the page says "not enough evidence yet" rather than showing 0%.**
Only 335 of 581 players have xG data, so this guard matters. Ruled-out and blank-gameweek
cases handled separately. Player profile opens from any row anywhere (`openPlayer()`):
header, event probabilities, Meta breakdown, confidence reasoning, next-6-GW fixture
stars with per-week predicted points, and a compare-with-alternatives action.
NOTE: event probabilities are deliberately NOT wired into the headline predicted-points
number. Two competing points figures is exactly the metric inconsistency that burned
Kevin in the first build — the blend stays the single source of the number.

**Phase 8 — Visual redesign. ✅ DONE 12 Aug 2026**
Built from Leo's mockup with two deliberate departures, both deliberate and both to be kept:
1. **No Premier League logo or branding.** The mockup put the PL crest in the sidebar. That
   is their trademark and this is heading for sale, so the identity is our own violet/indigo
   palette, not the PL purple/pink/cyan set.
2. **No player photographs.** Club-coloured initial avatars instead, until a licensed image
   source exists (see Parked).
Delivered: sidebar shell with 10 sections (collapses to a scrolling nav under 860px), light
content area on dark sidebar, Dashboard home (4 hero cards, top players, 6-GW fixture
difficulty grid, Meta donut, team news, CTAs), Team News section (availability news ranked
above completed transfers — the feed mixes both), deadline card, and a full light-theme
token remap. Hero card 3 adapts: biggest price riser once prices move, best value until then.

**Meta v2 (same phase).** Adopted the mockup's seven factors: form 25, fixtures 20,
underlying threat (xG/xA, or xGC for keepers/defenders) 20, minutes security 15, value 10,
differential 5, long-term 5. Predicted points was REMOVED as a component — form, fixtures,
threat and minutes are its own ingredients, so including it double-counted. The mockup's
vague "other factors 5%" was given a concrete name (long-term quality). Ratings moved as a
result; nothing in the accuracy record depends on Meta, so no history was invalidated.

## Still open from Leo's mockup (not built)

- ~~**Transfers planner**~~ ✅ DONE 12 Aug 2026. `planTransfers()`: every legal same-position
  swap scored over a 1/3/5/8-GW horizon, constrained by bank, club cap and squad size;
  best single, best pair (search over the top 60 singles, no brute force), and deduped
  alternatives so each incoming player appears once. `verdictLine()` does the hit
  arithmetic and gives ONE answer — it will tell you to do the single move when the pair
  gains more raw points but nets less. Squad source: My Team picks when live, otherwise the
  Builder squad. **Free transfers and (preseason) bank are user-set — the API publishes
  neither; never fake them.** Selling price approximated at current price, stated on the page.
- **Pro tools** — sidebar now says everything is free and open with nothing to buy. Keep it
  truthful; do not add a fake paywall or sign-in.
- ~~**My Team**~~ ✅ DONE 12 Aug 2026. Relay routes `/entry?id=` and `/picks?id=&gw=`
  (numeric-validated, public read-only, 404 passed through so "not published yet" is
  distinguishable from "relay broken"). My Team tab: id saved to localStorage, team
  verified on load, then captain check, your-XI-vs-model with the points each swap is
  worth, warnings, transfer targets. `ensurePlayer()` synthesises a rateable record from
  the feed for players outside the curated 319 (last season's points as index proxy) and
  flags them `ext` so they never enter the ranked pools or the optimiser.
  **Preseason constraint:** the official game 404s all picks until the first deadline, so
  the tab confirms the team and waits. Verified against a simulated squad, since no real
  picks exist yet — re-verify against a real team after the GW1 deadline.
- ~~**Price Changes**~~ ✅ DONE 12 Aug 2026. Four parts: moved-this-GW (from
  `cost_change_event`), our own recorded change log, under-pressure estimate, and the
  user's own squad value change (`cost_change_start`).
  **The important bit: the official API keeps NO price history — only the current net
  change.** So `takePriceSnapshot()` in the relay records one daily snapshot to KV and
  appends real deltas to a rolling `price:changes` log (capped 400), exposed at
  `/pricechanges`. Recording began 2026-08-12; that log is the only place this history
  exists, and it is a genuine product differentiator. One KV write per day, guarded
  against duplicates.
  "Under pressure" is an ESTIMATE and is labelled as one everywhere — the real algorithm
  is undisclosed, so it ranks net transfers weighted by ownership. Never present it as a
  guaranteed overnight change. All four parts verified against simulated live data since
  every price field is zero preseason.
- **Login / accounts** — deliberately NOT built. Instead: account-free cross-device sync
  ("Devices" section, 12 Aug 2026) — an export/import code carrying only the six known
  localStorage keys, validated on import so an arbitrary key can never be written. No
  server, no PII, no password, nothing to breach. This meets the actual user need
  (setup follows you between devices) at zero legal weight.

## BLOCKERS before charging anyone (Kevin's decision, 12 Aug 2026)

Asked to build accounts + a Pro tier; stopped and escalated instead. Three things must be
settled first, and two are commercial calls only Kevin can make:

1. ~~**Trademark.**~~ RESOLVED 12 Aug 2026. Renamed to **Fantasy Football Meta**. "Fantasy
   football" is the generic category term (used commercially by Scout, Hub and Fix), and
   "Meta" sits as the trailing distinctive word rather than the leading brand element, so
   neither the Premier League's "FPL" mark nor Meta Platforms' leading-brand claim applies
   as it would have to "Meta FPL". Domain: fantasyfootballmeta.co.uk.
   STILL REQUIRED before charging: a proper trademark search. A free domain is not a
   cleared mark.
2. **Data licence.** Every number comes from the PL's free feed with no commercial
   licence. Selling access to it is materially different from personal use. Needs a
   proper check, and a plan B source.
3. **Architecture + money handling.** GitHub Pages is static and cannot hold secrets, so
   payments need a real backend (Cloudflare Worker + Stripe Checkout) plus terms, refunds,
   a privacy notice and a GDPR basis. Claude must never handle Stripe keys or card details.

Until 1 and 2 are cleared, the honest position is what the sidebar now says: free and open,
no paid tier, nothing to buy.

## Draft-league system REMOVED (13 Aug 2026, Leo's call)

The three-manager draft league the product grew out of is gone from the site: the Draft
Squads section, the draft-league GW Plan (with its waiver list), per-player ownership
badges, the "Free only" filter, and the `OWNER`/`NAMES` maps in the data. This also
completed the pre-launch cleanup of family names and squads from a public repo.

Consequences worth knowing:
- **Best Picks and the Dashboard now resolve ONE squad automatically** via `trSquad()`:
  the linked FPL team if there is one, otherwise the Squad Builder squad. With neither,
  they show a link-your-team prompt and the dashboard falls back to "Top predicted".
- **The availability override (Fit/Doubt/Out) moved to the player profile.** It only
  existed inside the deleted planner; losing it would have removed the ability to overrule
  the feed. `setInj()` replaces `cycleInj()`.
- **Language changed everywhere**: "draft projection" is now "season projection",
  "draft value" is "baseline quality". `VAL`/`GRC` remain as curated baseline ratings for
  45 players; consider normalising them so every player is rated by the same formula.
- Player records no longer carry an `o` (owner) property at all.

## Parked (good ideas, wrong time)

- **Machine-learning models (XGBoost etc.)** — needs historical training data we do not
  hold and months of tuning. Version 1 statistical model first; revisit only if the
  accuracy page shows it is needed.
- **Match win/draw/loss and goal probabilities** — a full match-prediction engine is its
  own product. Fixture difficulty covers most of the value for FPL purposes.
- **Player photos** — licensing risk, and the safe sources cost money. Badge initials
  give most of the visual payoff at zero risk.
- **Betting odds** — not doing gambling odds in any form. Probabilities only.

## Architecture (settled 12 Aug 2026)

Decided by what the product actually needs, not by matching OD for its own sake.

| Layer | Choice | Why |
|---|---|---|
| Hosting | **Cloudflare Pages** (`fantasy-football-meta`) | Static site. Same host as OD's `od-affiliates` and `content-machine-app`, so one vendor and one dashboard. |
| Data/API | **Cloudflare Worker** `fpl-relay` | Already live. Adds CORS to the official feed, caches it, records prices. |
| Storage | **Cloudflare KV** `PREDICTIONS` | Prediction snapshots + the daily price history. |
| Source | **GitHub** `chaichoong/fantasy-football-meta` | Source of truth; also still serves GitHub Pages as a fallback host. |
| Domain | **Namecheap DNS** (not Cloudflare DNS) | www.fantasyfootballmeta.co.uk is the canonical URL. |

**Explicitly NOT used, and why:**
- **Vercel** — nothing to server-render. Cloudflare Pages already hosts static sites here, and the Worker + KV are on Cloudflare, so adding Vercel means two vendors for one small app.
- **Hostinger** — no need for shared hosting at all.
- **Supabase** — there is no user data, no accounts and no relational data. Everything a user has lives on their own device by design. Revisit ONLY if accounts are built, and even then Workers + D1/KV may be enough.

**DNS (13 Aug 2026).** The domain is now on **Cloudflare DNS** (nameservers
`leia.ns.cloudflare.com` / `marty.ns.cloudflare.com`, set at Namecheap). Both apex and www
are proxied CNAMEs to `fantasy-football-meta.pages.dev`; Cloudflare flattens the apex CNAME,
which is the thing Namecheap could not do. The 5 MX + SPF records were imported so email
forwarding is untouched.
**Note:** the API token is scoped to the pre-existing zones and has NO permission on this new
zone, so DNS record changes here need the dashboard until a scoped token is made. Zone id
`271cfd9fa3589531aa0cfe2bb9ccd5d7`.

**Deploy note:** the Pages project was created by API and deploys via `wrangler pages deploy`.
To make it auto-deploy on push, connect the repo in the Cloudflare dashboard (OAuth).
Do NOT put the existing Cloudflare token into GitHub Actions secrets — it is broad-scoped
(DNS + Workers + Pages across every zone including operationsdirector.co.uk) and this repo
is public. If CI deploys are wanted, create a Pages-only scoped token first.

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
