const MIN_SECRET_LENGTH=32;
// Redes buscam o link para montar a prévia logo após o post; isso não é clique.
const AUTOMATED_AGENT=/bot(?:[\/\s;),\d.]|$)|crawler|spider|facebookexternalhit|facebookcatalog|meta-externalagent|cardyb|whatsapp|embedly|skypeuripreview|preview|headless|lighthouse|lightpanda|skywatch|piiksi|\+https?:\/\/|curl\/|wget\/|python-|go-http-client|axios\/|node-fetch|okhttp/i;

export function isAutomatedAgent(agent) {
  const value=String(agent||'').trim();
  return !value||(AUTOMATED_AGENT.test(value)&&!/cubot/i.test(value));
}

// Os links são de lojas brasileiras e o canal é em português. Fora do Brasil,
// quase tudo que abre um link é robô de datacenter se passando por navegador
// (medido em 13/11/2026: 21 acessos em 9 minutos, nenhum do Brasil).
export function isLikelyPerson(request,env={}) {
  if(request.method&&request.method!=='GET') return false;
  if(isAutomatedAgent(request.headers.get('User-Agent'))) return false;
  const country=String(request.cf?.country||request.headers.get('CF-IPCountry')||'').toUpperCase();
  const allowed=String(env.CLICK_COUNTRIES||'BR').toUpperCase().split(',').map(c=>c.trim()).filter(Boolean);
  // País desconhecido (testes, desenvolvimento local) não bloqueia.
  return !country||country==='XX'||allowed.includes(country);
}

function hex(bytes) {
  return Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
}

async function hmac(secret,value) {
  const encoder=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(value))));
}

async function insertOnce(env,key,expiresAt) {
  const insert=()=>env.DB.prepare(
    'INSERT OR IGNORE INTO abuse_events(event_key,expires_at) VALUES(?,?)',
  ).bind(key,expiresAt).run();
  try{return await insert();}catch(error){
    if(!String(error?.message||error).toLowerCase().includes('no such table')) throw error;
    await env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS abuse_events(event_key TEXT PRIMARY KEY,expires_at INTEGER NOT NULL)',
    ).run();
    await env.DB.prepare(
      'CREATE INDEX IF NOT EXISTS idx_abuse_events_expires ON abuse_events(expires_at)',
    ).run();
    return insert();
  }
}

export async function shouldRecordClick(request,env,slug) {
  const secret=String(env.ABUSE_HASH_SECRET||'');
  if(secret.length<MIN_SECRET_LENGTH) return false;
  const ip=String(request.headers.get('CF-Connecting-IP')||'unknown').slice(0,64);
  const agent=String(request.headers.get('User-Agent')||'unknown').slice(0,180);
  if(!isLikelyPerson(request,env)) return false;
  const client=await hmac(secret,`${ip}\n${agent}`);
  if(env.CLICK_RATE_LIMITER?.limit){
    try{
      if(!(await env.CLICK_RATE_LIMITER.limit({key:client})).success) return false;
    }catch{return false;}
  }
  const now=Math.floor(Date.now()/1000),windowSeconds=300,bucket=Math.floor(now/windowSeconds);
  const eventKey=await hmac(secret,`redirect-click\n${slug}\n${bucket}\n${client}`);
  const result=await insertOnce(env,eventKey,(bucket+2)*windowSeconds);
  if(Number(result?.meta?.changes||0)<=0) return false;
  if(Number.parseInt(eventKey.slice(0,2),16)%64===0){
    await env.DB.prepare('DELETE FROM abuse_events WHERE expires_at<?').bind(now).run();
  }
  return true;
}
