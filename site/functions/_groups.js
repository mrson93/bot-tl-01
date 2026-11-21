import {html} from './_site.js';
import {deleteStatements,handlePriceAlert,handlePriceChoice,listPriceAlerts,listaComBotoes,textoDaLista} from './_price_alerts.js';
import {limiteGrupo} from './_referral.js';
import {PERGUNTA_BUSCA,buscarProdutos,formatarResultados,perguntaBusca,termoBusca} from './_product_search.js';

// Bot em grupos (família, amigos): lista de desejos do grupo. Qualquer membro
// adiciona produto; só admins apagam, ajustam e usam /parar. O bot guarda só o
// número do grupo e, com o modo de privacidade do Telegram, só lê comandos e
// respostas às mensagens dele.
const TELEGRAM_API='https://api.telegram.org';
export const TIPOS_GRUPO=new Set(['group','supergroup']);
export const ehGrupo=chatId=>/^-\d{1,20}$/.test(String(chatId||''));
const BOT_PADRAO='TaBaratoAlertaDePrecoBot';

export function usuarioDoBot(env) {
  const nome=String(env?.TELEGRAM_ALERTS_BOT_USERNAME||'');
  return /^[A-Za-z0-9_]{5,32}$/.test(nome)?nome:BOT_PADRAO;
}

export async function ehAdmin(env,chatId,userId,fetcher=fetch) {
  if(!/^\d{1,20}$/.test(String(userId||''))) return false;
  try{
    const r=await fetcher(`${TELEGRAM_API}/bot${env.TELEGRAM_ALERTS_BOT_TOKEN}/getChatMember`,{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:String(chatId),user_id:Number(userId)})});
    const status=(await r.json())?.result?.status;
    return status==='creator'||status==='administrator';
  }catch{ return false; }
}

export function ajudaGrupo(env) {
  const bot=usuarioDoBot(env);
  return ['🔔 <b>Lista de desejos do grupo</b>',
    'Eu acompanho o preço dos produtos que vocês quiserem e aviso aqui no grupo quando baixar de verdade.','',
    `➕ <code>/alerta@${bot} link</code>: qualquer pessoa põe um produto do Mercado Livre, da Shopee ou do AliExpress na lista.`,
    `🔎 <code>/buscar@${bot} air fryer</code>: busca pelo nome e adiciona pelos resultados.`,
    `📋 <code>/lista@${bot}</code>: os produtos do grupo, com histórico e gráfico.`,
    '⚙️ Só admins do grupo apagam ou mudam os avisos (valor, queda, prazo).',
    `🗑 <code>/parar@${bot}</code> (admins): apaga a lista do grupo.`,'',
    'Guardo só o número do grupo e não leio as conversas.'].join('\n');
}

// Comando endereçado a outro bot (/start@OutroBot) não é com a gente.
function comandoDoGrupo(env,texto) {
  const achado=String(texto||'').trim().match(/^\/([a-z_]+)(?:@(\w+))?(?:\s+([\s\S]*))?$/i);
  if(!achado) return null;
  if(achado[2]&&achado[2].toLowerCase()!==usuarioDoBot(env).toLowerCase()) return null;
  return {comando:achado[1].toLowerCase(),argumento:String(achado[3]||'').trim().slice(0,1000)};
}

// Tira teclados fixos (são do privado) e o botão de alerta por palavra.
export function paraGrupo(resposta) {
  if(!resposta||typeof resposta==='string') return resposta;
  const markup=resposta.markup;
  if(markup?.keyboard) return {...resposta,markup:null};
  if(markup?.inline_keyboard){
    const linhas=markup.inline_keyboard.map(l=>l.filter(b=>!proibidoNoGrupo(b.callback_data)&&!b.web_app)).filter(l=>l.length);
    return {...resposta,markup:linhas.length?{inline_keyboard:linhas}:null};
  }
  return resposta;
}

async function listaDoGrupo(env,chatId,now) {
  const alertas=await listPriceAlerts(env,chatId,now);
  if(!alertas.length) return {text:`A lista do grupo está vazia. Mandem <code>/alerta@${usuarioDoBot(env)} link</code> para pôr um produto.`};
  return {text:textoDaLista(alertas,limiteGrupo(env),'📋 <b>Lista do grupo</b>'),markup:listaComBotoes(alertas)};
}

