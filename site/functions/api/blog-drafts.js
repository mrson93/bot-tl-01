import {authorized,json} from '../_lib.js';

export async function onRequestPost({request,env}) {
  if(!await authorized(request,env.PUBLISH_TOKEN))return json({error:'unauthorized'},401);
  return json({created:false,reason:'editorial_topic_required'},410);
}
