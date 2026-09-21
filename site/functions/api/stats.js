import {authorized,json,unixRange} from '../_lib.js';
export async function onRequestGet({request,env}) {
  if(!await authorized(request,env.PUBLISH_TOKEN)) return json({error:'unauthorized'},401);
  const [start,end]=unixRange(request);
  const [grouped,couponGrouped,storeGrouped]=await env.DB.batch([
    env.DB.prepare(`SELECT o.source,c.offer_id,COUNT(*) quantity FROM clicks c JOIN offers o ON o.id=c.offer_id WHERE c.clicked_at>=? AND c.clicked_at<? GROUP BY o.source,c.offer_id`).bind(start,end),
    env.DB.prepare(`SELECT p.source,c.offer_id,COUNT(*) quantity FROM clicks c JOIN coupons p ON c.offer_id='coupon:'||p.id WHERE c.clicked_at>=? AND c.clicked_at<? GROUP BY p.source,c.offer_id`).bind(start,end),
    env.DB.prepare(`SELECT s.name source,c.offer_id,COUNT(*) quantity FROM clicks c JOIN store_links s ON c.offer_id='store:'||s.slug WHERE c.clicked_at>=? AND c.clicked_at<? GROUP BY s.name,c.offer_id`).bind(start,end),
  ]);
  const bySource={},byOffer={}; let total=0;
  for(const row of [...(grouped.results||[]),...(couponGrouped.results||[]),...(storeGrouped.results||[])]){const quantity=Number(row.quantity||0);total+=quantity;bySource[row.source]=(bySource[row.source]||0)+quantity;byOffer[row.offer_id]=quantity;}
  let views=0,byTrafficSource={};
  try{const [viewResult,trafficResult]=await env.DB.batch([
    env.DB.prepare(`SELECT COALESCE(SUM(quantity),0) quantity FROM page_views_daily WHERE observed_on>=date(?,'unixepoch','-3 hours') AND observed_on<date(?,'unixepoch','-3 hours')`).bind(start,end),
    env.DB.prepare(`SELECT source,COALESCE(SUM(quantity),0) quantity FROM traffic_sources_daily WHERE observed_on>=date(?,'unixepoch','-3 hours') AND observed_on<date(?,'unixepoch','-3 hours') GROUP BY source`).bind(start,end)
  ]);views=Number((viewResult.results||[])[0]?.quantity)||0;for(const row of trafficResult.results||[])byTrafficSource[row.source]=Number(row.quantity)||0;}catch(error){if(!String(error?.message||error).toLowerCase().includes('no such table'))throw error;}
  const byChannelSource={};
  for(const [source,quantity] of Object.entries(bySource)) byChannelSource[source]={site:quantity};
  return json({total,views,outbound_clicks:total,ctr:views?Number((100*total/views).toFixed(2)):0,by_channel:{site:total},by_source:bySource,by_channel_source:byChannelSource,by_offer:byOffer,by_traffic_source:byTrafficSource});
}
