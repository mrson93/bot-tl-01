import {json} from '../_lib.js';
import {discoveryRows} from '../_discovery.js';
import {offerPath} from '../_site.js';

// Dados dos blocos do topo da página inicial, numa chamada só (cache de 5 min):
// "Caiu agora" (3 maiores quedas), oferta do dia (menor preço já visto com o
// maior desconto), quedas por dia na última semana e cupons ativos.
const DIA=86400, FUSO=3*3600;
const diaDe=epoch=>new Date((Number(epoch)-FUSO)*1000).toISOString().slice(0,10);

const resumo=(o,extra={})=>({id:o.id,titulo:String(o.title||'').slice(0,120),preco:Number(o.price)||0,
  loja:o.source||null,imagem:o.image_url||null,caminho:offerPath(o),...extra});

export async function dadosInicio(env,now=Math.floor(Date.now()/1000)) {
  const [quedas,menores,cupons]=await Promise.all([
    discoveryRows(env,'drops',100,now).catch(()=>[]),
    discoveryRows(env,'lows',30,now).catch(()=>[]),
    env.DB.prepare('SELECT COUNT(*) AS total FROM coupons WHERE (active_at IS NULL OR active_at<=?1) AND (expires_at IS NULL OR expires_at>?1)')
      .bind(now).first().catch(()=>null),
  ]);
  const queda=o=>Math.round((1-Number(o.price)/Number(o.previous_price))*100);
  const caiuAgora=quedas.filter(o=>Number(o.previous_price)>0).slice(0,3).map(o=>resumo(o,{queda:queda(o)}));
  const melhor=[...menores].sort((a,b)=>(Number(b.discount)||0)-(Number(a.discount)||0))[0];
  // Quedas por dia nos últimos 7 dias (o último é hoje).
  const dias=Array.from({length:7},(_,i)=>diaDe(now-(6-i)*DIA));
  const porDia=Object.fromEntries(dias.map(d=>[d,0]));
  for(const o of quedas){const d=diaDe(o.price_changed_at);if(d in porDia) porDia[d]++;}
  return {
    caiuAgora,
    ofertaDoDia:melhor?resumo(melhor,{precoOriginal:Number(melhor.original_price)||null,desconto:Math.round(Number(melhor.discount)||0),
      dias:Number(melhor.observations)||0}):null,
    quedas:{hoje:porDia[dias[6]],semana:dias.map(d=>porDia[d])},
    cupons:Number(cupons?.total)||0,
  };
}

export async function onRequestGet({env}) {
  return json(await dadosInicio(env),200,'public, max-age=300, stale-while-revalidate=600');
}
