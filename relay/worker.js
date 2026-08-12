// FPL data relay — the official FPL API sends no CORS headers, so browsers cannot
// call it directly. This worker proxies two read-only endpoints, adds CORS, and
// caches at the edge for 15 minutes so we never hammer the upstream.
const UPSTREAM = "https://fantasy.premierleague.com/api";
const ROUTES = {
  "/bootstrap": "/bootstrap-static/",
  "/fixtures": "/fixtures/",
};
const CACHE_SECS = 900;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const route = ROUTES[url.pathname];
    if (!route) {
      return new Response(JSON.stringify({ error: "not found", routes: Object.keys(ROUTES) }), {
        status: 404,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
    let target = UPSTREAM + route;
    // /fixtures?event=N passthrough (numeric only — this is not an open proxy)
    const ev = url.searchParams.get("event");
    if (url.pathname === "/fixtures" && ev && /^\d{1,2}$/.test(ev)) target += "?event=" + ev;

    const cache = caches.default;
    const cacheKey = new Request(target);
    let resp = await cache.match(cacheKey);
    if (!resp) {
      const upstream = await fetch(target, {
        headers: { "User-Agent": "fpl-season-hq-relay/1.0" },
      });
      if (!upstream.ok) {
        return new Response(JSON.stringify({ error: "upstream " + upstream.status }), {
          status: 502,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
      resp = new Response(upstream.body, upstream);
      resp.headers.set("Cache-Control", "public, max-age=" + CACHE_SECS);
      resp.headers.set("Access-Control-Allow-Origin", "*");
      resp.headers.delete("Set-Cookie");
      ctx.waitUntil(cache.put(cacheKey, resp.clone()));
    } else {
      resp = new Response(resp.body, resp);
      resp.headers.set("Access-Control-Allow-Origin", "*");
    }
    return resp;
  },
};
