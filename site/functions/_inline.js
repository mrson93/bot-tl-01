import {html,money} from './_site.js';
import {HOSTS_IMAGEM,urlPermitida} from './_price_alerts.js';
import {buscarProdutos,termoBusca} from './_product_search.js';

// Modo inline: em qualquer conversa, "@TaBaratoAlertaDePrecoBot fone" mostra
// até 5 produtos (catálogo do site + Shopee ao vivo) para mandar no chat, com
// botões "Ver na loja" e "Criar alerta". Não guarda nada de quem pesquisa.
const BOT_PADRAO='TaBaratoAlertaDePrecoBot';
const PREFIXO={mercadolivre:'ml',shopee:'sp',aliexpress:'ae'};
const LOJA={mercadolivre:'Mercado Livre',shopee:'Shopee',aliexpress:'AliExpress'};
const HOSTS_LOJA=['canaltabarato.com.br','shopee.com.br','mercadolivre.com.br','aliexpress.com'];

export function usuarioDoBot(env) {
  const nome=String(env?.TELEGRAM_ALERTS_BOT_USERNAME||'');
  return /^[A-Za-z0-9_]{5,32}$/.test(nome)?nome:BOT_PADRAO;
}

function resultado(item,i,bot) {
  const linkAlerta=`https://t.me/${bot}?start=${PREFIXO[item.loja]}_${item.id_produto}`;
  const linkLoja=urlPermitida(item.link,HOSTS_LOJA);
  const selo=item.termometro&&item.termometro.nivel!=='aprendendo'?`${item.termometro.emoji} ${item.termometro.texto}`:'';
  const texto=[`🛍 <b>${html(item.nome||'Produto')}</b>`,`💰 ${html(money(item.preco))} · ${LOJA[item.loja]}`,
    ...(item.dias?[`📈 Preço acompanhado há ${item.dias} dia(s)`]:[]),...(selo?[selo]:[]),'',
    `🔔 Quer saber quando baixar? Crie um alerta grátis no @${bot}.`,'<i>Preço pode mudar. Link de afiliado.</i>'].join('\n');
  const foto=urlPermitida(item.imagem,HOSTS_IMAGEM);
  return {
    type:'article',id:`${PREFIXO[item.loja]}_${item.id_produto}`.slice(0,64),
    title:String(item.nome||'Produto').slice(0,100),
    description:`${money(item.preco)} · ${LOJA[item.loja]}${selo?` · ${selo.split(':')[0]}`:''}`,
    ...(foto?{thumbnail_url:foto}:{}),
    input_message_content:{message_text:texto,parse_mode:'HTML',link_preview_options:{is_disabled:true}},
    reply_markup:{inline_keyboard:[...(linkLoja?[[{text:'🛒 Ver na loja',url:linkLoja}]]:[]),[{text:'🔔 Criar alerta de preço',url:linkAlerta}]]},
  };
}

// Corpo do answerInlineQuery (sem o callback_query_id).
export async function respostaInline(env,consulta,now=Math.floor(Date.now()/1000),fetcher=fetch) {
  const bot=usuarioDoBot(env);
  const botao={text:'🔔 Criar alerta de preço no bot',start_parameter:'inline'};
  const termo=termoBusca(String(consulta||'').slice(0,64));
  if(!termo||termo.length<3) return {results:[],cache_time:300,is_personal:false,button:botao};
  const itens=await buscarProdutos(env,termo,fetcher,now);
  return {results:itens.map((item,i)=>resultado(item,i,bot)),cache_time:300,is_personal:false,button:botao};
}
