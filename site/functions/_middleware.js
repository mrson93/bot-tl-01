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
  return secured(await context.next());
}
