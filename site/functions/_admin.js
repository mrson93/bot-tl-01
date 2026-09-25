import {json} from './_lib.js';

function decodeBase64Url(value) {
  const normalized=String(value).replace(/-/g,'+').replace(/_/g,'/');
  const padded=normalized+'='.repeat((4-normalized.length%4)%4);
  const binary=atob(padded),bytes=new Uint8Array(binary.length);
  for(let index=0;index<binary.length;index++) bytes[index]=binary.charCodeAt(index);
  return bytes;
}

function decodeJson(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function allowedEmails(env) {
  return new Set(String(env.ADMIN_EMAILS||'').split(',')
    .map(value=>value.trim().toLowerCase()).filter(Boolean));
}

export async function adminIdentity(request,env) {
  const token=String(request.headers.get('Cf-Access-Jwt-Assertion')||'');
  const team=String(env.CF_ACCESS_TEAM_DOMAIN||'').trim().toLowerCase()
    .replace(/^https?:\/\//,'').replace(/\/$/,'');
  const expectedAudience=String(env.CF_ACCESS_AUD||'').trim();
  const allowed=allowedEmails(env);
  if(!token||!team||!expectedAudience||!allowed.size) return null;
  const parts=token.split('.');
  if(parts.length!==3) return null;
  try {
    const header=decodeJson(parts[0]),payload=decodeJson(parts[1]);
    if(header.alg!=='RS256'||!header.kid) return null;
    const certResponse=await fetch(`https://${team}/cdn-cgi/access/certs`,{
      cf:{cacheEverything:true,cacheTtl:3600},signal:AbortSignal.timeout(5000),
    });
    if(!certResponse.ok) return null;
    const certs=await certResponse.json();
    const key=(certs.keys||[]).find(candidate=>candidate.kid===header.kid);
    if(!key) return null;
    const cryptoKey=await crypto.subtle.importKey('jwk',key,{
      name:'RSASSA-PKCS1-v1_5',hash:'SHA-256',
    },false,['verify']);
    const verified=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',cryptoKey,
      decodeBase64Url(parts[2]),new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    const now=Math.floor(Date.now()/1000);
    const audiences=Array.isArray(payload.aud)?payload.aud:[payload.aud];
    const email=String(payload.email||'').trim().toLowerCase();
    if(!verified||!email||!allowed.has(email)||!audiences.includes(expectedAudience)||
       Number(payload.exp)<=now||Number(payload.nbf||0)>now+60||
       String(payload.iss||'')!==`https://${team}`) return null;
    return {email};
  } catch {
    return null;
  }
}

export async function requireAdmin(request,env) {
  const identity=await adminIdentity(request,env);
  return identity?{identity}: {response:json({error:'admin_unauthorized'},401)};
}
