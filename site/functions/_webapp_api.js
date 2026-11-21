import {json,readJsonLimited} from './_lib.js';
import {validarInitData} from './_webapp_auth.js';
import {PRAZOS,QUEDAS,definirValor,handleCallback,historico,lerAlerta,listPriceAlerts,parsePrice,resumoLigado,urlPermitida} from './_price_alerts.js';

// API do mini app (/app/alertas). Toda chamada leva o initData no cabeçalho
// X-Telegram-Init-Data; os ajustes reaproveitam os mesmos caminhos dos botões
// do cartão, então as regras (limites, prazos, apagar) são as mesmas.
const LOJA={mercadolivre:'Mercado Livre',shopee:'Shopee',aliexpress:'AliExpress',amazon:'Amazon'};

export async function pessoa(request,env,now=Math.floor(Date.now()/1000)) {
  return validarInitData(request.headers.get('X-Telegram-Init-Data')||'',env.TELEGRAM_ALERTS_BOT_TOKEN,now);
}

export async function detalhe(env,chatId,id,now) {
  const a=await lerAlerta(env,chatId,id);
  if(!a) return null;
  const h=await historico(env,a.produto_id,now);
  const cupomValido=a.cupom_codigo&&(!a.cupom_expira_em||Number(a.cupom_expira_em)>now);
  return {
    id:a.id,nome:a.nome||null,loja:a.loja,lojaNome:LOJA[a.loja]||a.loja,
    atual:Number(h.atual)||null,disponivel:h.disponivel!==0,minimo:Number(h.minimo)||null,maximo:Number(h.maximo)||null,
    desde:Number(h.desde)||null,termometro:h.termometro||null,precoMax:Number(a.preco_max)||null,
    cupom:cupomValido?{codigo:a.cupom_codigo,condicao:a.cupom_condicao||null,expiraEm:Number(a.cupom_expira_em)||null}:null,
    avisos:{menor:Boolean(a.avisar_menor),valor:Number(a.preco_alvo)||null,queda:Number(a.queda_percent)||null,estoque:Boolean(a.avisar_estoque)},
    podeEstoque:a.loja==='mercadolivre',ativo:Boolean(a.ativo),expiraEm:Number(a.expira_em)||null,
    link:urlPermitida(a.link_afiliado),
  };
}

export async function lista(env,chatId,now) {
  const alertas=await listPriceAlerts(env,chatId,now);
  return {resumo:await resumoLigado(env,chatId),alertas:alertas.map(a=>({
    id:a.id,nome:a.nome||null,loja:a.loja,lojaNome:LOJA[a.loja]||a.loja,atual:Number(a.atual)||null,
    termometro:a.termometro||null,
    avisos:{menor:Boolean(a.avisar_menor),valor:Number(a.preco_alvo)||null,queda:Number(a.queda_percent)||null,estoque:Boolean(a.avisar_estoque)},
  }))};
}

// Ação pedida -> mesmo caminho do botão. "ligado" diz o estado desejado (toque
// duplo não inverte de novo).
export async function ajustar(env,chatId,pedido,now) {
  const id=Number(pedido?.id);
  if(pedido?.acao==='resumo') return handleCallback(env,chatId,`rs:${pedido.ligado?1:0}`,now).then(()=>({ok:true}));
  if(!Number.isInteger(id)||id<=0) return {erro:'alerta_invalido'};
  const a=await lerAlerta(env,chatId,id);
  if(!a) return {erro:'alerta_nao_existe'};
  const botao=sufixo=>handleCallback(env,chatId,`a:${id}:${sufixo}`,now);
  switch(pedido.acao){
    case 'menor': if(Boolean(a.avisar_menor)!==Boolean(pedido.ligado)) await botao('m'); break;
    case 'estoque':
      if(a.loja!=='mercadolivre') return {erro:'sem_estoque'};
      if(Boolean(a.avisar_estoque)!==Boolean(pedido.ligado)) await botao('e');
      break;
    case 'queda':{
      const p=Number(pedido.valor)||0;
      if(p&&!QUEDAS.includes(p)) return {erro:'queda_invalida'};
      await botao(`q:${p}`); break;
    }
    case 'prazo':{
      const d=Number(pedido.valor);
      if(!PRAZOS.some(([dias])=>dias===d)) return {erro:'prazo_invalido'};
      await botao(`p:${d}`); break;
    }
    case 'valor':{
      if(pedido.valor===null||pedido.valor===''){ await definirValor(env,chatId,id,null,now); break; }
      const alvo=parsePrice(String(pedido.valor));
      if(!alvo) return {erro:'valor_invalido'};
      await definirValor(env,chatId,id,alvo,now); break;
    }
    case 'apagar': await botao('xx'); return {ok:true,apagado:true};
    default: return {erro:'acao_invalida'};
  }
  return {ok:true,alerta:await detalhe(env,chatId,id,now)};
}

export async function onAlertas(request,env,now=Math.floor(Date.now()/1000)) {
  const quem=await pessoa(request,env,now);
  if(!quem) return json({erro:'nao_autorizado'},401);
  if(request.method==='GET'){
    const id=new URL(request.url).searchParams.get('id');
    if(!id) return json(await lista(env,quem.chatId,now));
    const d=await detalhe(env,quem.chatId,id,now);
    return d?json({alerta:d}):json({erro:'alerta_nao_existe'},404);
  }
  if(request.method==='POST'){
    let pedido;
    try{ pedido=await readJsonLimited(request,4096); }catch{ return json({erro:'json_invalido'},400); }
    const r=await ajustar(env,quem.chatId,pedido,now);
    return json(r,r.erro?400:200);
  }
  return json({erro:'metodo'},405);
}

export async function onGrafico(request,env,now=Math.floor(Date.now()/1000)) {
  const quem=await pessoa(request,env,now);
  if(!quem) return json({erro:'nao_autorizado'},401);
  const url=new URL(request.url);
  const id=Number(url.searchParams.get('id')), dias=Number(url.searchParams.get('dias'))||90;
  if(!Number.isInteger(id)||id<=0) return json({erro:'alerta_invalido'},400);
  const r=await handleCallback(env,quem.chatId,`a:${id}:gt:${[30,90,365].includes(dias)?dias:90}`,now);
  if(!r?.photo?.png) return json({erro:'pouco_historico'},404);
  return new Response(r.photo.png,{headers:{'Content-Type':'image/png','Cache-Control':'private, max-age=600'}});
}
