const MIN_SECRET_LENGTH=32;

function bytesToHex(bytes) {
  return Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
}

async function hmac(secret,value) {
  const encoder=new TextEncoder();
  const key=await crypto.subtle.importKey(
    'raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'],
  );
  return bytesToHex(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(value))));
}

function clientMaterial(request) {
  const ip=String(request.headers.get('CF-Connecting-IP')||'unknown').slice(0,64);
  const agent=String(request.headers.get('User-Agent')||'unknown').slice(0,180);
  return `${ip}\n${agent}`;
}

async function insertOnce(env,eventKey,expiresAt) {
  const insert=()=>env.DB.prepare(
    'INSERT OR IGNORE INTO abuse_events(event_key,expires_at) VALUES(?,?)',
  ).bind(eventKey,expiresAt).run();
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

/**
 * Reserva uma ação pública por cliente/recurso/janela sem persistir IP ou UA.
 * Se o segredo estiver ausente, falha fechado e deixa o chamador decidir se
 * responde com erro (feedback) ou apenas ignora telemetria (redirecionamentos).
 */
export async function claimPublicAction({env,request,purpose,resource,windowSeconds,limiter}) {
  const secret=String(env.ABUSE_HASH_SECRET||'');
  if(secret.length<MIN_SECRET_LENGTH) return {accepted:false,reason:'misconfigured'};

  const clientKey=await hmac(secret,clientMaterial(request));
  if(limiter?.limit){
    try{
      const result=await limiter.limit({key:`${purpose}:${clientKey}`});
      if(!result.success) return {accepted:false,reason:'rate_limited'};
    }catch{
      return {accepted:false,reason:'rate_limiter_error'};
    }
  }

  const now=Math.floor(Date.now()/1000),bucket=Math.floor(now/windowSeconds);
  const eventKey=await hmac(secret,`${purpose}\n${resource}\n${bucket}\n${clientKey}`);
  const result=await insertOnce(env,eventKey,(bucket+2)*windowSeconds);
  const accepted=Number(result?.meta?.changes||0)>0;

  // Limpeza determinística e rara: aproximadamente 1/64 dos eventos únicos.
  if(accepted&&Number.parseInt(eventKey.slice(0,2),16)%64===0){
    await env.DB.prepare('DELETE FROM abuse_events WHERE expires_at<?').bind(now).run();
  }
  return {accepted,reason:accepted?'accepted':'duplicate'};
}

export async function recordPublicMetric(context,purpose,resource,write) {
  const result=await claimPublicAction({
    env:context.env,request:context.request,purpose,resource,windowSeconds:300,
    limiter:context.env.METRICS_RATE_LIMITER,
  });
  if(!result.accepted) return result;
  await write();
  return result;
}
