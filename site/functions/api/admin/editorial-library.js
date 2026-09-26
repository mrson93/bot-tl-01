import {requireAdmin} from '../../_admin.js';
import {EDITORIAL_ARTICLES,ensureEditorialSeed} from '../../_editorial_seed.js';
import {notifyIndexNow} from '../../_indexnow.js';
import {json} from '../../_lib.js';

export async function onRequestPost(context){
  const {request,env}=context,auth=await requireAdmin(request,env);if(auth.response)return auth.response;
  try{
    const result=await ensureEditorialSeed(env);
    if(result.created||result.covers_updated||result.images_updated)context.waitUntil(notifyIndexNow(['/blog',...EDITORIAL_ARTICLES.map(article=>`/blog/${article.slug}`)]));
    return json(result,200);
  }catch{return json({error:'editorial_library_failed'},500);}
}
