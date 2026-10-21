import {saveBlogPost} from '../_blog_save.js';
import {authorized,json,readJsonLimited} from '../_lib.js';

const GUIDE_ID=/^[a-z0-9-]{3,80}$/;

// Guias de compra gerados pelo bot. Cada pauta tem um id fixo (guia-auto-...)
// e é atualizada no mesmo endereço; matérias escritas no painel nunca são
// sobrescritas, porque o id sempre recebe o prefixo e o slug é único.
export async function onRequestPost(context) {
  const {request,env}=context;
  if(!await authorized(request,env.PUBLISH_TOKEN)) return json({error:'unauthorized'},401);
  if(Number(request.headers.get('Content-Length')||0)>200000) return json({error:'too_large'},413);
  let body;
  try{body=await readJsonLimited(request,200000);}catch(error){
    return json({error:error?.message==='too_large'?'too_large':'invalid_json'},error?.message==='too_large'?413:400);
  }
  const topic=String(body?.topic||'');
  if(!GUIDE_ID.test(topic)) return json({error:'invalid_topic'},400);
  if(body.status==='archived'){
    // Tira do ar um guia que deixou de ter produtos aptos, sem apagar o histórico.
    const now=Math.floor(Date.now()/1000);
    await env.DB.prepare("UPDATE blog_posts SET status='archived',updated_at=? WHERE id=?").bind(now,`guia-auto-${topic}`).run();
    return json({ok:true,id:`guia-auto-${topic}`,status:'archived'});
  }
  const products=Array.isArray(body.products)?body.products:[];
  if(products.length<3) return json({error:'not_enough_products'},400);
  return saveBlogPost(context,{
    ...body,
    id:`guia-auto-${topic}`,
    status:body.status==='draft'?'draft':'published',
    offer_ids:[],
  });
}