// Mensagem num grupo -> resposta (ou null). fetcher só para a checagem de admin.
export async function handleGroupMessage(env,message,now=Math.floor(Date.now()/1000),fetcher=fetch) {
  const chatId=String(message?.chat?.id||'');
  if(!ehGrupo(chatId)) return null;
  // Grupo virou supergrupo: a lista acompanha o número novo.
  if(message.migrate_to_chat_id&&ehGrupo(String(message.migrate_to_chat_id))){
    await env.DB.prepare('UPDATE alerta_precos SET chat_id=? WHERE chat_id=?').bind(String(message.migrate_to_chat_id),chatId).run();
    return null;
  }
  if(typeof message.text!=='string') return null;
  const texto=message.text.trim();
  const respostaAoBot=message.reply_to_message?.from?.is_bot&&message.reply_to_message.from.username?.toLowerCase()===usuarioDoBot(env).toLowerCase();
  if(respostaAoBot&&!texto.startsWith('/')){
    if(String(message.reply_to_message.text||'').startsWith(PERGUNTA_BUSCA)) return buscarNoGrupo(env,texto,now,fetcher);
    // Valor pedido por um admin no botão 💰: só admin responde.
    if(!await ehAdmin(env,chatId,message.from?.id,fetcher)) return null;
    return paraGrupo(await handlePriceChoice(env,chatId,texto,now));
  }
  const pedido=comandoDoGrupo(env,texto);
  if(!pedido) return null;
  const {comando,argumento}=pedido;
  if(comando==='start'||comando==='ajuda'||comando==='help') return {text:ajudaGrupo(env)};
  if(comando==='alerta'||comando==='adicionar'){
    if(!/https?:\/\//i.test(argumento)) return {text:`Mande junto o link do produto: <code>/alerta@${usuarioDoBot(env)} https://…</code>`};
    return paraGrupo(await handlePriceAlert(env,chatId,argumento,now));
  }
  if(comando==='lista'||comando==='meusalertas') return listaDoGrupo(env,chatId,now);
  if(comando==='buscar') return argumento?buscarNoGrupo(env,argumento,now,fetcher):perguntaBusca();
  if(comando==='parar'){
    if(!await ehAdmin(env,chatId,message.from?.id,fetcher)) return {text:'Só admins do grupo podem apagar a lista.'};
    await env.DB.batch([...deleteStatements(env,chatId),
      env.DB.prepare('DELETE FROM alert_subscriptions WHERE chat_id=?').bind(chatId)]);
    return {text:'🗑 Pronto: a lista do grupo foi apagada. Para recomeçar, mandem /alerta com um link.'};
  }
  return null;
}

async function buscarNoGrupo(env,termoDigitado,now,fetcher) {
  const termo=termoBusca(termoDigitado);
  if(!termo) return {text:'Mandem de 2 a 60 letras, por exemplo: <code>air fryer mondial</code>'};
  return paraGrupo(formatarResultados(termo,await buscarProdutos(env,termo,fetcher,now),''));
}

// Bot entrou ou saiu do grupo (my_chat_member).
export async function handleMembership(env,evento) {
  const chatId=String(evento?.chat?.id||'');
  if(!TIPOS_GRUPO.has(evento?.chat?.type)||!ehGrupo(chatId)) return null;
  const novo=evento?.new_chat_member?.status, antigo=evento?.old_chat_member?.status;
  if(['left','kicked'].includes(novo)){
    await env.DB.batch([...deleteStatements(env,chatId),
      env.DB.prepare('DELETE FROM alert_subscriptions WHERE chat_id=?').bind(chatId)]);
    return null;
  }
  if(['member','administrator'].includes(novo)&&['left','kicked',undefined].includes(antigo)) return {text:ajudaGrupo(env)};
  return null;
}

// Botões no grupo: ver é livre; adicionar (b:) é de qualquer membro; o resto
// muda a lista e é só de admin. Convite e resumo semanal não existem em grupo.
const SO_VER=/^(l|ex|aj|-|bn|a:\d{1,12}:(c|g|gt(:\d{1,4})?))$/;
export function precisaDeAdmin(dados) {
  const texto=String(dados||'');
  if(SO_VER.test(texto)||/^b:(ml|sp|ae):/.test(texto)) return false;
  return true;
}
export const proibidoNoGrupo=dados=>/^(cv|rs:[01]|k:)/.test(String(dados||''));

export const nomeDoGrupo=chat=>html(String(chat?.title||'grupo').slice(0,60));
