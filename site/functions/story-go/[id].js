import {safeUrl} from '../_lib.js';
import {claimPublicAction} from '../_abuse.js';

function saoPauloDay() {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}

async function recordClick(context,mediaId,offerId) {
  const {env}=context;
  const claim=await claimPublicAction({
    env,request:context.request,purpose:'story-click',resource:mediaId,windowSeconds:300,
    limiter:env.METRICS_RATE_LIMITER,
  });
  if(!claim.accepted) return;
  const day=saoPauloDay(),normalizedOffer=String(offerId||'');
  const insert=()=>env.DB.prepare(`INSERT INTO instagram_story_clicks_daily(observed_on,media_id,offer_id,quantity)
    VALUES(?,?,?,1) ON CONFLICT(observed_on,media_id,offer_id)
    DO UPDATE SET quantity=quantity+1`).bind(day,mediaId,normalizedOffer).run();
  try{await insert();}catch(error){
    if(!String(error?.message||error).toLowerCase().includes('no such table')) throw error;
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS instagram_story_clicks_daily(
      observed_on TEXT NOT NULL,media_id TEXT NOT NULL,offer_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(observed_on,media_id,offer_id))`).run();
    await insert();
  }
  if(normalizedOffer) await env.DB.prepare('INSERT INTO clicks(offer_id,clicked_at) VALUES(?,?)')
    .bind(normalizedOffer,Math.floor(Date.now()/1000)).run();
}

export async function onRequestGet(context) {
  const {env,params}=context,mediaId=String(params.id||'');
  if(!/^\d{5,40}$/.test(mediaId)) return new Response('Oferta não encontrada',{status:404});
  const row=await env.DB.prepare('SELECT offer_id,link FROM instagram_story_offers WHERE media_id=? AND expires_at>?')
    .bind(mediaId,Math.floor(Date.now()/1000)).first();
  const destination=row&&safeUrl(row.link,env.ALLOWED_DESTINATION_HOSTS);
  if(!destination) return new Response('Oferta não encontrada',{status:404});
  context.waitUntil(recordClick(context,mediaId,row.offer_id).catch(error=>console.warn(JSON.stringify({event:'story_click_record_failed',reason:error instanceof Error?error.name:'unknown'}))));
  return Response.redirect(destination,302);
}
