// Mantém o bot público de alertas configurado sem precisar rodar script:
// o webhook precisa receber os toques nos botões (callback_query), e o menu de
// comandos e a descrição acompanham o que o bot faz. Usa o token e o segredo
// que já estão no site; só chama o setWebhook quando algo está diferente.
import {telegram,telegramArquivo} from './_price_alerts.js';

const TELEGRAM_API='https://api.telegram.org';
export const WEBHOOK_URL='https://canaltabarato.com.br/api/telegram-alerts';
export const ATUALIZACOES=['message','callback_query','inline_query','my_chat_member'];
export const COMANDOS=[
  {command:'start',description:'Começar'},
  {command:'buscar',description:'Buscar um produto pelo nome'},
  {command:'meusalertas',description:'Ver e ajustar meus alertas'},
  {command:'convidar',description:'Convidar amigos e ganhar vagas'},
  {command:'ajuda',description:'Ajuda'},
  {command:'parar',description:'Apagar todos os meus dados'},
];
// Menu de comandos dentro dos grupos (lista de desejos do grupo).
export const COMANDOS_GRUPO=[
  {command:'alerta',description:'Pôr um produto na lista: /alerta link'},
  {command:'lista',description:'Ver a lista do grupo'},
  {command:'buscar',description:'Buscar um produto pelo nome'},
  {command:'ajuda',description:'Como funciona no grupo'},
  {command:'parar',description:'Apagar a lista do grupo (admins)'},
];
export const DESCRICAO='Cole o link de um produto. Eu acompanho o preço e aviso quando baixar de verdade.\n\n✅ Mercado Livre, Shopee e AliExpress\n✅ Histórico e gráfico de preço\n✅ Grátis, sem cadastro';
// Foto do bot (sino com etiqueta de preço e seta para baixo); fonte em public/bot/alerta-icone.svg.
export const FOTO_URL='https://canaltabarato.com.br/bot/alerta-icone.jpg';
// Botão de menu (ao lado do campo de texto) abre o mini app.
export const MINIAPP_URL='https://canaltabarato.com.br/app/alertas';
export const BOTAO_MENU={type:'web_app',text:'📱 Meus alertas',web_app:{url:MINIAPP_URL}};
export const DESCRICAO_CURTA='Avisa quando o produto que você quer baixar de preço. Mercado Livre, Shopee e AliExpress. Grátis.';

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
  // Comandos: confere a lista publicada (muda sem precisar trocar a descrição).
  const comandos=await fetcher(`${TELEGRAM_API}/bot${env.TELEGRAM_ALERTS_BOT_TOKEN}/getMyCommands`);
  const publicados=((await comandos.json())?.result||[]).map(c=>c.command).join(',');
  if(publicados!==COMANDOS.map(c=>c.command).join(',')){
    await telegram(env,'setMyCommands',{commands:COMANDOS},fetcher);
    mudou=true;
  }
  const ESCOPO_GRUPOS={type:'all_group_chats'};
  const doGrupo=await fetcher(`${TELEGRAM_API}/bot${env.TELEGRAM_ALERTS_BOT_TOKEN}/getMyCommands`,{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:ESCOPO_GRUPOS})});
  const publicadosGrupo=((await doGrupo.json())?.result||[]).map(c=>c.command).join(',');
  if(publicadosGrupo!==COMANDOS_GRUPO.map(c=>c.command).join(',')){
    await telegram(env,'setMyCommands',{commands:COMANDOS_GRUPO,scope:ESCOPO_GRUPOS},fetcher);
    mudou=true;
  }
  const menu=await fetcher(`${TELEGRAM_API}/bot${env.TELEGRAM_ALERTS_BOT_TOKEN}/getChatMenuButton`);
  const atual=(await menu.json())?.result||{};
  if(atual.type!=='web_app'||atual.web_app?.url!==MINIAPP_URL||atual.text!==BOTAO_MENU.text){
    await telegram(env,'setChatMenuButton',{menu_button:BOTAO_MENU},fetcher);
    mudou=true;
  }
  return (await garantirPerfil(env,fetcher))||mudou;
}
