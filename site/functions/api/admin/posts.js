import {requireAdmin} from '../../_admin.js';
import {notifyIndexNow} from '../../_indexnow.js';
import {json,readJsonLimited,safeUrl} from '../../_lib.js';
import {slugify} from '../../_site.js';

const STATUSES=new Set(['draft','published','archived']);

export async function onRequestGet({request,env}) {
  const auth=await requireAdmin(request,env);if(auth.response) return auth.response;
  try {
    const result=await env.DB.prepare(`SELECT p.id,p.slug,p.title,p.excerpt,p.body_markdown,
      p.cover_image_url,p.category,p.status,p.meta_title,p.meta_description,p.published_at,
      p.created_at,p.updated_at,GROUP_CONCAT(b.offer_id) offer_ids FROM blog_posts p
      LEFT JOIN blog_post_offers b ON b.post_id=p.id GROUP BY p.id ORDER BY p.updated_at DESC`).all();
    return json({posts:(result.results||[]).map(post=>({...post,offer_ids:post.offer_ids?post.offer_ids.split(','):[]}))});
  } catch { return json({error:'blog_not_configured'},503); }
}

export async function onRequestPost(context) {
  const {request,env}=context,auth=await requireAdmin(request,env);if(auth.response) return auth.response;
  let body;try{body=await readJsonLimited(request,100000);}catch(error){return json({error:error?.message==='too_large'?'too_large':'invalid_json'},error?.message==='too_large'?413:400);}
  const now=Math.floor(Date.now()/1000),title=String(body.title||'').trim().slice(0,180);
  const id=String(body.id||crypto.randomUUID()).slice(0,100),slug=slugify(body.slug||title);
  const excerpt=String(body.excerpt||'').trim().slice(0,320),content=String(body.body_markdown||'').trim().slice(0,50000);
  const status=STATUSES.has(body.status)?body.status:'draft';
  const category=String(body.category||'').trim().slice(0,60)||null;
  const cover=body.cover_image_url?safeUrl(body.cover_image_url):null;
  const metaTitle=String(body.meta_title||'').trim().slice(0,70)||null;
  const metaDescription=String(body.meta_description||'').trim().slice(0,170)||null;
  if(!title||!excerpt||!content||!slug||body.cover_image_url&&!cover) return json({error:'invalid_post'},400);
  const requestedOffers=[...new Set((Array.isArray(body.offer_ids)?body.offer_ids:[]).map(value=>String(value).slice(0,100)))].slice(0,8);
  try {
    let existingIds=[];
    if(requestedOffers.length){
      const found=await env.DB.prepare(`SELECT id FROM offers WHERE id IN (${requestedOffers.map(()=>'?').join(',')})`).bind(...requestedOffers).all();
      const allowed=new Set((found.results||[]).map(row=>row.id));existingIds=requestedOffers.filter(value=>allowed.has(value));
    }
    const current=await env.DB.prepare('SELECT created_at,published_at FROM blog_posts WHERE id=?').bind(id).first();
    const publishedAt=status==='published'?(Number(current?.published_at)||now):null;
    const statements=[env.DB.prepare(`INSERT INTO blog_posts(id,slug,title,excerpt,body_markdown,cover_image_url,category,status,meta_title,meta_description,published_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,title=excluded.title,excerpt=excluded.excerpt,body_markdown=excluded.body_markdown,cover_image_url=excluded.cover_image_url,category=excluded.category,status=excluded.status,meta_title=excluded.meta_title,meta_description=excluded.meta_description,published_at=excluded.published_at,updated_at=excluded.updated_at`).bind(id,slug,title,excerpt,content,cover,category,status,metaTitle,metaDescription,publishedAt,Number(current?.created_at)||now,now),env.DB.prepare('DELETE FROM blog_post_offers WHERE post_id=?').bind(id),...existingIds.map((offerId,index)=>env.DB.prepare('INSERT INTO blog_post_offers(post_id,offer_id,position) VALUES(?,?,?)').bind(id,offerId,index))];
    await env.DB.batch(statements);
    if(status==='published') context.waitUntil(notifyIndexNow([`/blog/${slug}`,'/blog']));
    return json({ok:true,id,slug,status,published_at:publishedAt,offer_ids:existingIds},current?200:201);
  } catch(error) {
    if(String(error?.message||'').toLowerCase().includes('unique')) return json({error:'slug_in_use'},409);
    return json({error:'save_failed'},500);
  }
}
