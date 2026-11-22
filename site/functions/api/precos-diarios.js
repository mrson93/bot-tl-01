import {authorized,json} from '../_lib.js';
import {atualizarShopeeDoDia} from '../_daily_prices.js';

// Chamado pelo painel (Worker telegram-control) a cada 15 min, com o segredo
// PRECOS_DIARIOS_TOKEN (o mesmo valor guardado nos dois lados).
export async function onRequestPost({request,env}) {
  if(!env.PRECOS_DIARIOS_TOKEN||!await authorized(request,env.PRECOS_DIARIOS_TOKEN)) return json({erro:'nao_autorizado'},401);
  return json(await atualizarShopeeDoDia(env));
}
