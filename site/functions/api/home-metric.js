import {claimPublicAction} from '../_abuse.js';
import {json,readJsonLimited} from '../_lib.js';

// Cliques nos blocos da página inicial, para saber o que vale manter no layout.
// Só uma contagem por dia e bloco; a mesma pessoa conta uma vez por minuto.
export const BLOCOS=new Set(['caiu-agora','oferta-dia','alertas','precos','cupons','menor-preco','categoria','busca','black-friday','loja']);
const diaEmSaoPaulo=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

export async function onRequestPost({request,env}) {
  if(!String(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json')) return json({erro:'tipo'},415);
  let dados;
  try{ dados=await readJsonLimited(request,512); }catch{ return json({erro:'json'},400); }
  const bloco=String(dados?.bloco||'');
  if(!BLOCOS.has(bloco)) return json({erro:'bloco'},400);
  const claim=await claimPublicAction({env,request,purpose:'home-click',resource:bloco,windowSeconds:60,limiter:env.METRICS_RATE_LIMITER});
  if(claim.reason==='rate_limited') return json({erro:'limite'},429);
  if(!claim.accepted) return json({ok:true,contado:false},202);
  await env.DB.prepare(`INSERT INTO home_clicks_daily(observed_on,block,quantity) VALUES(?,?,1)
    ON CONFLICT(observed_on,block) DO UPDATE SET quantity=quantity+1`).bind(diaEmSaoPaulo(),bloco).run();
  return json({ok:true},202);
}
