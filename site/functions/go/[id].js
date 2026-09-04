import {safeUrl} from '../../_lib.js';
export async function onRequestGet({params,env,waitUntil}) {
  const id=String(params.id||'');
  const row=await env.DB.prepare('SELECT destination FROM offers WHERE id=?').bind(id).first();
  const destination=row&&safeUrl(row.destination,env.ALLOWED_DESTINATION_HOSTS);
  if(!destination) return new Response('Oferta não encontrada',{status:404});
  waitUntil(env.DB.prepare('INSERT INTO clicks(offer_id,clicked_at) VALUES(?,?)').bind(id,Math.floor(Date.now()/1000)).run());
  return Response.redirect(destination,302);
}
