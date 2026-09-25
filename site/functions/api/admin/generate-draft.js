import {requireAdmin} from '../../_admin.js';
import {generateDailyDraft} from '../../_blog_draft.js';
import {json} from '../../_lib.js';

export async function onRequestPost({request,env}) {
  const auth=await requireAdmin(request,env);if(auth.response)return auth.response;
  try{return json(await generateDailyDraft(env),200);}
  catch{return json({error:'draft_generation_failed'},500);}
}
