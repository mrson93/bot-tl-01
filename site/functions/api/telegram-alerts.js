import {readJsonLimited} from '../_lib.js';
import {ensureAlertTables,handleAlertCallback,handleUpdate,sendTelegram} from '../_telegram_alerts.js';
import {telegram,telegramArquivo} from '../_price_alerts.js';

// Toque num botão dentro da mensagem: só vale no privado e só para o dono.
export async function responderBotao(env,consulta,fetcher=fetch,now=Math.floor(Date.now()/1000)) {
  const chat=consulta?.message?.chat;
  const chatId=String(chat?.id||'');
  if(chat?.type!=='private'||!/^\d{1,20}$/.test(chatId)||String(consulta?.from?.id)!==chatId){
    return telegram(env,'answerCallbackQuery',{callback_query_id:consulta?.id},fetcher);
  }
  const r=await handleAlertCallback(env,chatId,consulta.data,now,fetcher);
  await telegram(env,'answerCallbackQuery',{callback_query_id:consulta.id,text:String(r.answer||'').slice(0,190)},fetcher);
  const markup=r.markup===null?undefined:r.markup;
  if(r.photo) return enviarGrafico(env,chatId,consulta,r,markup,fetcher);
  if(!r.text) return;
  if(r.edit&&consulta.message?.text!==undefined){
    const status=await telegram(env,'editMessageText',{chat_id:chatId,message_id:consulta.message.message_id,text:r.text,
      parse_mode:'HTML',disable_web_page_preview:true,...(markup?{reply_markup:markup}:{})},fetcher);
    if(status>=200&&status<300) return;
  }
  await telegram(env,'sendMessage',{chat_id:chatId,text:r.text,parse_mode:'HTML',disable_web_page_preview:true,
    ...(markup?{reply_markup:markup}:{})},fetcher);
}

// Gráfico: os botões de período trocam a própria foto; os outros mandam uma nova.
async function enviarGrafico(env,chatId,consulta,r,markup,fetcher) {
  const {png,caption}=r.photo;
  if(r.edit&&consulta.message?.photo){
    const status=await telegramArquivo(env,'editMessageMedia',{chat_id:chatId,message_id:String(consulta.message.message_id),
      media:{type:'photo',media:'attach://grafico',caption,parse_mode:'HTML'},reply_markup:markup},
    {campo:'grafico',bytes:png},fetcher);
    if(status>=200&&status<300) return;
  }
  await telegramArquivo(env,'sendPhoto',{chat_id:chatId,caption,parse_mode:'HTML',reply_markup:markup},
    {campo:'photo',bytes:png},fetcher);
}

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
  try{
    if(update?.callback_query) await responderBotao(env,update.callback_query);
    else{
      const reply=await handleUpdate(env,update);
      for(const item of (Array.isArray(reply)?reply:reply?[reply]:[])){
        const {text,markup}=typeof item==='string'?{text:item,markup:null}:item;
        await sendTelegram(env,String(update.message.chat.id),text,null,fetch,markup);
      }
    }
  }catch(error){console.error(JSON.stringify({event:'telegram_alert_reply',result:'failed',reason:String(error?.message||error).slice(0,80)}));}
  // 200 mesmo sem resposta: o Telegram não deve reenviar mensagens ignoradas.
  return new Response('OK',{status:200});
}
