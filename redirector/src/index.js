import {shouldRecordClick} from './abuse.js';

function json(data, status = 200) {
  return Response.json(data, { status, headers: {"Cache-Control":"no-store",
    "Strict-Transport-Security":"max-age=31536000","X-Content-Type-Options":"nosniff"} });
}

async function constantTimeEqual(left,right) {
  const encoder=new TextEncoder();
  const [a,b]=await Promise.all([
    crypto.subtle.digest('SHA-256',encoder.encode(String(left||''))),
    crypto.subtle.digest('SHA-256',encoder.encode(String(right||''))),
  ]);
  const x=new Uint8Array(a),y=new Uint8Array(b);let difference=0;
  for(let index=0;index<x.length;index+=1) difference|=x[index]^y[index];
  return difference===0;
}

async function authorized(request, env) {
  const token = String(env.ADMIN_TOKEN || "");
  const supplied=String(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
  return token.length>=32&&supplied.length>=32&&constantTimeEqual(supplied,token);
}

async function readJsonLimited(request,maxBytes) {
  if(!request.body) throw new Error('invalid_json');
  const reader=request.body.getReader(),chunks=[];let total=0;
  while(true){
    const {done,value}=await reader.read();
    if(done) break;
    total+=value.byteLength;
    if(total>maxBytes){await reader.cancel();throw new Error('payload_too_large');}
    chunks.push(value);
  }
  const bytes=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder().decode(bytes));
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
  if (!await authorized(request, env)) return json({ error: "unauthorized" }, 401);
  if (Number(request.headers.get("Content-Length") || 0) > 16_384) {
    return json({ error: "payload_too_large" }, 413);
  }
  let body;
  try { body = await readJsonLimited(request,16_384); } catch(error) {
    return json({error:error?.message==='payload_too_large'?'payload_too_large':'invalid_json'},
      error?.message==='payload_too_large'?413:400);
  }
  if (!allowedDestination(body.destination, env)) {
    return json({ error: "destination_not_allowed" }, 400);
  }
  const offerId = String(body.offer_id || "").trim().slice(0, 160);
  const channel = String(body.channel || "").trim().slice(0, 40);
  const source = String(body.source || "").trim().slice(0, 60);
  if (!offerId || !channel || !source) return json({ error: "invalid_dimensions" }, 400);
  const now = Math.floor(Date.now() / 1000);
  // Minúsculas e sem 0/1/l/o: fica muito mais fácil copiar da imagem à mão.
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const slug = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
    try {
      await env.DB.prepare(
        "INSERT INTO links(slug,destination,offer_id,channel,source,created_at) VALUES(?,?,?,?,?,?)",
      ).bind(slug, body.destination, offerId, channel, source, now).run();
      return json({ short_url: `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/${slug}` }, 201);
    } catch (error) {
      if (!String(error?.message || error).includes("UNIQUE constraint failed")) throw error;
    }
  }
  return json({ error: "slug_unavailable" }, 503);
}

async function stats(request, env) {
  if (!await authorized(request, env)) return json({ error: "unauthorized" }, 401);
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
  const byChannelSource = {};
  const byOffer = {};
  let total = 0;
  for (const row of rows.results || []) {
    const quantity = Number(row.quantity || 0);
    total += quantity;
    byChannel[row.channel] = (byChannel[row.channel] || 0) + quantity;
    bySource[row.source] = (bySource[row.source] || 0) + quantity;
    byChannelSource[row.source] ||= {};
    byChannelSource[row.source][row.channel] =
      (byChannelSource[row.source][row.channel] || 0) + quantity;
  }
  for (const row of offerRows.results || []) {
    byOffer[row.offer_id] = Number(row.quantity || 0);
  }
  return json({ total, by_channel: byChannel, by_source: bySource,
    by_channel_source: byChannelSource,
    by_offer: byOffer });
}

async function redirect(request, pathname, env) {
  const slug = pathname.slice(1);
  // Mantém funcionando tudo o que já foi publicado com o formato antigo.
  if (!/^(?:[A-Za-z0-9]{8}|[a-f0-9]{16})$/.test(slug)) {
    return new Response("Not found", { status: 404 });
  }
  const link = await env.DB.prepare(
    "SELECT destination FROM links WHERE slug=?",
  ).bind(slug).first();
  if (!link || !allowedDestination(link.destination, env)) {
    return new Response("Not found", { status: 404 });
  }
  if(await shouldRecordClick(request,env,slug)){
    await env.DB.prepare("INSERT INTO clicks(slug,clicked_at) VALUES(?,?)")
      .bind(slug, Math.floor(Date.now() / 1000)).run();
  }
  return new Response(null,{status:302,headers:{Location:link.destination,
    'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
    'Strict-Transport-Security':'max-age=31536000','X-Content-Type-Options':'nosniff'}});
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
    if (request.method === "GET") return redirect(request, url.pathname, env);
    return new Response("Method not allowed", { status: 405 });
  },
};
