import {requireAdmin} from '../../_admin.js';
import {ensureBlogProducts,productSpecs} from '../../_blog_products.js';
import {saveBlogPost} from '../../_blog_save.js';
import {json,readJsonLimited} from '../../_lib.js';

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
    return json({posts:(result.results||[]).map(post=>{
      const products=productsByPost.get(post.id)||[];
      return {...post,offer_ids:post.offer_ids?post.offer_ids.split(','):[],products,
        missing_product_links:products.filter(product=>!product.links.length).length,
        missing_product_prices:products.filter(product=>!product.price_label).length,
        missing_product_specs:products.filter(product=>!Object.keys(product.specs||{}).length).length,
        missing_product_images:products.filter(product=>!product.image_url).length};
    })});
  } catch { return json({error:'blog_not_configured'},503); }
}

export async function onRequestPost(context) {
  const {request,env}=context,auth=await requireAdmin(request,env);if(auth.response) return auth.response;
  let body;try{body=await readJsonLimited(request,200000);}catch(error){return json({error:error?.message==='too_large'?'too_large':'invalid_json'},error?.message==='too_large'?413:400);}
  return saveBlogPost(context,body);
}
