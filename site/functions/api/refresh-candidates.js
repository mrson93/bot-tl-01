import {authorized,json} from '../_lib.js';

export async function onRequestGet({request,env}) {
  if(!await authorized(request,env.PUBLISH_TOKEN)) return json({error:'unauthorized'},401);
  const requested=Number(new URL(request.url).searchParams.get('limit'))||6;
  const limit=Math.max(1,Math.min(20,Math.floor(requested)));
  const now=Math.floor(Date.now()/1000),day=86400;
  const rows=await env.DB.prepare(`SELECT o.id,o.source,o.last_checked_at,
    COALESCE(c.quantity,0) clicks_7d FROM offers o
    LEFT JOIN (SELECT offer_id,COUNT(*) quantity FROM clicks
      WHERE clicked_at>=? GROUP BY offer_id)c ON c.offer_id=o.id
    WHERE o.source IN ('Shopee','AliExpress')
      AND o.availability!='unavailable'
      AND COALESCE(o.last_checked_at,0)<=?-CASE
        WHEN o.published_at>=?-? THEN 3600
        WHEN COALESCE(c.quantity,0)>0 THEN 7200
        WHEN o.published_at>=?-7*? THEN 21600
        ELSE 86400 END
    ORDER BY COALESCE(o.last_checked_at,0) ASC,COALESCE(c.quantity,0) DESC
    LIMIT ?`).bind(now-7*day,now,now,day,now,day,limit).all();
  return json({candidates:rows.results||[]});
}
