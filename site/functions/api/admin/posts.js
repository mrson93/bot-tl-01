import {requireAdmin} from '../../_admin.js';
import {ensureBlogProducts,productSpecs} from '../../_blog_products.js';
import {notifyIndexNow} from '../../_indexnow.js';
import {json,readJsonLimited,safeUrl} from '../../_lib.js';
import {slugify} from '../../_site.js';

const STATUSES=new Set(['draft','published','archived']);

function priceCheckedAt(value,fallback=null) {
  if(typeof value==='number'&&Number.isFinite(value)&&value>0)return Math.floor(value);
  const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!match)return fallback;
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  const date=new Date(Date.UTC(year,month-1,day,15));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return fallback;
  return Math.floor(date.getTime()/1000);
}

export async function onRequestGet({request,env}) {
  const auth=await requireAdmin(request,env);if(auth.response) return auth.response;
  try {
    await ensureBlogProducts(env);
    const result=await env.DB.prepare(`SELECT p.id,p.slug,p.title,p.excerpt,p.body_markdown,
      p.cover_image_url,p.category,p.status,p.meta_title,p.meta_description,p.published_at,
      p.created_at,p.updated_at,GROUP_CONCAT(b.offer_id) offer_ids FROM blog_posts p
      LEFT JOIN blog_post_offers b ON b.post_id=p.id GROUP BY p.id ORDER BY p.updated_at DESC`).all();
    const productResult=await env.DB.prepare('SELECT post_id,id,name,brand,summary,image_url,affiliate_url,price_label,price_checked_at,specs_json,position FROM blog_post_products ORDER BY post_id,position').all();
    const linkResult=await env.DB.prepare('SELECT post_id,product_id,id,store,label,affiliate_url,position FROM blog_product_links ORDER BY post_id,product_id,position').all();
    const linksByProduct=new Map();for(const link of linkResult.results||[]){const key=`${link.post_id}\0${link.product_id}`,list=linksByProduct.get(key)||[];list.push(link);linksByProduct.set(key,list);}
    const productsByPost=new Map();for(const product of productResult.results||[]){const list=productsByPost.get(product.post_id)||[],links=linksByProduct.get(`${product.post_id}\0${product.id}`)||[];list.push({...product,specs:productSpecs(product.specs_json),links:links.length?links:(product.affiliate_url?[{id:'legacy',store:'outro',label:'Ver produto',affiliate_url:product.affiliate_url,position:0}]:[])});productsByPost.set(product.post_id,list);}
    return json({posts:(result.results||[]).map(post=>({...post,offer_ids:post.offer_ids?post.offer_ids.split(','):[],products:productsByPost.get(post.id)||[]}))});
  } catch { return json({error:'blog_not_configured'},503); }
}

