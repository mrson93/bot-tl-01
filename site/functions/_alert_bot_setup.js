// Mantém o bot público de alertas configurado sem precisar rodar script:
// o webhook precisa receber os toques nos botões (callback_query), e o menu de
// comandos e a descrição acompanham o que o bot faz. Usa o token e o segredo
// que já estão no site; só chama o setWebhook quando algo está diferente.
import {telegram} from './_price_alerts.js';

const TELEGRAM_API='https://api.telegram.org';
export const WEBHOOK_URL='https://canaltabarato.com.br/api/telegram-alerts';
export const ATUALIZACOES=['message','callback_query'];
export const COMANDOS=[
  {command:'start',description:'Como funciona e menu'},
  {command:'meusalertas',description:'Ver e ajustar meus alertas'},
  {command:'ajuda',description:'Ajuda'},
  {command:'parar',description:'Apagar todos os meus dados'},
];
export const DESCRICAO='Cole o link de um produto do Mercado Livre ou da Shopee e eu aviso no seu privado quando o preço baixar de verdade: menor preço do histórico, o valor que você escolher, queda de % ou volta ao estoque. Grátis, por até 1 ano. /parar apaga seus dados.';
export const DESCRICAO_CURTA='Alerta de preço grátis: aviso quando o produto que você quer baixar de verdade.';

export async function garantirConfiguracao(env,fetcher=fetch) {
  if(!env.TELEGRAM_ALERTS_BOT_TOKEN||!env.TELEGRAM_ALERTS_WEBHOOK_SECRET) return false;
  const resposta=await fetcher(`${TELEGRAM_API}/bot${env.TELEGRAM_ALERTS_BOT_TOKEN}/getWebhookInfo`);
  const info=(await resposta.json())?.result||{};
  const atuais=info.allowed_updates||[];
  if(info.url===WEBHOOK_URL&&ATUALIZACOES.every(t=>atuais.includes(t))) return false;
  await telegram(env,'setWebhook',{url:WEBHOOK_URL,secret_token:env.TELEGRAM_ALERTS_WEBHOOK_SECRET,
    allowed_updates:ATUALIZACOES,drop_pending_updates:false},fetcher);
  await telegram(env,'setMyCommands',{commands:COMANDOS},fetcher);
  await telegram(env,'setMyDescription',{description:DESCRICAO},fetcher);
  await telegram(env,'setMyShortDescription',{short_description:DESCRICAO_CURTA},fetcher);
  return true;
}
