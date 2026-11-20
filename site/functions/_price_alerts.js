import {html,money} from './_site.js';
import {resolveProductLink} from './_product_link.js';

// Alertas de preço por produto do bot público. A pessoa cola o link do
// produto (com ou sem preço); a coleta do monitor (a cada 2 h, no GitHub)
// decide quem avisar e o site entrega a mensagem com o token do bot.
const TELEGRAM_API='https://api.telegram.org';
const HOSTS_LINK=['go.canaltabarato.com.br','mercadolivre.com.br','mercadolivre.com','meli.la','amazon.com.br','amzn.to'];
const MOTIVOS=new Set(['alvo','menor_preco','abaixo_media']);

function limite(env,nome,padrao) {
  const valor=Number.parseInt(env?.[nome]||'',10);
  return Number.isInteger(valor)&&valor>0?valor:padrao;
}
export const maxPorPessoa=env=>limite(env,'ALERTA_MAX_PRODUTOS_POR_PESSOA',5);
export const maxTotal=env=>limite(env,'ALERTA_MAX_PRODUTOS_TOTAL',300);
export const diasValidade=env=>limite(env,'ALERTA_DIAS_VALIDADE',90);

// "199,90", "R$ 1.299,90", "199.90" -> número; vazio ou inválido -> null.
export function parsePrice(valor='') {
  let texto=String(valor).replace(/r\$|\s/gi,'');
  if(!texto) return null;
  if(texto.includes(',')) texto=texto.replace(/\./g,'').replace(',','.');
  else if(/^\d{1,3}(\.\d{3})+$/.test(texto)) texto=texto.replace(/\./g,'');
  if(!/^\d+(\.\d{1,2})?$/.test(texto)) return null;
  const numero=Number(texto);
  return numero>0&&numero<1_000_000?Math.round(numero*100)/100:null;
}

export function parsePriceRequest(texto='') {
  const link=String(texto).match(/https?:\/\/\S+/i);
  if(!link) return null;
  const resto=String(texto).replace(link[0],' ').trim();
  return {link:link[0],alvo:resto?parsePrice(resto):null,precoInvalido:Boolean(resto)&&parsePrice(resto)===null};
}

function urlPermitida(valor) {
  try {
    const url=new URL(String(valor||''));
    const host=url.hostname.toLowerCase();
    return url.protocol==='https:'&&HOSTS_LINK.some(h=>host===h||host.endsWith(`.${h}`))?url.toString():null;
  } catch { return null; }
}

function silencioso(now) {
  const hora=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',hour:'2-digit',hourCycle:'h23'}).format(new Date(now*1000)));
  return hora>=23||hora<7;
}

async function enviar(env,chatId,texto,botao,now,fetcher) {
  const corpo={chat_id:chatId,text:texto,parse_mode:'HTML',disable_web_page_preview:true,disable_notification:silencioso(now)};
  if(botao) corpo.reply_markup={inline_keyboard:[[botao]]};
  const resposta=await fetcher(`${TELEGRAM_API}/bot${env.TELEGRAM_ALERTS_BOT_TOKEN}/sendMessage`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(corpo),
  });
  return resposta.status;
}

export function deleteStatements(env,chatId) {
  return [env.DB.prepare('DELETE FROM alerta_precos WHERE chat_id=?').bind(chatId)];
}