export async function onRequestPost(context) {
  const {request,env}=context,auth=await requireAdmin(request,env);if(auth.response) return auth.response;
  let body;try{body=await readJsonLimited(request,200000);}catch(error){return json({error:error?.message==='too_large'?'too_large':'invalid_json'},error?.message==='too_large'?413:400);}
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
  const requestedProducts=[];
  for(const [index,item] of (Array.isArray(body.products)?body.products:[]).slice(0,12).entries()){
    const name=String(item?.name||'').trim().slice(0,180),imageUrl=item?.image_url?safeUrl(item.image_url):null;
    if(!name||item?.image_url&&!imageUrl)return json({error:'invalid_product'},400);
    let rawLinks=Array.isArray(item.links)?item.links:[];
    if(!rawLinks.length&&item.affiliate_url)rawLinks=[{store:'outro',label:'Ver produto',affiliate_url:item.affiliate_url}];
    const links=[];
    for(const [linkIndex,link] of rawLinks.slice(0,5).entries()){
      const affiliateUrl=safeUrl(link?.affiliate_url);if(!affiliateUrl)return json({error:'invalid_product_link'},400);
      const store=['amazon','mercado-livre','outro'].includes(link?.store)?link.store:'outro';
      const defaultLabel=store==='amazon'?'Amazon':store==='mercado-livre'?'Mercado Livre':'Ver produto';
      links.push({id:String(link.id||crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80)||crypto.randomUUID(),store,label:String(link.label||defaultLabel).trim().slice(0,50)||defaultLabel,affiliate_url:affiliateUrl,position:linkIndex});
    }
    const priceLabel=String(item.price_label||'').trim().slice(0,60)||null;
    requestedProducts.push({id:String(item.id||crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80)||crypto.randomUUID(),name,brand:String(item.brand||'').trim().slice(0,80)||null,summary:String(item.summary||'').trim().slice(0,500)||null,image_url:imageUrl,affiliate_url:links[0]?.affiliate_url||'',price_label:priceLabel,price_checked_at:priceLabel?priceCheckedAt(item.price_checked_at,now):null,specs:productSpecs(item.specs),position:index,links});
  }
  try {
    await ensureBlogProducts(env);
    let existingIds=[];
    if(requestedOffers.length){
      const found=await env.DB.prepare(`SELECT id FROM offers WHERE id IN (${requestedOffers.map(()=>'?').join(',')})`).bind(...requestedOffers).all();
      const allowed=new Set((found.results||[]).map(row=>row.id));existingIds=requestedOffers.filter(value=>allowed.has(value));
    }
    const current=await env.DB.prepare('SELECT created_at,published_at FROM blog_posts WHERE id=?').bind(id).first();
    const publishedAt=status==='published'?(Number(current?.published_at)||now):null;
    const statements=[env.DB.prepare(`INSERT INTO blog_posts(id,slug,title,excerpt,body_markdown,cover_image_url,category,status,meta_title,meta_description,published_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,title=excluded.title,excerpt=excluded.excerpt,body_markdown=excluded.body_markdown,cover_image_url=excluded.cover_image_url,category=excluded.category,status=excluded.status,meta_title=excluded.meta_title,meta_description=excluded.meta_description,published_at=excluded.published_at,updated_at=excluded.updated_at`).bind(id,slug,title,excerpt,content,cover,category,status,metaTitle,metaDescription,publishedAt,Number(current?.created_at)||now,now),env.DB.prepare('DELETE FROM blog_post_offers WHERE post_id=?').bind(id),...existingIds.map((offerId,index)=>env.DB.prepare('INSERT INTO blog_post_offers(post_id,offer_id,position) VALUES(?,?,?)').bind(id,offerId,index))];
    statements.push(env.DB.prepare('DELETE FROM blog_product_links WHERE post_id=?').bind(id),env.DB.prepare('DELETE FROM blog_post_products WHERE post_id=?').bind(id),...requestedProducts.map(product=>env.DB.prepare(`INSERT INTO blog_post_products(post_id,id,name,brand,summary,image_url,affiliate_url,price_label,price_checked_at,specs_json,position) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(id,product.id,product.name,product.brand,product.summary,product.image_url,product.affiliate_url,product.price_label,product.price_checked_at,JSON.stringify(product.specs),product.position)),...requestedProducts.flatMap(product=>product.links.map(link=>env.DB.prepare(`INSERT INTO blog_product_links(post_id,product_id,id,store,label,affiliate_url,position) VALUES(?,?,?,?,?,?,?)`).bind(id,product.id,link.id,link.store,link.label,link.affiliate_url,link.position))));
    await env.DB.batch(statements);
    if(status==='published') context.waitUntil(notifyIndexNow([`/blog/${slug}`,'/blog']));
    return json({ok:true,id,slug,status,published_at:publishedAt,offer_ids:existingIds,product_ids:requestedProducts.map(product=>product.id)},current?200:201);
  } catch(error) {
    if(String(error?.message||'').toLowerCase().includes('unique')) return json({error:'slug_in_use'},409);
    return json({error:'save_failed'},500);
  }
}
