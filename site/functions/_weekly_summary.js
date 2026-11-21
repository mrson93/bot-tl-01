import {html,money} from './_site.js';
import {LOJA_DE,apagarPessoa,listPriceAlerts,telegram} from './_price_alerts.js';

// Resumo semanal do bot de alertas: toda segunda, na primeira coleta depois
// das 10h (o site não tem relógio próprio; a coleta chega a cada 2 h). Vai em
// lotes; quem ficar para depois recebe nas coletas seguintes até terça.
export const LOTE_RESUMO=50;
const FUSO=10800; // Brasília, UTC-3 (sem horário de verão)

// Segunda 10h até terça 23h59: dentro da janela devolve o início da semana (segunda 0h).
export function janelaDoResumo(now) {
  const local=new Date((now-FUSO)*1000);
  const dia=local.getUTCDay(), hora=local.getUTCHours();
  if(!((dia===1&&hora>=10)||dia===2)) return null;
  const meiaNoite=Math.floor((now-FUSO)/86400)*86400+FUSO;
  return meiaNoite-(dia-1)*86400;
}

function nomeCurto(a) {
  return html(String(a.nome||`Produto ${LOJA_DE[a.loja]||''}`.trim()).slice(0,70));
}

// Uma linha por produto com leitura na semana; null se não houver o que contar.
export function montarResumo(alertas) {
  const itens=alertas.filter(a=>Number(a.atual)>0&&Number(a.lido_em)>0);
  if(!itens.length) return null;
  let caiu=0, subiu=0, igual=0;
  const linhas=itens.map(a=>{
    const atual=Number(a.atual), antes=Number(a.antes)||0;
    let simbolo='➖', comparacao='';
    if(antes>0&&atual<antes*0.995){caiu++;simbolo='📉';comparacao=` (era ${html(money(antes))}, −${Math.round((1-atual/antes)*100)}%)`;}
    else if(antes>0&&atual>antes*1.005){subiu++;simbolo='📈';comparacao=` (era ${html(money(antes))}, +${Math.round((atual/antes-1)*100)}%)`;}
    else if(antes>0){igual++;comparacao=' (igual)';}
    else{igual++;comparacao=' (começou esta semana)';}
    const menor=Number(a.menor_semana)>0&&Number(a.menor_semana)<atual?` · menor da semana ${html(money(a.menor_semana))}`:'';
    const selo=a.termometro&&a.termometro.nivel!=='aprendendo'?` · ${a.termometro.emoji}`:'';
    return `${simbolo} <b>${nomeCurto(a)}</b>\n    ${html(money(atual))}${comparacao}${menor}${selo}`;
  });
  const partes=[];
  if(caiu) partes.push(`${caiu} caiu${caiu>1?'ram':''}`);
  if(subiu) partes.push(`${subiu} subi${subiu>1?'ram':'u'}`);
  if(igual) partes.push(`${igual} sem mudança`);
  return ['📊 <b>Seu resumo da semana</b>',partes.join(' · '),'',...linhas,'',
    '🟢 preço baixo · 🟡 na média · 🔴 alto, comparando com o último ano.'].join('\n');
}

async function dadosDaPessoa(env,chatId,now) {
  const alertas=await listPriceAlerts(env,chatId,now);
  if(!alertas.length) return [];
  const {results=[]}=await env.DB.prepare(
    `SELECT a.id,
       (SELECT MAX(lido_em) FROM monitor_leituras WHERE produto_id=a.produto_id AND lido_em>=?2) AS lido_em,
       (SELECT preco FROM monitor_leituras WHERE produto_id=a.produto_id AND disponivel=1 AND preco>0 AND lido_em<=?2
          ORDER BY lido_em DESC LIMIT 1) AS antes,
       (SELECT MIN(preco) FROM monitor_leituras WHERE produto_id=a.produto_id AND disponivel=1 AND preco>0 AND lido_em>?2) AS menor_semana
     FROM alerta_precos a WHERE a.chat_id=?1 AND a.ativo=1 AND a.expira_em>?3`,
  ).bind(chatId,now-7*86400,now).all();
  const extra=new Map(results.map(r=>[Number(r.id),r]));
  return alertas.map(a=>({...a,...(extra.get(Number(a.id))||{})}));
}

export async function enviarResumos(env,now=Math.floor(Date.now()/1000),fetcher=fetch) {
  const inicio=janelaDoResumo(now);
  if(inicio===null||!env.TELEGRAM_ALERTS_BOT_TOKEN) return 0;
  const {results:pessoas=[]}=await env.DB.prepare(
    `SELECT DISTINCT a.chat_id FROM alerta_precos a LEFT JOIN alerta_pessoas p ON p.chat_id=a.chat_id
     WHERE a.ativo=1 AND a.expira_em>? AND a.chat_id NOT LIKE '-%' AND COALESCE(p.resumo_semanal,1)=1 AND COALESCE(p.resumo_enviado_em,0)<? LIMIT ?`,
  ).bind(now,inicio,LOTE_RESUMO).all();
  let enviados=0;
  for(const {chat_id:chatId} of pessoas){
    // Marca antes de enviar: se algo falhar, a pessoa não recebe duas vezes.
    await env.DB.prepare(`INSERT INTO alerta_pessoas(chat_id,resumo_enviado_em) VALUES(?,?)
      ON CONFLICT(chat_id) DO UPDATE SET resumo_enviado_em=excluded.resumo_enviado_em`).bind(chatId,now).run();
    try{
      const texto=montarResumo(await dadosDaPessoa(env,chatId,now));
      if(!texto) continue;
      const status=await telegram(env,'sendMessage',{chat_id:chatId,text:texto,parse_mode:'HTML',disable_notification:false,
        reply_markup:{inline_keyboard:[[{text:'📋 Meus alertas',callback_data:'l'},{text:'🔕 Desligar resumo',callback_data:'rs:0'}]]}},fetcher);
      if(status===403) await apagarPessoa(env,chatId);
      else if(status>=200&&status<300) enviados++;
    }catch(error){
      console.error(JSON.stringify({event:'resumo_semanal',result:'failed',reason:String(error?.message||error).slice(0,80)}));
    }
  }
  return enviados;
}
