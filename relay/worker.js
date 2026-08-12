// FPL data relay + prediction snapshot engine.
// Relay: the official FPL API sends no CORS headers, so browsers cannot call it
// directly. This worker proxies read-only endpoints, adds CORS, and caches at the
// edge for 15 minutes.
// Snapshots (phase 4): an hourly cron archives the model's inputs to KV in the
// final 2 hours before each gameweek deadline. The day and hour are decided IN
// CODE from the feed's own deadline_time — never in the cron expression (Cloudflare
// cron day-of-week semantics have burned this codebase before). Snapshots become
// immutable at the deadline: no write is accepted for a gameweek whose deadline
// has passed, so the accuracy record can never be quietly rewritten.
const UPSTREAM = "https://fantasy.premierleague.com/api";
const CACHE_SECS = 900;
const SNAP_WINDOW_MS = 2 * 60 * 60 * 1000; // start snapshotting 2h before deadline

const CORS = { "Access-Control-Allow-Origin": "*" };
const jsonResp = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

async function proxy(target, ctx, ttl) {
  const cache = caches.default;
  const cacheKey = new Request(target);
  let resp = await cache.match(cacheKey);
  if (!resp) {
    const upstream = await fetch(target, {
      headers: { "User-Agent": "fpl-season-hq-relay/1.0" },
    });
    if (!upstream.ok) {
      // Preserve 404 so callers can tell "this does not exist yet" (picks before the
      // season starts, unknown team id) from "the relay is broken".
      if (upstream.status === 404) return jsonResp({ error: "not found upstream", upstream: 404 }, 404);
      return jsonResp({ error: "upstream " + upstream.status }, 502);
    }
    resp = new Response(upstream.body, upstream);
    resp.headers.set("Cache-Control", "public, max-age=" + (ttl || CACHE_SECS));
    resp.headers.set("Access-Control-Allow-Origin", "*");
    resp.headers.delete("Set-Cookie");
    ctx.waitUntil(cache.put(cacheKey, resp.clone()));
  } else {
    resp = new Response(resp.body, resp);
    resp.headers.set("Access-Control-Allow-Origin", "*");
  }
  return resp;
}

async function fetchJson(path) {
  const r = await fetch(UPSTREAM + path, {
    headers: { "User-Agent": "fpl-season-hq-relay/1.0" },
  });
  if (!r.ok) throw new Error("upstream " + r.status + " on " + path);
  return r.json();
}

// Archive the model's inputs for the next gameweek. Refuses once the deadline has
// passed (immutability); overwrites freely before it (last pre-deadline write wins,
// which is exactly the record we want to judge).
async function takeSnapshot(env, force) {
  const bs = await fetchJson("/bootstrap-static/");
  const next = bs.events.find((e) => e.is_next) || bs.events.find((e) => e.is_current);
  if (!next) return { skipped: "no upcoming gameweek" };
  const deadline = new Date(next.deadline_time).getTime();
  const now = Date.now();
  if (now > deadline) return { skipped: "deadline passed for GW" + next.id + "; record is frozen" };
  if (!force && deadline - now > SNAP_WINDOW_MS)
    return { skipped: "GW" + next.id + " deadline not within 2h window" };

  const fixtures = await fetchJson("/fixtures/?event=" + next.id);
  const short = {};
  bs.teams.forEach((t) => (short[t.id] = t.short_name));
  const players = {};
  bs.elements.forEach((e) => {
    players[e.id] = [
      parseFloat(e.ep_next) || 0,
      parseFloat(e.form) || 0,
      e.status === "a" ? 0 : e.status === "d" ? 1 : 2,
      e.chance_of_playing_next_round,
    ];
  });
  const snap = {
    gw: next.id,
    deadline: next.deadline_time,
    taken: new Date(now).toISOString(),
    players,
    fixtures: fixtures
      .filter((f) => f.event === next.id)
      .map((f) => ({ h: short[f.team_h], a: short[f.team_a], dh: f.team_h_difficulty, da: f.team_a_difficulty })),
  };
  await env.PREDICTIONS.put("pred:gw" + next.id, JSON.stringify(snap), {
    metadata: { gw: next.id, taken: snap.taken, deadline: snap.deadline },
  });
  return { stored: "pred:gw" + next.id, players: bs.elements.length, fixtures: snap.fixtures.length, taken: snap.taken };
}

