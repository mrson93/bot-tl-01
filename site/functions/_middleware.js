const OFFICIAL_HOST='canaltabarato.com.br';
const LEGACY_HOST='canaltabarato.pages.dev';

function secured(response) {
  const headers=new Headers(response.headers);
  headers.set('Strict-Transport-Security','max-age=31536000');
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('Referrer-Policy','strict-origin-when-cross-origin');
  headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

// Funções do Pages não passam pelo cache da Cloudflare: sem isto, cada visita
// (e cada robô de busca) consultava o D1 e estourava a cota diária de leituras.
const PRIVATE_PATH=/^\/(admin|api\/admin)(\/|$)/;
const TRACKING_PARAM=/^(utm_|fbclid$|gclid$|ttclid$|igshid$)/;

function cacheKey(request) {
  const url=new URL(request.url);
  for(const name of [...url.searchParams.keys()]) if(TRACKING_PARAM.test(name)) url.searchParams.delete(name);
  url.searchParams.sort();
  return new Request(url.toString(),{method:'GET'});
}

function cacheable(request,url) {
  if(request.method!=='GET'||PRIVATE_PATH.test(url.pathname)) return false;
  if(request.headers.get('Authorization')) return false;
  return !/(^|;\s*)CF_Authorization=/.test(request.headers.get('Cookie')||'');
}

async function withEdgeCache(context,url) {
  const cache=globalThis.caches?.default;
  if(!cache||!cacheable(context.request,url)) return context.next();
  const key=cacheKey(context.request);
  const hit=await cache.match(key);
  if(hit) return hit;
  const response=await context.next();
  const control=response.headers.get('Cache-Control')||'';
  if(response.status===200&&/\bpublic\b/.test(control)&&/max-age=[1-9]/.test(control)&&!response.headers.has('Set-Cookie')){
    context.waitUntil(cache.put(key,response.clone()));
  }
  return response;
}

export async function onRequest(context) {
  const url=new URL(context.request.url);
  const legacyPage=url.hostname===LEGACY_HOST&&!url.pathname.startsWith('/api/');
  const alternateHost=url.hostname===`www.${OFFICIAL_HOST}`;
  if(legacyPage||alternateHost){
    url.protocol='https:';
    url.hostname=OFFICIAL_HOST;
    url.port='';
    return secured(Response.redirect(url.toString(),301));
  }
  return secured(await withEdgeCache(context,url));
}
