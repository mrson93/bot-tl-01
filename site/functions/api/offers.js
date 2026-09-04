import {json} from '../_lib.js';
export async function onRequestGet({env}) {
  const since=Math.floor(Date.now()/1000)-7*86400;
  const result=await env.DB.prepare('SELECT id,title,price,original_price,discount,rating,sales,shop,image_url,source,category,published_at FROM offers WHERE published_at>=? ORDER BY published_at DESC LIMIT 100').bind(since).all();
  return json({offers:result.results||[]},200,'public, max-age=60, stale-while-revalidate=300');
}
