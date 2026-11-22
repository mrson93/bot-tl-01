import {SITE,head,html,responseHead,responseHtml} from './_site.js';

// Porta de entrada única (link das bios): o que o Tá Barato faz, em quatro
// escolhas. Sem menu nem rodapé longo: quem chega de uma rede social decide
// em poucos segundos para onde ir.
const BOT_PADRAO='TaBaratoAlertaDePrecoBot';

export function caminhos(bot=BOT_PADRAO) {
  return [
    {icone:'🔥',titulo:'Receber ofertas',texto:'O que está barato agora, conferido.',href:'https://t.me/CanalTaBarato',acao:'Canal no Telegram',externo:true},
    {icone:'🔔',titulo:'Avisar quando baixar',texto:'Escolha o produto. A gente avisa quando baixar.',href:`https://t.me/${bot}?start=comecar`,acao:'Bot de alertas',externo:true},
    {icone:'📈',titulo:'Ver se o preço é bom',texto:'Histórico de preço antes de você comprar.',href:'/quedas-de-preco',acao:'Ver no site'},
    {icone:'🎟',titulo:'Cupons de hoje',texto:'Cupons oficiais das lojas, com prazo.',href:'/cupons',acao:'Ver cupons'},
  ];
}

export const REDES=[
  ['Instagram','https://www.instagram.com/ofertascanaltabarato/'],
  ['Facebook','https://www.facebook.com/canaltabarato'],
  ['X','https://x.com/canaltabarato'],
  ['Bluesky','https://bsky.app/profile/canaltabarato.com.br'],
];

export function paginaComecar(bot=BOT_PADRAO) {
  const title='Comece aqui | Tá Barato';
  const description='Ofertas reais das lojas que você já usa. Receba ofertas, crie alertas de preço, veja o histórico e pegue cupons. Grátis.';
  const itens=caminhos(bot).map(c=>`<a class="start-card" href="${html(c.href)}"${c.externo?' target="_blank" rel="noopener noreferrer"':''}><span class="start-icon" aria-hidden="true">${c.icone}</span><span class="start-text"><strong>${html(c.titulo)}</strong><span>${html(c.texto)}</span></span><span class="start-go">${html(c.acao)} →</span></a>`).join('');
  const redes=REDES.map(([nome,url])=>`<a href="${html(url)}" target="_blank" rel="noopener noreferrer">${html(nome)}</a>`).join('');
  return responseHtml(`<!doctype html><html lang="pt-BR"><head>${head({title,description,canonical:`${SITE}/comecar`})}</head><body class="start-body"><main class="start-page">
<a class="brand start-brand" href="/" aria-label="Tá Barato — início"><img class="brand-mark" src="https://t.me/i/userpic/320/CanalTaBarato.jpg" alt=""><span>TÁ <strong>BARATO</strong></span></a>
<h1>Ofertas reais das lojas que você já usa.</h1>
<p class="start-lead">A gente confere o preço. Você só compra.</p>
<nav class="start-list" aria-label="Por onde começar">${itens}</nav>
<p class="start-stores">Mercado Livre · Shopee · Amazon · AliExpress</p>
<nav class="start-social" aria-label="Redes sociais">${redes}</nav>
<p class="start-note">Grátis. Links oficiais das lojas. Podemos ganhar comissão, sem custo para você.</p>
</main></body></html>`,200,'public, max-age=3600, stale-while-revalidate=86400');
}

export function onRequestGet({env}) {
  const bot=/^[A-Za-z0-9_]{5,32}$/.test(String(env?.TELEGRAM_ALERTS_BOT_USERNAME||''))?env.TELEGRAM_ALERTS_BOT_USERNAME:BOT_PADRAO;
  return paginaComecar(bot);
}

export function onRequestHead(context) {
  return responseHead(onRequestGet(context));
}
