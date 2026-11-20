import {json} from '../_lib.js';
import {quedasDeHoje} from '../_price_drops.js';

// Mesmos dados da página /quedas-de-hoje, para o post diário do canal (Python).
export async function onRequestGet({request,env}) {
  const limite=Number(new URL(request.url).searchParams.get('limite'))||10;
  const itens=await quedasDeHoje(env,Math.floor(Date.now()/1000),limite);
  return json({quedas:itens.map(({termometro:t,...item})=>({...item,termometro:t?{nivel:t.nivel,emoji:t.emoji}:null}))},200,'public, max-age=300');
}
