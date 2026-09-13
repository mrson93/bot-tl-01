function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function authorized(request, env) {
  const token = String(env.ADMIN_TOKEN || "");
  return token.length >= 32 && request.headers.get("Authorization") === `Bearer ${token}`;
}

function allowedDestination(destination, env) {
  try {
    const url = new URL(destination);
    if (url.protocol !== "https:") return false;
    const allowed = String(env.ALLOWED_DESTINATION_HOSTS || "")
      .split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
    return allowed.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

async function createLink(request, env) {
  if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
  if (Number(request.headers.get("Content-Length") || 0) > 16_384) {
    return json({ error: "payload_too_large" }, 413);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
  if (!allowedDestination(body.destination, env)) {
    return json({ error: "destination_not_allowed" }, 400);
  }
  const offerId = String(body.offer_id || "").trim().slice(0, 160);
  const channel = String(body.channel || "").trim().slice(0, 40);
  const source = String(body.source || "").trim().slice(0, 60);
  if (!offerId || !channel || !source) return json({ error: "invalid_dimensions" }, 400);
  const slug = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    "INSERT INTO links(slug,destination,offer_id,channel,source,created_at) VALUES(?,?,?,?,?,?)",
  ).bind(slug, body.destination, offerId, channel, source, now).run();
  return json({ short_url: `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/${slug}` }, 201);
}

async function stats(request, env) {
  if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
  const url = new URL(request.url);
  const now = Math.floor(Date.now() / 1000);
  const start = Number(url.searchParams.get("start") || now - 31 * 86400);
  const end = Number(url.searchParams.get("end") || now);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) {
    return json({ error: "invalid_range" }, 400);
  }
  const rows = await env.DB.prepare(
    "SELECT l.channel,l.source,COUNT(*) AS quantity FROM clicks c " +
    "JOIN links l ON l.slug=c.slug WHERE c.clicked_at>=? AND c.clicked_at<? " +
    "GROUP BY l.channel,l.source",
  ).bind(start, end).all();
  const offerRows = await env.DB.prepare(
    "SELECT l.offer_id,COUNT(*) AS quantity FROM clicks c " +
    "JOIN links l ON l.slug=c.slug WHERE c.clicked_at>=? AND c.clicked_at<? " +
    "GROUP BY l.offer_id",
  ).bind(start, end).all();
  const byChannel = {};
  const bySource = {};
  const byOffer = {};
  let total = 0;
  for (const row of rows.results || []) {
    const quantity = Number(row.quantity || 0);
    total += quantity;
    byChannel[row.channel] = (byChannel[row.channel] || 0) + quantity;
    bySource[row.source] = (bySource[row.source] || 0) + quantity;
  }
  for (const row of offerRows.results || []) {
    byOffer[row.offer_id] = Number(row.quantity || 0);
  }
  return json({ total, by_channel: byChannel, by_source: bySource,
    by_offer: byOffer });
}

async function redirect(pathname, env) {
  const slug = pathname.slice(1);
  if (!/^[a-f0-9]{16}$/.test(slug)) return new Response("Not found", { status: 404 });
  const link = await env.DB.prepare(
    "SELECT destination FROM links WHERE slug=?",
  ).bind(slug).first();
  if (!link || !allowedDestination(link.destination, env)) {
    return new Response("Not found", { status: 404 });
  }
  await env.DB.prepare("INSERT INTO clicks(slug,clicked_at) VALUES(?,?)")
    .bind(slug, Math.floor(Date.now() / 1000)).run();
  return new Response(null,{status:302,headers:{Location:link.destination,
    'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/links") {
      return createLink(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/stats") {
      return stats(request, env);
    }
    if (request.method === "GET") return redirect(url.pathname, env);
    return new Response("Method not allowed", { status: 405 });
  },
};