export async function handlePriceAlert(env,chatId,texto,now=Math.floor(Date.now()/1000),fetcher=fetch) {
  const pedido=parsePriceRequest(texto);
  if(!pedido) return null;
  if(pedido.precoInvalido) return 'Não entendi o preço. Mande o link e o valor assim: <code>https://… 199,90</code>';
  const produto=await resolveProductLink(pedido.link,fetcher);
  if(produto?.erro==='perfil_afiliado') return 'Esse link abre a página de perfil de afiliado do Mercado Livre, não a do produto, e nele não dá para saber qual é o produto. Abra o produto e copie o link da barra de endereços (ele tem /p/MLB… ou MLB-…).';
  if(!produto) return 'Não reconheci esse produto. Mande o link da página do produto no Mercado Livre.';
  if(produto.loja!=='mercadolivre'){
    return 'Por enquanto os alertas de preço funcionam só com produtos do <b>Mercado Livre</b>. A Amazon entra em breve.';
  }
  const existente=await env.DB.prepare('SELECT id,nome FROM monitor_produtos WHERE loja=? AND id_produto=?')
    .bind(produto.loja,produto.id_produto).first();
  const meus=await env.DB.prepare('SELECT COUNT(*) AS total FROM alerta_precos WHERE chat_id=? AND ativo=1 AND expira_em>? AND produto_id<>?')
    .bind(chatId,now,existente?.id||0).first();
  if(Number(meus?.total||0)>=maxPorPessoa(env)){
    return `Você já tem ${maxPorPessoa(env)} produtos com alerta. Veja em /meusalertas e apague um com /remover <número>.`;
  }
  if(!existente){
    const total=await env.DB.prepare('SELECT COUNT(DISTINCT produto_id) AS total FROM alerta_precos WHERE ativo=1 AND expira_em>?').bind(now).first();
    if(Number(total?.total||0)>=maxTotal(env)) return 'Os alertas de preço estão lotados no momento. Tente de novo em alguns dias.';
  }
  const linha=existente||await env.DB.prepare(
    `INSERT INTO monitor_produtos(loja,id_produto,tipo,ativo,canal,criado_em) VALUES(?,?,?,1,0,?)
     ON CONFLICT(loja,id_produto) DO UPDATE SET tipo=COALESCE(monitor_produtos.tipo,excluded.tipo) RETURNING id,nome`,
  ).bind(produto.loja,produto.id_produto,produto.tipo,now).first();
  await env.DB.prepare(
    `INSERT INTO alerta_precos(chat_id,produto_id,preco_alvo,ativo,criado_em,expira_em) VALUES(?,?,?,1,?,?)
     ON CONFLICT(chat_id,produto_id) DO UPDATE SET preco_alvo=excluded.preco_alvo,ativo=1,criado_em=excluded.criado_em,
       expira_em=excluded.expira_em,ultimo_aviso_em=NULL,ultimo_aviso_preco=NULL`,
  ).bind(chatId,linha.id,pedido.alvo,now,now+diasValidade(env)*86400).run();
  const ultima=await env.DB.prepare('SELECT preco FROM monitor_leituras WHERE produto_id=? AND disponivel=1 AND preco>0 ORDER BY lido_em DESC LIMIT 1')
    .bind(linha.id).first();
  const nome=linha.nome?`<b>${html(String(linha.nome).slice(0,120))}</b>`:'esse produto';
  const quando=pedido.alvo?`quando chegar a <b>${html(money(pedido.alvo))}</b> ou menos`
    :'quando for o <b>menor preço real</b> (comparado com o histórico, sem desconto falso)';
  return [
    `✅ Combinado! Vou acompanhar ${nome} e aviso ${quando}.`,
    ultima?.preco?`Preço agora: ${html(money(ultima.preco))}.`:'A primeira leitura do preço sai em até 2 horas.',
    '',
    `O alerta vale por ${diasValidade(env)} dias. /meusalertas para ver todos.`,
  ].join('\n');
}

export async function listPriceAlerts(env,chatId,now=Math.floor(Date.now()/1000)) {
  const {results=[]}=await env.DB.prepare(
    `SELECT a.id,a.preco_alvo,p.nome,p.id_produto,
       (SELECT preco FROM monitor_leituras l WHERE l.produto_id=p.id AND l.disponivel=1 AND l.preco>0 ORDER BY l.lido_em DESC LIMIT 1) AS atual
     FROM alerta_precos a JOIN monitor_produtos p ON p.id=a.produto_id
     WHERE a.chat_id=? AND a.ativo=1 AND a.expira_em>? ORDER BY a.id`,
  ).bind(chatId,now).all();
  return results;
}

export function formatPriceAlertList(alertas) {
  return alertas.map((a,i)=>{
    const nome=html(String(a.nome||`Produto ${a.id_produto}`).slice(0,70));
    const atual=a.atual?`agora ${html(money(a.atual))}`:'aguardando a primeira leitura';
    const alvo=a.preco_alvo?`quero até ${html(money(a.preco_alvo))}`:'menor preço real';
    return `${i+1}. ${nome}\n   ${atual} · ${alvo}`;
  }).join('\n');
}

export async function removePriceAlert(env,chatId,numero,now=Math.floor(Date.now()/1000)) {
  const alertas=await listPriceAlerts(env,chatId,now);
  const alvo=alertas[Number(numero)-1];
  if(!alvo) return 'Não achei esse número. Veja a lista em /meusalertas.';
  await env.DB.prepare('DELETE FROM alerta_precos WHERE id=? AND chat_id=?').bind(alvo.id,chatId).run();
  return `Alerta de preço removido: ${html(String(alvo.nome||alvo.id_produto).slice(0,70))}`;
}