// Daily price recorder. The official API only ever exposes the CURRENT net price
// change; it keeps no history. Recording one snapshot a day builds a real change log
// we own, which is the only way to answer "when did he drop?" later in the season.
// One write per day, plus a rolling log capped at 400 entries.
async function takePriceSnapshot(env) {
  const bs = await fetchJson("/bootstrap-static/");
  const today = new Date().toISOString().slice(0, 10);
  if (await env.PREDICTIONS.get("price:day:" + today)) return { skipped: "prices already stored for " + today };
  const short = {};
  bs.teams.forEach((t) => (short[t.id] = t.short_name));
  const prices = {};
  bs.elements.forEach((e) => (prices[e.id] = e.now_cost));

  const prevRaw = await env.PREDICTIONS.get("price:latest");
  const changes = [];
  if (prevRaw) {
    const prev = JSON.parse(prevRaw);
    bs.elements.forEach((e) => {
      const was = prev.prices[e.id];
      if (was != null && was !== e.now_cost) {
        changes.push({ id: e.id, n: e.web_name, t: short[e.team], from: was / 10, to: e.now_cost / 10, d: today });
      }
    });
  }
  await env.PREDICTIONS.put("price:day:" + today, JSON.stringify(prices), { expirationTtl: 60 * 60 * 24 * 120 });
  await env.PREDICTIONS.put("price:latest", JSON.stringify({ date: today, prices }));
  if (changes.length) {
    const logRaw = await env.PREDICTIONS.get("price:changes");
    const log = logRaw ? JSON.parse(logRaw) : [];
    await env.PREDICTIONS.put("price:changes", JSON.stringify(changes.concat(log).slice(0, 400)));
  }
  return { stored: today, changes: changes.length, first: !prevRaw };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;

    if (p === "/bootstrap") return proxy(UPSTREAM + "/bootstrap-static/", ctx);
    if (p === "/fixtures") {
      let t = UPSTREAM + "/fixtures/";
      const ev = url.searchParams.get("event");
      if (ev && /^\d{1,2}$/.test(ev)) t += "?event=" + ev;
      return proxy(t, ctx);
    }
    if (p === "/live") {
      const ev = url.searchParams.get("event");
      if (!ev || !/^\d{1,2}$/.test(ev)) return jsonResp({ error: "event required" }, 400);
      return proxy(UPSTREAM + "/event/" + ev + "/live/", ctx);
    }
    // My Team: public read-only endpoints only. Ids are validated as numbers so this
    // can never be pointed at an authenticated path.
    if (p === "/entry") {
      const id = url.searchParams.get("id");
      if (!id || !/^\d{1,9}$/.test(id)) return jsonResp({ error: "numeric id required" }, 400);
      return proxy(UPSTREAM + "/entry/" + id + "/", ctx, 300);
    }
    if (p === "/picks") {
      const id = url.searchParams.get("id"), gw = url.searchParams.get("gw");
      if (!id || !/^\d{1,9}$/.test(id)) return jsonResp({ error: "numeric id required" }, 400);
      if (!gw || !/^\d{1,2}$/.test(gw) || +gw < 1 || +gw > 38) return jsonResp({ error: "gw 1-38 required" }, 400);
      return proxy(UPSTREAM + "/entry/" + id + "/event/" + gw + "/picks/", ctx, 60);
    }
    if (p === "/pricechanges") {
      const v = await env.PREDICTIONS.get("price:changes");
      const latest = await env.PREDICTIONS.get("price:latest");
      return jsonResp({
        changes: v ? JSON.parse(v) : [],
        recordingSince: latest ? JSON.parse(latest).date : null,
      });
    }
    if (p === "/snapshots") {
      const list = await env.PREDICTIONS.list({ prefix: "pred:gw" });
      const snapshots = list.keys
        .map((k) => k.metadata || { gw: parseInt(k.name.replace("pred:gw", ""), 10) })
        .sort((a, b) => a.gw - b.gw);
      return jsonResp({ snapshots });
    }
    if (p === "/snapshot") {
      const gw = url.searchParams.get("gw");
      if (!gw || !/^\d{1,2}$/.test(gw)) return jsonResp({ error: "gw required" }, 400);
      const v = await env.PREDICTIONS.get("pred:gw" + gw);
      if (!v) return jsonResp({ error: "no snapshot for gw " + gw }, 404);
      return new Response(v, { headers: { "Content-Type": "application/json", ...CORS } });
    }
    if (p === "/snap") {
      // Manual trigger for testing the pipeline; same immutability guard as the cron.
      try {
        const pred = await takeSnapshot(env, url.searchParams.get("force") === "1");
        const price = await takePriceSnapshot(env);
        return jsonResp({ predictions: pred, prices: price });
      } catch (e) {
        return jsonResp({ error: String(e.message || e) }, 502);
      }
    }
    return jsonResp({ error: "not found", routes: ["/bootstrap", "/fixtures", "/live", "/entry", "/picks", "/snapshots", "/snapshot", "/pricechanges", "/snap"] }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(takeSnapshot(env, false));
    ctx.waitUntil(takePriceSnapshot(env));
  },
};
