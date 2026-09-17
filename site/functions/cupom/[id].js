import {safeUrl} from '../_lib.js';
import {recordPublicMetric} from '../_abuse.js';

export async function onRequestGet(context) {
  const {params,env}=context;
  const id=String(params.id||'');
  const now=Math.floor(Date.now()/1000);
  const row=await env.DB.prepare(`SELECT destination FROM coupons WHERE id=?
    AND (expires_at IS NULL OR expires_at>?)`).bind(id,now).first();
  const destination=row&&safeUrl(row.destination,env.ALLOWED_DESTINATION_HOSTS);
  if(!destination) return new Response('Cupom não encontrado ou expirado',{status:404});
  context.waitUntil(recordPublicMetric(context,'coupon-click',id,()=>env.DB.prepare(
    'INSERT INTO clicks(offer_id,clicked_at) VALUES(?,?)',
  ).bind(`coupon:${id}`,now).run()));
  return Response.redirect(destination,302);
}
