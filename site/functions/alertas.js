import {SITE,footer,head,header,html,responseHead,responseHtml} from './_site.js';

// Pilar "Alertas": o que o bot faz, em três passos e um botão.
const BOT_PADRAO='TaBaratoAlertaDePrecoBot';

export const PASSOS=[
  ['Copie o link','No app da loja, abra o produto e toque em Compartilhar → Copiar link.'],
  ['Cole no bot','Mande o link para o nosso bot no Telegram. Sem link? Mande só o nome.'],
  ['Escolha quando avisar','Menor preço, um valor que você quer pagar ou queda de %.'],
];
export const EXTRAS=[
  ['🔎','Busque pelo nome','“air fryer mondial” e escolha nos resultados.'],
  ['📱','Tudo num lugar só','Veja e ajuste seus alertas no botão Meus alertas.'],
  ['👥','Em grupo','Coloque o bot no grupo da família e montem uma lista de desejos.'],
  ['⚠️','Sem desconto falso','O aviso diz quando o preço subiu antes de “cair”.'],
];

export function paginaAlertas(bot=BOT_PADRAO) {
  const title='Alerta de preço grátis no Telegram | Tá Barato';
  const description='Escolha o produto e a gente avisa quando baixar de verdade. Mercado Livre, Shopee e AliExpress. Grátis, sem cadastro.';
  const link=`https://t.me/${bot}?start=site_alertas`;
  const passos=PASSOS.map(([t,d],i)=>`<li><span class="alerts-num" aria-hidden="true">${i+1}</span><div><strong>${html(t)}</strong><p>${html(d)}</p></div></li>`).join('');
  const extras=EXTRAS.map(([i,t,d])=>`<div class="alerts-extra"><span aria-hidden="true">${i}</span><strong>${html(t)}</strong><p>${html(d)}</p></div>`).join('');
  return responseHtml(`<!doctype html><html lang="pt-BR"><head>${head({title,description,canonical:`${SITE}/alertas`})}</head><body>${header('alerts')}<main class="alerts-page">
<p class="eyebrow">ALERTAS · GRÁTIS NO TELEGRAM</p>
<h1>Escolha o produto.<br>A gente avisa quando baixar.</h1>
<p class="alerts-lead">Conferimos o preço várias vezes por dia e só avisamos quando a queda é de verdade.</p>
<a class="alerts-cta" href="${html(link)}" target="_blank" rel="noopener noreferrer">Criar meu alerta ↗</a>
<ol class="alerts-steps">${passos}</ol>
<h2>Também dá para</h2>
<div class="alerts-extras">${extras}</div>
<p class="alerts-note">Mercado Livre, Shopee e AliExpress. Grátis e sem cadastro: o bot guarda só o número da conversa, e /parar apaga tudo.</p>
</main>${footer()}</body></html>`,200,'public, max-age=3600, stale-while-revalidate=86400');
}

export function onRequestGet({env}) {
  const bot=/^[A-Za-z0-9_]{5,32}$/.test(String(env?.TELEGRAM_ALERTS_BOT_USERNAME||''))?env.TELEGRAM_ALERTS_BOT_USERNAME:BOT_PADRAO;
  return paginaAlertas(bot);
}

export function onRequestHead(context) {
  return responseHead(onRequestGet(context));
}
