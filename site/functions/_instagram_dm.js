import {safeUrl} from './_lib.js';

const encoder=new TextEncoder();

function bytesFromHex(value) {
  if(!/^[a-f0-9]{64}$/i.test(value)) return null;
  return Uint8Array.from(value.match(/../g),byte=>Number.parseInt(byte,16));
}

export async function verifyMetaSignature(body,header,secret) {
  const match=/^sha256=([a-f0-9]{64})$/i.exec(String(header||''));
  if(!match||!secret) return false;
  const signature=bytesFromHex(match[1]);
  const key=await crypto.subtle.importKey(
    'raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']
  );
  return crypto.subtle.verify('HMAC',key,signature,body);
}

function normalized(value) {
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().trim();
}

export function extractInboundEvents(payload,expectedAccountIds=[]) {
  if(!['instagram','page'].includes(payload?.object)||!Array.isArray(payload.entry)) return [];
  const allowedIds=new Set((Array.isArray(expectedAccountIds)?expectedAccountIds:[expectedAccountIds])
    .map(value=>String(value||'')).filter(Boolean));
  const events=[];
  for(const entry of payload.entry){
    if(allowedIds.size&&!allowedIds.has(String(entry?.id||''))) continue;
    for(const item of Array.isArray(entry?.messaging)?entry.messaging:[]){
      const message=item?.message||{};
      if(message.is_echo) continue;
      const senderId=String(item?.sender?.id||'');
      const messageId=String(message.mid||item?.mid||'');
      const text=String(message.text||item?.postback?.payload||'');
      const reply=message.reply_to||item.reply_to||null;
      const storyIds=[reply?.mid,reply?.id,reply?.story?.id,
        item?.referral?.media_id,message?.referral?.media_id]
        .map(value=>String(value||'')).filter(value=>/^\d{5,40}$/.test(value));
      const isStoryReply=Boolean(reply)||storyIds.length>0;
      const keyword=normalized(text).split(/[^a-z0-9]+/).includes('quero');
      if(senderId&&messageId&&(isStoryReply||keyword)){
        events.push({senderId,messageId,text,storyIds:[...new Set(storyIds)],isStoryReply,keyword});
      }
    }
  }
  return events;
}

export function formatOfferMessage(story) {
  const title=String(story?.title||'Oferta').replace(/\s+/g,' ').trim().slice(0,180);
  const price=Number(story?.price);
  const priceText=Number.isFinite(price)&&price>0
    ? `R$ ${price.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`
    : 'Confira o preço na loja';
  return `🛍️ ${title}\n\n💰 ${priceText}\n\n👉 Comprar: ${story.link}\n\nLink de afiliado. Preço e estoque podem mudar.`;
}

async function eventHash(messageId) {
  const digest=await crypto.subtle.digest('SHA-256',encoder.encode(messageId));
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
}

async function findStory(env,event,now) {
  for(const mediaId of event.storyIds){
    const row=await env.DB.prepare(`SELECT media_id,title,price,link FROM instagram_story_offers WHERE (media_id=? OR container_id=?) AND expires_at>?`).bind(mediaId,mediaId,now).first();
    if(row) return row;
  }
  if(!event.isStoryReply&&!event.keyword) return null;
  return env.DB.prepare(`SELECT media_id,title,price,link FROM instagram_story_offers WHERE expires_at>? ORDER BY published_at DESC LIMIT 1`).bind(now).first();
}

async function sendMessage(env,recipientId,text) {
  const version=String(env.META_GRAPH_API_VERSION||'v26.0');
  const pageId=String(env.META_PAGE_ID||'');
  if(!/^v\d{1,3}\.\d{1,2}$/.test(version)||!/^\d{5,40}$/.test(pageId)||!env.META_PAGE_ACCESS_TOKEN){
    throw new Error('meta_not_configured');
  }
  const response=await fetch(`https://graph.facebook.com/${version}/${pageId}/messages`,{
    method:'POST',signal:AbortSignal.timeout(12_000),
    headers:{'Authorization':`Bearer ${env.META_PAGE_ACCESS_TOKEN}`,'Content-Type':'application/json'},
    body:JSON.stringify({recipient:{id:recipientId},messaging_type:'RESPONSE',message:{text}}),
  });
  if(!response.ok) throw new Error(`meta_send_${response.status}`);
}

export async function processInboundEvent(env,event,now=Math.floor(Date.now()/1000)) {
  const hash=await eventHash(event.messageId);
  const claim=await env.DB.prepare(`INSERT OR IGNORE INTO instagram_dm_events(event_hash,status,created_at) VALUES(?,'processing',?)`).bind(hash,now).run();
  if(!Number(claim?.meta?.changes||0)) return 'duplicate';
  try{
    const story=await findStory(env,event,now);
    if(!story){
      await env.DB.prepare(`UPDATE instagram_dm_events SET status='ignored' WHERE event_hash=?`).bind(hash).run();
      return 'ignored';
    }
    const link=safeUrl(story.link,env.ALLOWED_DESTINATION_HOSTS);
    if(!link) throw new Error('invalid_destination');
    await sendMessage(env,event.senderId,formatOfferMessage({...story,link}));
    await env.DB.prepare(`UPDATE instagram_dm_events SET status='sent' WHERE event_hash=?`).bind(hash).run();
    return 'sent';
  }catch(error){
    await env.DB.prepare('DELETE FROM instagram_dm_events WHERE event_hash=?').bind(hash).run();
    throw error;
  }
}
