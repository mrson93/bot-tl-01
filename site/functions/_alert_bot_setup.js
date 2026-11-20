// Mantém o bot público de alertas configurado sem precisar rodar script:
// o webhook precisa receber os toques nos botões (callback_query), e o menu de
// comandos e a descrição acompanham o que o bot faz. Usa o token e o segredo
// que já estão no site; só chama o setWebhook quando algo está diferente.
import {telegram,telegramArquivo} from './_price_alerts.js';

const TELEGRAM_API='https://api.telegram.org';
export const WEBHOOK_URL='https://canaltabarato.com.br/api/telegram-alerts';
export const ATUALIZACOES=['message','callback_query'];
export const COMANDOS=[
  {command:'start',description:'Como funciona e menu'},
  {command:'buscar',description:'Buscar um produto pelo nome'},
  {command:'meusalertas',description:'Ver e ajustar meus alertas'},
  {command:'ajuda',description:'Ajuda'},
  {command:'parar',description:'Apagar todos os meus dados'},
];
export const DESCRICAO='Cole o link de um produto do Mercado Livre, da Shopee ou do AliExpress (ou busque pelo nome) e eu aviso no seu privado quando o preço baixar de verdade: menor preço do histórico, o valor que você escolher ou queda de %. Gráfico de preço e termômetro de compra. Grátis, por até 1 ano. /parar apaga seus dados.';
// Foto do bot (sino com etiqueta de preço e seta para baixo); fonte em public/bot/alerta-icone.svg.
export const FOTO_URL='https://canaltabarato.com.br/bot/alerta-icone.jpg';
export const DESCRICAO_CURTA='Alerta de preço grátis: aviso quando o produto que você quer baixar de verdade.';

// Perfil (comandos, descrições e foto): atualiza só quando a descrição publicada
// é diferente da daqui, ou seja, uma vez a cada versão nova do texto.
async function garantirPerfil(env,fetcher) {
  const resposta=await fetcher(`${TELEGRAM_API}/bot${env.TELEGRAM_ALERTS_BOT_TOKEN}/getMyDescription`);
  const atual=(await resposta.json())?.result?.description;
  if(atual===DESCRICAO) return false;
  await telegram(env,'setMyCommands',{commands:COMANDOS},fetcher);
  await telegram(env,'setMyShortDescription',{short_description:DESCRICAO_CURTA},fetcher);
  const foto=await fetcher(FOTO_URL);
  if(!foto.ok) return false;
  const status=await telegramArquivo(env,'setMyProfilePhoto',{photo:{type:'static',photo:'attach://foto'}},
    {campo:'foto',bytes:new Uint8Array(await foto.arrayBuffer()),nome:'alerta-icone.jpg',tipo:'image/jpeg'},fetcher);
  if(!(status>=200&&status<300)){
    console.error(JSON.stringify({event:'bot_foto',result:'failed',status}));
    return false;
  }
  // Por último: se algo acima falhar, a próxima coleta tenta de novo.
  await telegram(env,'setMyDescription',{description:DESCRICAO},fetcher);
  return true;
}

export async function garantirConfiguracao(env,fetcher=fetch) {
  if(!env.TELEGRAM_ALERTS_BOT_TOKEN||!env.TELEGRAM_ALERTS_WEBHOOK_SECRET) return false;
  const resposta=await fetcher(`${TELEGRAM_API}/bot${env.TELEGRAM_ALERTS_BOT_TOKEN}/getWebhookInfo`);
  const info=(await resposta.json())?.result||{};
  const atuais=info.allowed_updates||[];
  let mudou=false;
  if(info.url!==WEBHOOK_URL||!ATUALIZACOES.every(t=>atuais.includes(t))){
    await telegram(env,'setWebhook',{url:WEBHOOK_URL,secret_token:env.TELEGRAM_ALERTS_WEBHOOK_SECRET,
      allowed_updates:ATUALIZACOES,drop_pending_updates:false},fetcher);
    mudou=true;
  }
  return (await garantirPerfil(env,fetcher))||mudou;
}
