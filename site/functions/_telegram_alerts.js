import {SITE,html,money,offerPath} from './_site.js';

// Bot público e separado do painel administrativo: guarda apenas o chat_id
// numérico do Telegram e as palavras escolhidas, nada de nome ou telefone.
export const MAX_KEYWORDS_PER_CHAT=5;
export const MAX_ALERTS_PER_DAY=6;
const MAX_RECIPIENTS_PER_OFFER=300;
const TELEGRAM_API='https://api.telegram.org';

const SCHEMA=[
  'CREATE TABLE IF NOT EXISTS alert_subscriptions (chat_id TEXT NOT NULL,keyword TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY (chat_id,keyword))',
  'CREATE TABLE IF NOT EXISTS alert_deliveries (chat_id TEXT NOT NULL,offer_id TEXT NOT NULL,sent_at INTEGER NOT NULL,PRIMARY KEY (chat_id,offer_id))',
  'CREATE INDEX IF NOT EXISTS idx_alert_deliveries_sent ON alert_deliveries(chat_id,sent_at)',
];

export async function ensureAlertTables(env) {
  for(const sql of SCHEMA) await env.DB.prepare(sql).run();
}

export function normalizeText(value='') {
  return String(value).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()
    .replace(/[^a-z0-9]+/g,' ').trim();
}

export function validKeyword(value='') {
  const keyword=normalizeText(value);
  if(keyword.length<3||keyword.length>40||keyword.split(' ').length>4) return '';
  return keyword;
}

// Palavras inteiras: "pa" não casa com "panela"; plural simples é aceito.
export function titleMatches(title,keyword) {
  const normalized=` ${normalizeText(title)} `;
  return keyword.split(' ').every(word=>new RegExp(` ${word}s? `).test(normalized));
}

export function parseCommand(text='') {
  const value=String(text).trim().slice(0,200);
  const match=value.match(/^\/([a-z_]+)(?:@\w+)?\s*(.*)$/i);
  if(!match) return value?{command:'alerta',argument:value}:{command:'',argument:''};
  return {command:match[1].toLowerCase(),argument:match[2].trim()};
}

const HELP=[
  '🔔 <b>Alertas do Tá Barato</b>',
  '',
  'Me diga o que você procura e eu aviso quando aparecer oferta disso.',
  '',
  '• Envie uma palavra, por exemplo: <code>air fryer</code>',
  '• /meusalertas — ver seus alertas',
  '• /remover air fryer — apagar um alerta',
  '• /parar — apagar todos os seus dados',
  '',
  `Até ${MAX_KEYWORDS_PER_CHAT} alertas por pessoa e no máximo ${MAX_ALERTS_PER_DAY} avisos por dia.`,
].join('\n');

export async function handleUpdate(env,update,now=Math.floor(Date.now()/1000)) {
  const message=update?.message;
  const chat=message?.chat;
  if(!message||!chat||chat.type!=='private'||typeof message.text!=='string') return null;
  const chatId=String(chat.id);
  if(!/^\d{1,20}$/.test(chatId)) return null;
  const {command,argument}=parseCommand(message.text);
  if(command==='start'||command==='ajuda'||command==='help') return HELP;
  if(command==='meusalertas'){
    const result=await env.DB.prepare('SELECT keyword FROM alert_subscriptions WHERE chat_id=? ORDER BY created_at').bind(chatId).all();
    const keywords=(result.results||[]).map(row=>row.keyword);
    return keywords.length?`Seus alertas:\n${keywords.map(item=>`• ${html(item)}`).join('\n')}`
      :'Você ainda não tem alertas. Envie uma palavra, por exemplo: <code>fone bluetooth</code>';
  }
  if(command==='parar'){
    await env.DB.batch([
      env.DB.prepare('DELETE FROM alert_subscriptions WHERE chat_id=?').bind(chatId),
      env.DB.prepare('DELETE FROM alert_deliveries WHERE chat_id=?').bind(chatId),
    ]);
    return 'Pronto: seus alertas e o histórico de avisos foram apagados. Envie /start se quiser voltar.';
  }
  if(command==='remover'){
    const keyword=validKeyword(argument);
    if(!keyword) return 'Diga qual alerta remover, por exemplo: /remover air fryer';
    await env.DB.prepare('DELETE FROM alert_subscriptions WHERE chat_id=? AND keyword=?').bind(chatId,keyword).run();
    return `Alerta removido: ${html(keyword)}`;
  }
  if(command==='alerta'){
    const keyword=validKeyword(argument);
    if(!keyword) return 'Use de 3 a 40 letras, com até 4 palavras. Exemplo: <code>air fryer</code>';
    const count=await env.DB.prepare('SELECT COUNT(*) total FROM alert_subscriptions WHERE chat_id=?').bind(chatId).first();
    if(Number(count?.total||0)>=MAX_KEYWORDS_PER_CHAT){
      return `Você já tem ${MAX_KEYWORDS_PER_CHAT} alertas. Remova um com /remover antes de criar outro.`;
    }
    await env.DB.prepare('INSERT OR IGNORE INTO alert_subscriptions(chat_id,keyword,created_at) VALUES(?,?,?)').bind(chatId,keyword,now).run();
    return `✅ Combinado! Aviso quando aparecer oferta de <b>${html(keyword)}</b>.\n/meusalertas para ver todos.`;
  }
  return HELP;
}

