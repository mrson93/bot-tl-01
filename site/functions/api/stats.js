import {authorized,json,unixRange} from '../_lib.js';
export async function onRequestGet({request,env}) {
  if(!await authorized(request,env.PUBLISH_TOKEN)) return json({error:'unauthorized'},401);
  const [start,end]=unixRange(request);
  const grouped=await env.DB.prepare(`SELECT o.source,c.offer_id,COUNT(*) quantity FROM clicks c JOIN offers o ON o.id=c.offer_id WHERE c.clicked_at>=? AND c.clicked_at<? GROUP BY o.source,c.offer_id`).bind(start,end).all();
  const bySource={},byOffer={}; let total=0;
  for(const row of grouped.results||[]){const quantity=Number(row.quantity||0);total+=quantity;bySource[row.source]=(bySource[row.source]||0)+quantity;byOffer[row.offer_id]=quantity;}
  return json({total,by_channel:{site:total},by_source:bySource,by_offer:byOffer});
}
