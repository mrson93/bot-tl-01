import {readJsonLimited} from '../_lib.js';
import {ensureAlertTables,handleUpdate,sendTelegram} from '../_telegram_alerts.js';

const MAX_UPDATE_BYTES=65_536;

async function secureEqual(left,right) {
  const encoder=new TextEncoder();
  const [a,b]=await Promise.all([
    crypto.subtle.digest('SHA-256',encoder.encode(String(left||''))),
    crypto.subtle.digest('SHA-256',encoder.encode(String(right||''))),
  ]);
  const x=new Uint8Array(a),y=new Uint8Array(b);let difference=0;
  for(let index=0;index<x.length;index++) difference|=x[index]^y[index];
  return difference===0;
}

// Webhook do bot público de alertas. O Telegram envia o segredo definido em
// setWebhook no cabeçalho abaixo; sem ele configurado, o endpoint fica fechado.
export async function onRequestPost({request,env}) {
  const expected=String(env.TELEGRAM_ALERTS_WEBHOOK_SECRET||'');
  if(!expected||!env.TELEGRAM_ALERTS_BOT_TOKEN) return new Response('Unavailable',{status:503});
  if(!await secureEqual(request.headers.get('X-Telegram-Bot-Api-Secret-Token'),expected)){
    return new Response('Unauthorized',{status:401});
  }
  if(Number(request.headers.get('Content-Length')||0)>MAX_UPDATE_BYTES) return new Response('Too large',{status:413});
  let update;
  try{update=await readJsonLimited(request,MAX_UPDATE_BYTES);}catch{return new Response('Bad request',{status:400});}
  await ensureAlertTables(env);
  const reply=await handleUpdate(env,update);
  if(reply){
    try{await sendTelegram(env,String(update.message.chat.id),reply);}
    catch(error){console.error(JSON.stringify({event:'telegram_alert_reply',result:'failed',reason:String(error?.message||error).slice(0,80)}));}
  }
  // 200 mesmo sem resposta: o Telegram não deve reenviar mensagens ignoradas.
  return new Response('OK',{status:200});
}
