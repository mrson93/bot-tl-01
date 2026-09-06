import {safeUrl} from '../_lib.js';

export async function onRequestGet(context) {
  const {params,env}=context;
  const slug=String(params.slug||'').toLowerCase().replace(/[^a-z0-9-]/g,'');
  const row=await env.DB.prepare('SELECT destination FROM store_links WHERE slug=?').bind(slug).first();
  const destination=row&&safeUrl(row.destination,env.ALLOWED_DESTINATION_HOSTS);
  if(!destination) return new Response('Loja não encontrada',{status:404});
  context.waitUntil(env.DB.prepare('INSERT INTO clicks(offer_id,clicked_at) VALUES(?,?)')
    .bind(`store:${slug}`,Math.floor(Date.now()/1000)).run());
  return new Response(null,{status:302,headers:{Location:destination,'Cache-Control':'no-store'}});
}
