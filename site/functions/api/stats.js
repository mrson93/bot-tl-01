import {authorized,json,unixRange} from '../_lib.js';
export async function onRequestGet({request,env}) {
  if(!await authorized(request,env.PUBLISH_TOKEN)) return json({error:'unauthorized'},401);
  const [start,end]=unixRange(request);
  const [grouped,couponGrouped,storeGrouped,viewResult]=await env.DB.batch([
    env.DB.prepare(`SELECT o.source,c.offer_id,COUNT(*) quantity FROM clicks c JOIN offers o ON o.id=c.offer_id WHERE c.clicked_at>=? AND c.clicked_at<? GROUP BY o.source,c.offer_id`).bind(start,end),
    env.DB.prepare(`SELECT p.source,c.offer_id,COUNT(*) quantity FROM clicks c JOIN coupons p ON c.offer_id='coupon:'||p.id WHERE c.clicked_at>=? AND c.clicked_at<? GROUP BY p.source,c.offer_id`).bind(start,end),
    env.DB.prepare(`SELECT s.name source,c.offer_id,COUNT(*) quantity FROM clicks c JOIN store_links s ON c.offer_id='store:'||s.slug WHERE c.clicked_at>=? AND c.clicked_at<? GROUP BY s.name,c.offer_id`).bind(start,end),
    env.DB.prepare(`SELECT COALESCE(SUM(quantity),0) quantity FROM page_views_daily WHERE observed_on>=date(?,'unixepoch','-3 hours') AND observed_on<date(?,'unixepoch','-3 hours')`).bind(start,end),
  ]);
  const bySource={},byOffer={}; let total=0;
  for(const row of [...(grouped.results||[]),...(couponGrouped.results||[]),...(storeGrouped.results||[])]){const quantity=Number(row.quantity||0);total+=quantity;bySource[row.source]=(bySource[row.source]||0)+quantity;byOffer[row.offer_id]=quantity;}
  const views=Number((viewResult.results||[])[0]?.quantity)||0;
  return json({total,views,outbound_clicks:total,ctr:views?Number((100*total/views).toFixed(2)):0,by_channel:{site:total},by_source:bySource,by_offer:byOffer});
}
