import {telegram} from './_price_alerts.js';

// Indicação: link próprio (?start=r_<código>); o amigo conta quando cria o
// primeiro alerta de produto, e quem indicou ganha vagas (padrão +5, até 30).
// O código é aleatório: não revela o chat de ninguém.
const BOT_PADRAO='TaBaratoAlertaDePrecoBot';
const LETRAS='abcdefghjkmnpqrstuvwxyz23456789'; // sem 0/o, 1/l/i
const numero=(env,nome,padrao)=>{const v=Number.parseInt(env?.[nome]||'',10);return Number.isInteger(v)&&v>0?v:padrao;};
export const base=env=>numero(env,'ALERTA_MAX_PRODUTOS_POR_PESSOA',10);
export const bonusPorAmigo=env=>numero(env,'ALERTA_BONUS_POR_AMIGO',5);
export const maxComBonus=env=>Math.max(base(env),numero(env,'ALERTA_MAX_COM_BONUS',30));

function bot(env) {
  const nome=String(env?.TELEGRAM_ALERTS_BOT_USERNAME||'');
  return /^[A-Za-z0-9_]{5,32}$/.test(nome)?nome:BOT_PADRAO;
}

export function novoCodigo() {
  const bytes=crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map(b=>LETRAS[b%LETRAS.length]).join('');
}

export async function amigosQueContam(env,chatId) {
  const r=await env.DB.prepare('SELECT COUNT(*) AS total FROM alerta_pessoas WHERE indicado_por=? AND indicacao_contada_em IS NOT NULL')
    .bind(String(chatId)).first();
  return Number(r?.total||0);
}

export async function limitePessoa(env,chatId) {
  const amigos=await amigosQueContam(env,chatId);
  return Math.min(maxComBonus(env),base(env)+amigos*bonusPorAmigo(env));
}

export async function codigoDe(env,chatId) {
  const atual=await env.DB.prepare('SELECT codigo FROM alerta_pessoas WHERE chat_id=?').bind(String(chatId)).first();
  if(atual?.codigo) return atual.codigo;
  for(let tentativa=0;tentativa<3;tentativa++){
    const codigo=novoCodigo();
    try{
      await env.DB.prepare(`INSERT INTO alerta_pessoas(chat_id,codigo) VALUES(?,?)
        ON CONFLICT(chat_id) DO UPDATE SET codigo=COALESCE(alerta_pessoas.codigo,excluded.codigo)`).bind(String(chatId),codigo).run();
      const salvo=await env.DB.prepare('SELECT codigo FROM alerta_pessoas WHERE chat_id=?').bind(String(chatId)).first();
      if(salvo?.codigo) return salvo.codigo;
    }catch{ /* código repetido (índice único): tenta outro */ }
  }
  return null;
}

// /start r_<código>: só marca quem é novo (nunca teve alerta de produto).
export async function registrarIndicacao(env,chatId,codigo) {
  if(!/^[a-z0-9]{8}$/.test(String(codigo||''))) return false;
  const quem=await env.DB.prepare('SELECT chat_id FROM alerta_pessoas WHERE codigo=?').bind(codigo).first();
  if(!quem?.chat_id||String(quem.chat_id)===String(chatId)) return false;
  const jaTeve=await env.DB.prepare('SELECT 1 AS sim FROM alerta_precos WHERE chat_id=? LIMIT 1').bind(String(chatId)).first();
  if(jaTeve) return false;
  await env.DB.prepare(`INSERT INTO alerta_pessoas(chat_id,indicado_por) VALUES(?,?)
    ON CONFLICT(chat_id) DO UPDATE SET indicado_por=COALESCE(alerta_pessoas.indicado_por,excluded.indicado_por)`)
    .bind(String(chatId),String(quem.chat_id)).run();
  return true;
}

// Depois de criar um alerta: se a pessoa veio por indicação e ainda não
// contou, conta agora (uma vez) e avisa quem indicou, sem dizer quem foi.
export async function contarIndicacao(env,chatId,now=Math.floor(Date.now()/1000),fetcher=fetch) {
  const linha=await env.DB.prepare(`UPDATE alerta_pessoas SET indicacao_contada_em=?
    WHERE chat_id=? AND indicado_por IS NOT NULL AND indicacao_contada_em IS NULL RETURNING indicado_por`)
    .bind(now,String(chatId)).first();
  const quem=linha?.indicado_por;
  if(!quem) return null;
  const amigos=await amigosQueContam(env,quem);
  const limite=Math.min(maxComBonus(env),base(env)+amigos*bonusPorAmigo(env));
  const ganhou=base(env)+(amigos-1)*bonusPorAmigo(env)<maxComBonus(env);
  const texto=ganhou
    ?`🎉 Um amigo criou o primeiro alerta pelo seu convite: <b>+${bonusPorAmigo(env)} vagas</b>. Agora você pode acompanhar até <b>${limite} produtos</b>.`
    :`🎉 Mais um amigo criou o primeiro alerta pelo seu convite. Obrigado! Você já está no máximo de ${limite} produtos.`;
  if(env.TELEGRAM_ALERTS_BOT_TOKEN){
    try{ await telegram(env,'sendMessage',{chat_id:quem,text:texto,parse_mode:'HTML'},fetcher); }catch{ /* aviso é cortesia */ }
  }
  return {quem,amigos,limite};
}

export async function mensagemConvite(env,chatId) {
  const codigo=await codigoDe(env,chatId);
  if(!codigo) return {text:'Não consegui criar seu link agora. Tente de novo em instantes.'};
  const link=`https://t.me/${bot(env)}?start=r_${codigo}`;
  const amigos=await amigosQueContam(env,chatId);
  const limite=Math.min(maxComBonus(env),base(env)+amigos*bonusPorAmigo(env));
  const convite='Uso este bot grátis para ser avisado quando o preço de um produto baixar de verdade. Entra pelo meu link:';
  const compartilhar=`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(convite)}`;
  const andamento=limite>=maxComBonus(env)
    ?`✅ ${amigos} amigo(s) · você já tem o máximo: <b>${limite} produtos</b>.`
    :`📈 ${amigos} amigo(s) até agora · seu limite: <b>${limite} de ${maxComBonus(env)} produtos</b>.`;
  return {text:['🎁 <b>Convide amigos e ganhe vagas</b>','',
    `Cada amigo que entrar pelo seu link e criar o primeiro alerta vale <b>+${bonusPorAmigo(env)} produtos</b> para você (até ${maxComBonus(env)}).`,'',
    andamento,'',`Seu link: ${link}`].join('\n'),
  markup:{inline_keyboard:[[{text:'📤 Compartilhar convite',url:compartilhar}]]}};
}
