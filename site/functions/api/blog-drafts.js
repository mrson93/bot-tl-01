import {generateDailyDraft} from '../_blog_draft.js';
import {authorized,json} from '../_lib.js';

export async function onRequestPost({request,env}) {
  if(!await authorized(request,env.PUBLISH_TOKEN))return json({error:'unauthorized'},401);
  try{return json(await generateDailyDraft(env),200);}
  catch{return json({error:'draft_generation_failed'},500);}
}
