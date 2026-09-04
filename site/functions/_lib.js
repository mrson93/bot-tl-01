export function json(data, status=200, cache='no-store') { return Response.json(data,{status,headers:{'Cache-Control':cache}}); }
export async function authorized(request, secret) {
  const supplied=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
  if (!supplied || !secret) return false;
  const enc=new TextEncoder();
  const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',enc.encode(supplied)),crypto.subtle.digest('SHA-256',enc.encode(secret))]);
  const x=new Uint8Array(a), y=new Uint8Array(b); let diff=x.length^y.length;
  for(let i=0;i<Math.max(x.length,y.length);i++) diff|=(x[i%x.length]^y[i%y.length]);
  return diff===0;
}
export function safeUrl(value, allowedHosts='') {
  try { const url=new URL(value); if(url.protocol!=='https:') return null;
    const allowed=String(allowedHosts).split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
    if(allowed.length&&!allowed.some(h=>url.hostname===h||url.hostname.endsWith(`.${h}`))) return null;
    return url.href;
  } catch { return null; }
}
export function unixRange(request) {
  const url=new URL(request.url), now=Math.floor(Date.now()/1000);
  const start=Math.max(0,Number(url.searchParams.get('start'))||0);
  const end=Math.min(now+86400,Number(url.searchParams.get('end'))||now);
  return [Math.floor(start),Math.floor(Math.max(start,end))];
}
