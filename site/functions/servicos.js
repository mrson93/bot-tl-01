import {SITE,footer,head,header,html,responseHead,responseHtml} from './_site.js';

const DEFAULT_ALERT_BOT='TaBaratoAlertaDePrecoBot';

// Cada item aponta para um recurso que já funciona; nada aqui é promessa.
export function services(alertBot=DEFAULT_ALERT_BOT) {
  return [
    {group:'Receba as ofertas',items:[
      {icon:'✈️',title:'Canal no Telegram',text:'Ofertas selecionadas assim que aparecem, com preço, avaliação e link oficial. Grátis e sem cadastro.',href:'https://t.me/CanalTaBarato',cta:'Entrar no canal',external:true},
      {icon:'🔔',title:'Alertas por palavra-chave',text:'Diga ao nosso bot o que você procura, como “air fryer” ou “fone bluetooth”, e receba no privado quando aparecer oferta disso. Até 5 alertas.',href:`https://t.me/${alertBot}?start=site`,cta:'Criar um alerta',external:true},
      {icon:'📸',title:'Stories no Instagram',text:'Ofertas do dia nos Stories. Responda QUERO no Direct e receba o link na conversa.',href:'https://www.instagram.com/ofertascanaltabarato/',cta:'Seguir no Instagram',external:true},
      {icon:'📣',title:'Facebook, X e Bluesky',text:'As mesmas ofertas na rede que você já usa.',href:'/#social-title',cta:'Escolher a rede'},
    ]},
    {group:'Compare antes de comprar',items:[
      {icon:'📈',title:'Histórico de preços',text:'Cada oferta mostra os preços que registramos nos últimos 30 dias e diz se o valor atual está abaixo, na média ou acima.',href:'/quedas-de-preco',cta:'Ver histórico'},
      {icon:'↘',title:'Quedas de preço',text:'Produtos cujo preço caiu desde a medição anterior.',href:'/quedas-de-preco',cta:'Ver quedas'},
      {icon:'◎',title:'Menores preços',text:'Ofertas no menor valor que já observamos.',href:'/menores-precos',cta:'Ver menores preços'},
      {icon:'📚',title:'Guias e comparativos',text:'Comparativos por segmento com preço consultado, avaliações, vendas e ficha técnica, atualizados periodicamente.',href:'/blog',cta:'Ler os guias'},
    ]},
    {group:'Economize mais',items:[
      {icon:'🎟',title:'Cupons ativos',text:'Cupons e vouchers oficiais das lojas, com prazo e condições.',href:'/cupons',cta:'Ver cupons'},
      {icon:'★',title:'Mais vendidos e mais acessadas',text:'O que está saindo mais nas lojas e o que mais leva nossos visitantes às compras.',href:'/mais-vendidos',cta:'Ver mais vendidos'},
      {icon:'🏷',title:'Por faixa de preço',text:'Ofertas até R$ 50, de R$ 50 a R$ 100, de R$ 100 a R$ 200 e acima.',href:'/faixas-de-preco/ate-50',cta:'Explorar por preço'},
      {icon:'🛍',title:'Lojas parceiras',text:'Shopee, Mercado Livre, Amazon e AliExpress em um só lugar, sempre com link para a página oficial.',href:'/#store-shortcuts',cta:'Ver lojas'},
    ]},
    {group:'No seu ritmo',items:[
      {icon:'♥',title:'Favoritos',text:'Salve ofertas no seu navegador para decidir depois. Nada é enviado para nós.',href:'/',cta:'Ver ofertas'},
      {icon:'⚑',title:'Avise uma oferta encerrada',text:'Viu que um preço acabou? O botão na página da oferta nos ajuda a revisar.',href:'/como-escolhemos',cta:'Como revisamos'},
    ]},
  ];
}

export function servicesSection(alertBot=DEFAULT_ALERT_BOT) {
  return services(alertBot).map(group=>`<section class="services-group"><h2>${html(group.group)}</h2><div class="services-grid">${group.items.map(item=>`<a class="service-card" href="${html(item.href)}"${item.external?' target="_blank" rel="noopener noreferrer"':''}><span class="service-icon" aria-hidden="true">${html(item.icon)}</span><strong>${html(item.title)}</strong><p>${html(item.text)}</p><b>${html(item.cta)} →</b></a>`).join('')}</div></section>`).join('');
}

export function onRequestGet({env}) {
  const alertBot=/^[A-Za-z0-9_]{5,32}$/.test(String(env?.TELEGRAM_ALERTS_BOT_USERNAME||''))?env.TELEGRAM_ALERTS_BOT_USERNAME:DEFAULT_ALERT_BOT;
  const title='Serviços do Tá Barato: alertas, histórico de preços, cupons e guias';
  const description='Conheça tudo o que o Tá Barato oferece de graça: canal de ofertas, alertas por palavra-chave, histórico de preços, cupons, guias de compra e muito mais.';
  const canonical=`${SITE}/servicos`;
  const structured=JSON.stringify({'@context':'https://schema.org','@type':'ItemList',name:'Serviços do Tá Barato',
    itemListElement:services(alertBot).flatMap(group=>group.items).map((item,index)=>({'@type':'ListItem',position:index+1,name:item.title,description:item.text}))}).replace(/</g,'\\u003c');
  return responseHtml(`<!doctype html><html lang="pt-BR"><head>${head({title,description,canonical,structured})}</head><body>${header('services')}<main class="services-page"><p class="eyebrow">TUDO GRÁTIS</p><h1>O que o Tá Barato faz por você</h1><p class="services-intro">Selecionamos ofertas reais das lojas parceiras e acompanhamos os preços para você comprar no momento certo. Escolha como quer receber e usar.</p>${servicesSection(alertBot)}<p class="services-note">Os links podem gerar comissão para o canal, sem custo adicional para você. Saiba <a href="/como-escolhemos">como escolhemos as ofertas</a>.</p></main>${footer()}</body></html>`,200,'public, max-age=3600, stale-while-revalidate=86400');
}

export function onRequestHead(context) {
  return responseHead(onRequestGet(context));
}