export function formatPriceNotice(aviso,alvo) {
  const linhas=[];
  if(aviso.motivo==='alvo') linhas.push('🔔 <b>Bateu o preço que você pediu!</b>');
  else if(aviso.motivo==='menor_preco') linhas.push(`🔔 <b>Menor preço em ${Number(aviso.dias_janela)||90} dias!</b>`);
  else linhas.push('🔔 <b>Preço bem abaixo da média!</b>');
  linhas.push('',`<b>${html(String(aviso.nome||'Produto').slice(0,160))}</b>`);
  const extra=alvo?` (você pediu até ${html(money(alvo))})`
    :aviso.media>0?` (média ${Number(aviso.dias_media)||30} dias: ${html(money(aviso.media))})`:'';
  linhas.push(`💰 <b>${html(money(aviso.preco))}</b>${extra}`);
  if(Number(aviso.abaixo)>=1) linhas.push(`📉 ${Math.round(Number(aviso.abaixo))}% abaixo da média`);
  linhas.push('');
  if(alvo) linhas.push('Este alerta foi pausado. Mande o link de novo se quiser outro aviso.');
  linhas.push('<i>Preço pode mudar a qualquer momento. Link de afiliado.</i>');
  return linhas.join('\n');
}

// Entrega os avisos decididos pela coleta. Confere de novo se o alerta ainda
// existe (a pessoa pode ter apagado entre a leitura e o aviso).
export async function deliverPriceAlerts(env,avisos,now=Math.floor(Date.now()/1000),fetcher=fetch) {
  if(!env.TELEGRAM_ALERTS_BOT_TOKEN) return 0;
  let enviados=0;
  for(const aviso of (Array.isArray(avisos)?avisos:[]).slice(0,500)){
    const alertaId=Number(aviso?.alerta_id), preco=Number(aviso?.preco);
    const link=urlPermitida(aviso?.link);
    if(!Number.isInteger(alertaId)||!(preco>0)||!link||!MOTIVOS.has(aviso?.motivo)) continue;
    const alerta=await env.DB.prepare('SELECT chat_id,preco_alvo FROM alerta_precos WHERE id=? AND produto_id=? AND ativo=1 AND expira_em>?')
      .bind(alertaId,Number(aviso.produto_id),now).first();
    if(!alerta) continue;
    if(alerta.preco_alvo&&preco>alerta.preco_alvo) continue;
    try{
      const status=await enviar(env,alerta.chat_id,formatPriceNotice({...aviso,preco},alerta.preco_alvo),{text:'🛒 Ver na loja',url:link},now,fetcher);
      if(status===403){
        await env.DB.batch([
          ...deleteStatements(env,alerta.chat_id),
          env.DB.prepare('DELETE FROM alert_subscriptions WHERE chat_id=?').bind(alerta.chat_id),
          env.DB.prepare('DELETE FROM alert_deliveries WHERE chat_id=?').bind(alerta.chat_id),
        ]);
      }else if(status>=200&&status<300){
        await env.DB.prepare('UPDATE alerta_precos SET ultimo_aviso_em=?,ultimo_aviso_preco=?,ativo=CASE WHEN preco_alvo IS NULL THEN 1 ELSE 0 END WHERE id=?')
          .bind(now,preco,alertaId).run();
        enviados++;
      }
    }catch(error){
      console.error(JSON.stringify({event:'price_alert',result:'failed',reason:String(error?.message||error).slice(0,80)}));
    }
  }
  return enviados;
}

// Avisa quem tinha alerta vencido e pausa o alerta, liberando a vaga.
export async function expirePriceAlerts(env,now=Math.floor(Date.now()/1000),fetcher=fetch) {
  const {results=[]}=await env.DB.prepare(
    `SELECT a.id,a.chat_id,p.nome,p.id_produto FROM alerta_precos a JOIN monitor_produtos p ON p.id=a.produto_id
     WHERE a.ativo=1 AND a.expira_em<=? LIMIT 50`,
  ).bind(now).all();
  for(const alerta of results){
    await env.DB.prepare('UPDATE alerta_precos SET ativo=0 WHERE id=?').bind(alerta.id).run();
    if(!env.TELEGRAM_ALERTS_BOT_TOKEN) continue;
    try{
      await enviar(env,alerta.chat_id,
        `⌛ Seu alerta de <b>${html(String(alerta.nome||alerta.id_produto).slice(0,100))}</b> venceu (${diasValidade(env)} dias).\nMande o link de novo se quiser continuar acompanhando.`,
        null,now,fetcher);
    }catch{ /* o alerta já foi pausado; o aviso é só cortesia */ }
  }
  return results.length;
}
