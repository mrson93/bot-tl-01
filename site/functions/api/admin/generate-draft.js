import {requireAdmin} from '../../_admin.js';
import {json} from '../../_lib.js';

export async function onRequestPost({request,env}) {
  const auth=await requireAdmin(request,env);if(auth.response)return auth.response;
  return json({created:false,reason:'editorial_topic_required'},410);
}
