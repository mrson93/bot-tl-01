import {json} from '../_lib.js';
const SORTS={recent:'o.published_at DESC',discount:'o.discount DESC,COALESCE(o.last_checked_at,o.published_at) DESC','price-asc':'o.price ASC,COALESCE(o.last_checked_at,o.published_at) DESC','price-desc':'o.price DESC,COALESCE(o.last_checked_at,o.published_at) DESC',rating:'o.rating DESC,COALESCE(o.last_checked_at,o.published_at) DESC',sales:'o.sales DESC,COALESCE(o.last_checked_at,o.published_at) DESC',trending:'(COALESCE(c.quantity,0)*20+o.discount*.7+COALESCE(o.rating,0)*5+MIN(COALESCE(o.sales,0),100000)/5000.0) DESC,COALESCE(o.last_checked_at,o.published_at) DESC'};
export async function onRequestGet({request,env}) {
  const p=new URL(request.url).searchParams,limit=Math.max(1,Math.min(48,Number(p.get('limit'))||24)),offset=Math.max(0,Math.min(5000,Number(p.get('offset'))||0));
  const requestedHours=Math.max(0,Math.min(720,Number(p.get('hours'))||0));
  const conditions=["o.availability!='unavailable'"],values=[];
  if(requestedHours){conditions.push('COALESCE(o.cataloged_at,o.published_at)>=?');values.push(Math.floor(Date.now()/1000)-requestedHours*3600);}
  const add=(sql,value)=>{if(value!==null&&value!==''){conditions.push(sql);values.push(value);}};
  const q=String(p.get('q')||'').trim().slice(0,80);add("o.title LIKE ? ESCAPE '\\' COLLATE NOCASE",q?`%${q.replace(/[\\%_]/g,'\\$&')}%`:null);
  add('o.source=?',String(p.get('source')||'').slice(0,30));add('o.category=?',String(p.get('category')||'').slice(0,40));add('o.shop=?',String(p.get('shop')||'').slice(0,100));
  add('o.price>=?',p.has('min_price')&&Number.isFinite(Number(p.get('min_price')))?Math.max(0,Number(p.get('min_price'))):null);add('o.price<=?',p.has('max_price')&&Number.isFinite(Number(p.get('max_price')))?Math.max(0,Number(p.get('max_price'))):null);add('o.rating>=?',p.has('min_rating')&&Number.isFinite(Number(p.get('min_rating')))?Math.max(0,Number(p.get('min_rating'))):null);
  if(p.get('coupon')==='1')conditions.push("o.coupon_code IS NOT NULL AND TRIM(o.coupon_code)!='' AND (o.coupon_expires_at IS NULL OR o.coupon_expires_at>strftime('%s','now'))");
  const where=conditions.join(' AND '),clickSince=Math.floor(Date.now()/1000)-86400,join=` FROM offers o LEFT JOIN (SELECT offer_id,COUNT(*) quantity FROM clicks WHERE clicked_at>=? GROUP BY offer_id)c ON c.offer_id=o.id `,sort=SORTS[p.get('sort')]||SORTS.trending;
  const [rows,count,facets,shops]=await env.DB.batch([
    env.DB.prepare(`SELECT o.id,o.title,o.price,o.original_price,o.discount,o.rating,o.sales,o.shop,o.image_url,o.source,o.category,o.published_at,o.cataloged_at,o.last_checked_at,o.availability,o.price_changed_at,o.coupon_code,o.coupon_condition,o.coupon_expires_at,o.payment_label,COALESCE(c.quantity,0)clicks_24h${join}WHERE ${where} ORDER BY ${sort} LIMIT ? OFFSET ?`).bind(clickSince,...values,limit,offset),
    env.DB.prepare(`SELECT COUNT(*)total,MAX(COALESCE(last_checked_at,published_at))latest,MAX(discount)best_discount FROM offers o WHERE ${where}`).bind(...values),
    env.DB.prepare(`SELECT group_concat(DISTINCT source)sources,group_concat(DISTINCT category)categories FROM offers WHERE availability!='unavailable'`),
    env.DB.prepare(`SELECT shop FROM offers WHERE availability!='unavailable' AND shop IS NOT NULL AND TRIM(shop)!='' GROUP BY shop ORDER BY shop LIMIT 300`)]);
  const meta=(count.results||[])[0]||{},facet=(facets.results||[])[0]||{};
  return json({offers:rows.results||[],total:Number(meta.total)||0,best_discount:Number(meta.best_discount)||0,latest_checked_at:Number(meta.latest)||null,facets:{sources:String(facet.sources||'').split(',').filter(Boolean),categories:String(facet.categories||'').split(',').filter(Boolean),shops:(shops.results||[]).map(x=>x.shop)},limit,offset,has_more:offset+(rows.results||[]).length<(Number(meta.total)||0)},200,'public, max-age=60, stale-while-revalidate=300');
}
