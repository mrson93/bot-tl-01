const OFFICIAL_HOST='canaltabarato.com.br';
const LEGACY_HOST='canaltabarato.pages.dev';

export async function onRequest(context) {
  const url=new URL(context.request.url);
  const legacyPage=url.hostname===LEGACY_HOST&&!url.pathname.startsWith('/api/');
  const alternateHost=url.hostname===`www.${OFFICIAL_HOST}`;
  if(legacyPage||alternateHost){
    url.protocol='https:';
    url.hostname=OFFICIAL_HOST;
    url.port='';
    return Response.redirect(url.toString(),301);
  }
  return context.next();
}
