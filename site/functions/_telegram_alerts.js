import {SITE,html,money,offerPath} from './_site.js';
import {MENU,MENU_AJUDA,MENU_BUSCA,MENU_LISTA,MENU_NOVO,deleteStatements,formatPriceAlertList,handleCallback,handlePriceAlert,handlePriceChoice,handleStartProduct,listPriceAlerts,listaComBotoes,maxPorPessoa,removePriceAlert,resumoLigado,textoDaLista} from './_price_alerts.js';
import {limitePessoa} from './_referral.js';
import {mensagemConvite,registrarIndicacao} from './_referral.js';
import {PERGUNTA_BUSCA,amazonNoCatalogo,buscarProdutos,formatarResultados,lerShopee,perguntaBusca,termoBusca} from './_product_search.js';

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
  const value=String(text).trim().slice(0,1000);
  const match=value.match(/^\/([a-z_]+)(?:@\w+)?\s*(.*)$/i);
  if(!match) return value?{command:'alerta',argument:value}:{command:'',argument:''};
  return {command:match[1].toLowerCase(),argument:match[2].trim()};
}

function ajuda(env) {
  return [
    '🔔 <b>Como funciona</b>',
    '',
    '1️⃣ No app da loja, abra o produto e toque em <b>Compartilhar → Copiar link</b>.',
    '2️⃣ Cole o link aqui.',
    '3️⃣ Escolha quando avisar: menor preço, um valor ou queda de %.',
    '',
    'Pronto. Eu confiro o preço e aviso aqui quando baixar.',
    '',
    '<b>Mais jeitos de usar</b>',
    '🔎 Sem link? Mande o nome, como <code>air fryer</code>.',
    '📱 Veja e ajuste tudo no botão <b>Meus alertas</b>.',
    '👨‍👩‍👧 Em grupo: me adicione e use <code>/alerta link</code>.',
    '💬 Em qualquer conversa: <code>@TaBaratoAlertaDePrecoBot fone</code>.',
    '',
    `Até ${maxPorPessoa(env)} produtos por pessoa. Convide amigos (/convidar) para ganhar mais vagas.`,
    'Lojas: Mercado Livre, Shopee e AliExpress. Grátis. /parar apaga seus dados.',
  ].join('\n');
}

// /start curto: o essencial e três atalhos; o passo a passo fica no ❓ Ajuda.
// Duas mensagens porque o menu fixo (teclado) e os botões não cabem na mesma.
function boasVindas(antes='') {
  return [{text:`${antes}Oi! Eu aviso quando um produto baixar de preço.\n\n👉 <b>Cole aqui o link do produto.</b> Só isso.`,markup:MENU},
    {text:'Mercado Livre, Shopee ou AliExpress. Sem link? Busque pelo nome.',markup:{inline_keyboard:[
      [{text:'🔎 Buscar pelo nome',callback_data:'bn'},{text:'📲 Ver um exemplo',callback_data:'ex'}]]}}];
}

const NOVO=[
  '➕ <b>Novo alerta</b>',
  '',
  'Cole aqui o link do produto do <b>Mercado Livre</b>, da <b>Shopee</b> ou do <b>AliExpress</b>.',
  'No app: abra o produto → <b>Compartilhar</b> → <b>Copiar link</b>.',
  '',
  'Se já souber quanto quer pagar, mande junto: <code>https://… 199,90</code>',
  '',
  'Sem o link? Toque em 🔎 <b>Buscar produto</b>.',
].join('\n');

async function buscar(env,termoDigitado,now,fetcher=fetch) {
  const termo=termoBusca(termoDigitado);
  if(!termo) return {text:'Mande de 2 a 60 letras, por exemplo: <code>air fryer mondial</code>',markup:MENU};
  const itens=await buscarProdutos(env,termo,fetcher,now);
  return formatarResultados(termo,itens,validKeyword(termo),itens.length?null:await amazonNoCatalogo(env,termo));
}

async function criarPalavra(env,chatId,keyword,now) {
  const count=await env.DB.prepare('SELECT COUNT(*) total FROM alert_subscriptions WHERE chat_id=?').bind(chatId).first();
  if(Number(count?.total||0)>=MAX_KEYWORDS_PER_CHAT){
    return `Você já tem ${MAX_KEYWORDS_PER_CHAT} alertas de palavra. Remova um com /remover antes de criar outro.`;
  }
  await env.DB.prepare('INSERT OR IGNORE INTO alert_subscriptions(chat_id,keyword,created_at) VALUES(?,?,?)').bind(chatId,keyword,now).run();
  return `✅ Combinado! Aviso quando aparecer oferta de <b>${html(keyword)}</b>.\n/meusalertas para ver todos.`;
}

// Botões da busca e da palavra; o resto vai para os botões do cartão.
export async function handleAlertCallback(env,chatId,dados,now=Math.floor(Date.now()/1000),fetcher=fetch) {
  const texto=String(dados||'');
  if(texto==='bn') return {answer:'Buscar',...perguntaBusca()};
  if(texto==='aj') return {answer:'Como funciona',text:ajuda(env),markup:null};
  const palavra=texto.match(/^k:(.{3,40})$/);
  if(palavra){
    const keyword=validKeyword(palavra[1]);
    if(!keyword) return {answer:'Palavra inválida'};
    return {answer:'Alerta de palavra',text:await criarPalavra(env,chatId,keyword,now),markup:null};
  }
  const escolha=texto.match(/^b:(ml|sp|ae):([A-Za-z0-9_]{3,60})$/);
  if(escolha){
    const extra=escolha[1]==='sp'?await lerShopee(env,escolha[2],fetcher):null;
    const r=await handleStartProduct(env,chatId,`${escolha[1]}_${escolha[2]}`,now,'busca',extra);
    if(!r) return {answer:'Produto inválido'};
    return {answer:'Alerta criado',...(typeof r==='string'?{text:r,markup:null}:r)};
  }
  return handleCallback(env,chatId,texto,now);
}