export async function sendTelegram(env,chatId,text,button,fetcher=fetch) {
  const body={chat_id:chatId,text,parse_mode:'HTML',disable_web_page_preview:false};
  if(button) body.reply_markup={inline_keyboard:[[button]]};
  const response=await fetcher(`${TELEGRAM_API}/bot${env.TELEGRAM_ALERTS_BOT_TOKEN}/sendMessage`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
  });
  return response.status;
}

export function formatAlert(offer,keyword) {
  const discount=Number(offer.discount)||0;
  return [
    `🔔 Alerta: <b>${html(keyword)}</b>`,
    '',
    `<b>${html(String(offer.title||'').slice(0,160))}</b>`,
    `💰 ${html(money(offer.price))}${discount>=1?` · ${Math.round(discount)}% OFF`:''}`,
    '',
    '<i>Preço pode mudar. Link de afiliado.</i>',
  ].join('\n');
}

export async function notifyOfferAlerts(env,offer,now=Math.floor(Date.now()/1000),fetcher=fetch) {
  if(!env.TELEGRAM_ALERTS_BOT_TOKEN||!offer?.id||!offer?.title) return 0;
  await ensureAlertTables(env);
  const result=await env.DB.prepare('SELECT chat_id,keyword FROM alert_subscriptions ORDER BY created_at').all();
  const matched=new Map();
  for(const row of result.results||[]){
    if(!matched.has(row.chat_id)&&titleMatches(offer.title,row.keyword)) matched.set(row.chat_id,row.keyword);
    if(matched.size>=MAX_RECIPIENTS_PER_OFFER) break;
  }
  const link=`${SITE}${offerPath(offer)}?utm_source=telegram`;
  let sent=0;
  for(const [chatId,keyword] of matched){
    const today=await env.DB.prepare('SELECT COUNT(*) total FROM alert_deliveries WHERE chat_id=? AND sent_at>=?').bind(chatId,now-86400).first();
    if(Number(today?.total||0)>=MAX_ALERTS_PER_DAY) continue;
    const claim=await env.DB.prepare('INSERT OR IGNORE INTO alert_deliveries(chat_id,offer_id,sent_at) VALUES(?,?,?)').bind(chatId,String(offer.id),now).run();
    if(!claim?.meta?.changes) continue;
    try{
      const status=await sendTelegram(env,chatId,formatAlert(offer,keyword),{text:'🛒 Ver oferta',url:link},fetcher);
      if(status===403){
        // A pessoa bloqueou o bot: apagamos os dados dela.
        await env.DB.batch([
          env.DB.prepare('DELETE FROM alert_subscriptions WHERE chat_id=?').bind(chatId),
          env.DB.prepare('DELETE FROM alert_deliveries WHERE chat_id=?').bind(chatId),
        ]);
      }else if(status>=200&&status<300) sent++;
    }catch(error){
      console.error(JSON.stringify({event:'telegram_alert',result:'failed',reason:String(error?.message||error).slice(0,80)}));
    }
  }
  await env.DB.prepare('DELETE FROM alert_deliveries WHERE sent_at<?').bind(now-30*86400).run();
  return sent;
}
