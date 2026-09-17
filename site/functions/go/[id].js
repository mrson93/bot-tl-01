import {safeUrl} from '../_lib.js';
import {recordPublicMetric} from '../_abuse.js';
export async function onRequestGet(context) {
  const {params,env}=context;
  const id=String(params.id||'');
  const row=await env.DB.prepare("SELECT destination FROM offers WHERE id=? AND availability!='unavailable'").bind(id).first();
  const destination=row&&safeUrl(row.destination,env.ALLOWED_DESTINATION_HOSTS);
  if(!destination) return new Response('Oferta não encontrada',{status:404});
  context.waitUntil(recordPublicMetric(context,'offer-click',id,()=>env.DB.prepare(
    'INSERT INTO clicks(offer_id,clicked_at) VALUES(?,?)',
  ).bind(id,Math.floor(Date.now()/1000)).run()));
  return Response.redirect(destination,302);
}