export async function handleUpdate(env,update,now=Math.floor(Date.now()/1000)) {
  const message=update?.message;
  const chat=message?.chat;
  if(!message||!chat||chat.type!=='private'||typeof message.text!=='string') return null;
  const chatId=String(chat.id);
  if(!/^\d{1,20}$/.test(chatId)) return null;
  const texto=message.text.trim();
  if(texto===MENU_NOVO) return {text:NOVO,markup:MENU};
  if(texto===MENU_AJUDA) return {text:ajuda(env),markup:MENU};
  if(texto===MENU_BUSCA) return perguntaBusca();
  const respondeuBusca=message.reply_to_message?.from?.is_bot&&String(message.reply_to_message.text||'').startsWith(PERGUNTA_BUSCA);
  if(respondeuBusca&&!/https?:\/\//i.test(texto)) return buscar(env,texto,now);
  const escolha=await handlePriceChoice(env,chatId,texto,now);
  if(escolha) return escolha;
  const {command,argument}=texto===MENU_LISTA?{command:'meusalertas',argument:''}:parseCommand(texto);
  if(command==='start'&&argument){
    const produto=await handleStartProduct(env,chatId,argument,now);
    if(produto) return produto;
  }
  if(command==='start'&&/^r_[a-z0-9]{8}$/.test(argument)){
    const veio=await registrarIndicacao(env,chatId,argument.slice(2));
    return boasVindas(veio?'👋 Que bom que você veio pelo convite de um amigo!\n\n':'');
  }
  if(command==='convidar'||command==='indicar') return mensagemConvite(env,chatId);
  if(command==='start') return boasVindas();
  if(command==='ajuda'||command==='help') return {text:ajuda(env),markup:MENU};
  if(command==='buscar') return argument?buscar(env,argument,now):perguntaBusca();
  if(command==='meusalertas'){
    const result=await env.DB.prepare('SELECT keyword FROM alert_subscriptions WHERE chat_id=? ORDER BY created_at').bind(chatId).all();
    const keywords=(result.results||[]).map(row=>row.keyword);
    const precos=await listPriceAlerts(env,chatId,now);
    if(!keywords.length&&!precos.length){
      return {text:`Você ainda não tem alertas.\n\n${NOVO}`,markup:MENU};
    }
    const partes=[];
    if(precos.length) partes.push(textoDaLista(precos,await limitePessoa(env,chatId)));
    else partes.push('📋 <b>Seus alertas</b>');
    if(keywords.length) partes.push(`<b>Palavras</b> (aviso quando o canal postar)\n${keywords.map(item=>`• ${html(item)}`).join('\n')}\nPara apagar: /remover air fryer`);
    return {text:partes.join('\n\n'),
      markup:precos.length?listaComBotoes(precos,await resumoLigado(env,chatId)):MENU};
  }
  if(command==='parar'){
    await env.DB.batch([
      env.DB.prepare('DELETE FROM alert_subscriptions WHERE chat_id=?').bind(chatId),
      env.DB.prepare('DELETE FROM alert_deliveries WHERE chat_id=?').bind(chatId),
      ...deleteStatements(env,chatId),
    ]);
    return 'Pronto: seus alertas e o histórico de avisos foram apagados. Envie /start se quiser voltar.';
  }
  if(command==='remover'){
    if(/^\d{1,2}$/.test(argument)) return removePriceAlert(env,chatId,argument,now);
    const keyword=validKeyword(argument);
    if(!keyword) return 'Diga qual alerta remover, por exemplo: /remover air fryer';
    await env.DB.prepare('DELETE FROM alert_subscriptions WHERE chat_id=? AND keyword=?').bind(chatId,keyword).run();
    return `Alerta removido: ${html(keyword)}`;
  }
  if(command==='alerta'&&/https?:\/\//i.test(argument)) return handlePriceAlert(env,chatId,argument,now);
  // Texto solto agora é busca; /alerta palavra continua criando o alerta por palavra.
  if(command==='alerta'&&!texto.startsWith('/')) return buscar(env,argument,now);
  if(command==='alerta'){
    const keyword=validKeyword(argument);
    if(!keyword) return 'Use de 3 a 40 letras, com até 4 palavras. Exemplo: <code>air fryer</code>';
    return criarPalavra(env,chatId,keyword,now);
  }
  return {text:ajuda(env),markup:MENU};
}

export async function sendTelegram(env,chatId,text,button,fetcher=fetch,markup=null) {
  const body={chat_id:chatId,text,parse_mode:'HTML',disable_web_page_preview:false};
  if(button) body.reply_markup={inline_keyboard:[[button]]};
  if(markup) body.reply_markup=markup;
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
          ...deleteStatements(env,chatId),
        ]);
      }else if(status>=200&&status<300) sent++;
    }catch(error){
      console.error(JSON.stringify({event:'telegram_alert',result:'failed',reason:String(error?.message||error).slice(0,80)}));
    }
  }
  await env.DB.prepare('DELETE FROM alert_deliveries WHERE sent_at<?').bind(now-30*86400).run();
  return sent;
}
