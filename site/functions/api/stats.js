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
  let editorial=[];
  try{const result=await env.DB.prepare(`SELECT m.post_slug,m.product_id,p.name product_name,m.store,m.placement,m.source,m.event_type,SUM(m.quantity) quantity
    FROM editorial_metrics_daily m LEFT JOIN blog_posts b ON b.slug=m.post_slug
    LEFT JOIN blog_post_products p ON p.post_id=b.id AND p.id=m.product_id
    WHERE m.observed_on>=date(?,'unixepoch','-3 hours') AND m.observed_on<date(?,'unixepoch','-3 hours')
    GROUP BY m.post_slug,m.product_id,p.name,m.store,m.placement,m.source,m.event_type`).bind(start,end).all();editorial=result.results||[];
  }catch(error){if(!String(error?.message||error).toLowerCase().includes('no such table'))throw error;}
  const editorialByPost={},editorialByProduct={},editorialByStore={},editorialByPlacement={},editorialBySource={};let editorialViews=0,editorialClicks=0;
  for(const row of editorial){
    const quantity=Number(row.quantity)||0,isClick=row.event_type==='click',counter=isClick?'clicks':'views';
    if(isClick)editorialClicks+=quantity;else editorialViews+=quantity;
    for(const [group,key] of [[editorialByPost,row.post_slug],[editorialByProduct,`${row.post_slug}/${row.product_id}`],[editorialByStore,row.store||'view'],[editorialByPlacement,row.placement],[editorialBySource,row.source]]){
      const item=group[key]||(group[key]={views:0,clicks:0});item[counter]+=quantity;if(group===editorialByProduct)item.product_name=row.product_name||row.product_id;
    }
  }
  const editorialRate=editorialViews?Number((100*editorialClicks/editorialViews).toFixed(2)):0;
  const clickPerView=views?Number((100*total/views).toFixed(2)):0;
  return json({total,views,outbound_clicks:total,ctr:clickPerView,clicks_per_view_percent:clickPerView,
    by_channel:{site:total},by_source:bySource,by_channel_source:byChannelSource,by_offer:byOffer,by_traffic_source:byTrafficSource,
    editorial:{views:editorialViews,clicks:editorialClicks,clicks_per_view_percent:editorialRate,
      by_post:editorialByPost,by_product:editorialByProduct,by_store:editorialByStore,by_placement:editorialByPlacement,by_source:editorialBySource}});
}
