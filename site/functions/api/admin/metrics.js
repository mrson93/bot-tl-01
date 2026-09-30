import {requireAdmin} from '../../_admin.js';
import {json} from '../../_lib.js';

async function rowsOrEmpty(statement){
  try{return (await statement.all()).results||[];}
  catch(error){if(String(error?.message||error).toLowerCase().includes('no such table'))return [];throw error;}
}

export async function onRequestGet({request,env}){
  const auth=await requireAdmin(request,env);if(auth.response)return auth.response;
  const since="date('now','-3 hours','-29 days')";
  const [visits,events,searches,inventory]=await Promise.all([
    rowsOrEmpty(env.DB.prepare(`SELECT substr(path,7) slug,SUM(quantity) quantity FROM page_views_daily
      WHERE observed_on>=${since} AND path LIKE '/blog/%' GROUP BY path`)),
    rowsOrEmpty(env.DB.prepare(`SELECT post_slug slug,event_type,SUM(quantity) quantity FROM editorial_metrics_daily
      WHERE observed_on>=${since} GROUP BY post_slug,event_type`)),
    rowsOrEmpty(env.DB.prepare(`SELECT source,device,outcome,SUM(quantity) quantity FROM catalog_search_daily
      WHERE observed_on>=${since} GROUP BY source,device,outcome`)),
    rowsOrEmpty(env.DB.prepare(`SELECT p.id,p.slug,p.title,COUNT(m.id) model_count,
      SUM(CASE WHEN m.id IS NOT NULL AND COALESCE(m.affiliate_url,'')='' AND NOT EXISTS(
        SELECT 1 FROM blog_product_links l WHERE l.post_id=p.id AND l.product_id=m.id
      ) THEN 1 ELSE 0 END) missing_links
      FROM blog_posts p LEFT JOIN blog_post_products m ON m.post_id=p.id
      WHERE p.status='published' AND p.published_at<=strftime('%s','now')
      GROUP BY p.id`)),
  ]);
  const byPost={};
  for(const row of visits){if(!/^[a-z0-9-]{1,100}$/.test(row.slug))continue;(byPost[row.slug]??={visits:0,card_views:0,clicks:0}).visits=Number(row.quantity)||0;}
  for(const row of events){if(!/^[a-z0-9-]{1,100}$/.test(row.slug))continue;const item=byPost[row.slug]??={visits:0,card_views:0,clicks:0};item[row.event_type==='click'?'clicks':'card_views']+=Number(row.quantity)||0;}
  for(const row of inventory){if(!/^[a-z0-9-]{1,100}$/.test(row.slug))continue;const item=byPost[row.slug]??={visits:0,card_views:0,clicks:0};item.id=row.id;item.title=row.title;item.model_count=Number(row.model_count)||0;item.missing_links=Number(row.missing_links)||0;}
  const catalogSearch={results:0,empty:0,by_source:{},by_device:{}};
  for(const row of searches){const quantity=Number(row.quantity)||0;if(!['results','empty'].includes(row.outcome))continue;catalogSearch[row.outcome]+=quantity;const source=catalogSearch.by_source[row.source]??={results:0,empty:0},device=catalogSearch.by_device[row.device]??={results:0,empty:0};source[row.outcome]+=quantity;device[row.outcome]+=quantity;}
  return json({period_days:30,by_post:byPost,catalog_search:catalogSearch});
}
