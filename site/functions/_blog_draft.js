import {label,shorten,slugify} from './_site.js';

const TYPES=[
  ['power-bank','power bank','carregador portátil'],
  ['fone de ouvido','fone','headphone','headset','earbud'],
  ['smartphone','smartphone','celular'],
  ['smartwatch','smartwatch','relógio inteligente'],
  ['notebook','notebook','laptop'],
  ['tablet','tablet'],
  ['televisor','smart tv','televisor',' tv '],
  ['caixa de som','caixa de som','speaker'],
  ['aspirador','aspirador'],
  ['air fryer','air fryer','fritadeira elétrica','fritadeira eletrica'],
  ['cafeteira','cafeteira'],
  ['ventilador','ventilador'],
  ['parafusadeira','parafusadeira'],
  ['furadeira','furadeira'],
  ['panela','panela'],
  ['tênis','tênis','tenis'],
  ['creatina','creatina'],
  ['whey protein','whey'],
];

const fold=value=>` ${String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ')} `;
const clean=value=>String(value||'').replace(/[\r\n]+/g,' ').replace(/[\\*_{}\[\]#]/g,'').replace(/\s+/g,' ').trim();
export function brazilDateKey(date=new Date()) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const get=type=>parts.find(part=>part.type===type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function comparisonType(title='') {
  const text=fold(title);
  for(const [name,...terms] of TYPES) if(terms.some(term=>text.includes(fold(term)))) return name;
  return null;
}

function score(offer) {
  const rating=Math.max(0,Number(offer.rating)||0),sales=Math.max(0,Number(offer.sales)||0);
  return Math.max(0,Number(offer.discount)||0)*1.5+rating*8+Math.log10(sales+1)*7;
}

export function selectComparableOffers(candidates=[],size=3) {
  const groups=new Map();
  for(const offer of candidates){
    const type=comparisonType(offer.title);if(!type)continue;
    const group=groups.get(type)||[];
    if(!group.some(item=>fold(item.title)===fold(offer.title)))group.push(offer);
    groups.set(type,group);
  }
  return [...groups.entries()].filter(([,offers])=>offers.length>=size)
    .map(([type,offers])=>({type,offers:offers.sort((a,b)=>score(b)-score(a)).slice(0,size),freshness:Math.max(...offers.map(item=>Number(item.last_checked_at||item.published_at)||0))}))
    .sort((a,b)=>b.freshness-a.freshness)[0]||null;
}

const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);
const number=value=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(Number(value)||0);

function facts(offer,offers) {
  const prices=offers.map(item=>Number(item.price)),discounts=offers.map(item=>Number(item.discount)||0);
  const pros=[],attention=[];
  if(Number(offer.price)===Math.min(...prices))pros.push('É a opção de menor preço deste comparativo.');
  if(Number(offer.discount)>0&&Number(offer.discount)===Math.max(...discounts))pros.push(`Tem o maior desconto informado: ${Math.round(Number(offer.discount))}%.`);
  if(Number(offer.rating)>=4.5)pros.push(`Avaliação informada de ${Number(offer.rating).toFixed(1)} de 5.`);
  if(Number(offer.sales)>=100)pros.push(`${number(offer.sales)} vendas informadas no anúncio.`);
  if(!pros.length)pros.push(`Preço consultado de ${money(offer.price)}.`);
  if(Number(offer.price)>Math.min(...prices))attention.push(`Custa ${money(Number(offer.price)-Math.min(...prices))} a mais que a opção mais barata.`);
  if(!Number(offer.discount))attention.push('O anúncio não informa um desconto comparável.');
  if(!Number(offer.rating))attention.push('O catálogo não recebeu uma nota de avaliação para esta oferta.');
  if(!Number(offer.sales))attention.push('O catálogo não recebeu a quantidade de vendas deste anúncio.');
  if(!attention.length)attention.push('Preço e disponibilidade podem mudar a qualquer momento.');
  return {pros,attention};
}

export function buildComparisonDraft(type,offers,date=new Date()) {
  if(!type||!Array.isArray(offers)||offers.length<3)throw new Error('not_enough_offers');
  const day=brazilDateKey(date),winner=[...offers].sort((a,b)=>score(b)-score(a))[0];
  const plurals={'power-bank':'power banks','fone de ouvido':'fones de ouvido',smartphone:'smartphones',smartwatch:'smartwatches',notebook:'notebooks',tablet:'tablets',televisor:'televisores','caixa de som':'caixas de som',aspirador:'aspiradores','air fryer':'air fryers',cafeteira:'cafeteiras',ventilador:'ventiladores',parafusadeira:'parafusadeiras',furadeira:'furadeiras',panela:'panelas','tênis':'tênis',creatina:'creatinas','whey protein':'whey proteins'};
  const typeLabel=plurals[type]||type;
  const title=`3 ofertas de ${typeLabel}: qual vale mais a pena?`;
  const sections=offers.map((offer,index)=>{
    const {pros,attention}=facts(offer,offers);
    const details=[`preço de **${money(offer.price)}**`];
    if(Number(offer.discount)>0)details.push(`desconto informado de **${Math.round(Number(offer.discount))}%**`);
    if(Number(offer.rating)>0)details.push(`nota **${Number(offer.rating).toFixed(1)} de 5**`);
    if(Number(offer.sales)>0)details.push(`**${number(offer.sales)} vendas** informadas`);
    return `## ${index+1}. ${shorten(clean(offer.title),120)}\n\nNa consulta mais recente, esta oferta apareceu com ${details.join(', ')}${offer.shop?` na loja **${clean(offer.shop)}**`:''}.\n\n### Prós\n\n${pros.map(item=>`- ${item}`).join('\n')}\n\n### Pontos de atenção\n\n${attention.map(item=>`- ${item}`).join('\n')}\n\n{{offer:${offer.id}}}`;
  }).join('\n\n');
  const reason=facts(winner,offers).pros[0].replace(/\.$/,'').toLowerCase();
  const category=label(offers[0].category||'outros');
  const excerpt=`Comparamos três ofertas recentes de ${typeLabel} usando preço, desconto, avaliação e popularidade informados nos anúncios.`;
  const body=`Os preços abaixo foram consultados recentemente no catálogo do Tá Barato. A comparação considera somente dados objetivos recebidos das lojas; não realizamos teste físico dos produtos.\n\n${sections}\n\n## Qual é a melhor escolha?\n\nPelos dados disponíveis no momento, **${shorten(clean(winner.title),110)}** é a melhor escolha geral porque ${reason}. Antes da compra, confira capacidade, compatibilidade, prazo de entrega e garantia diretamente na página do produto.\n\n## Tabela comparativa\n\n{{comparison-table}}`;
  return {id:`auto-comparativo-${day}`,slug:slugify(`${typeLabel}-comparativo-ofertas-${day}`),title,excerpt,body_markdown:body,cover_image_url:offers[0].image_url,category:`Comparativo · ${category}`,status:'draft',meta_title:shorten(title,70),meta_description:shorten(excerpt,170),offer_ids:offers.map(item=>item.id)};
}

export async function generateDailyDraft(env,now=Math.floor(Date.now()/1000)) {
  const day=brazilDateKey(new Date(now*1000)),id=`auto-comparativo-${day}`;
  const existing=await env.DB.prepare('SELECT id,slug,title,status FROM blog_posts WHERE id=?').bind(id).first();
  if(existing)return {created:false,reason:'already_exists',post:existing};
  const result=await env.DB.prepare(`SELECT o.id,o.title,o.price,o.discount,o.rating,o.sales,o.shop,o.image_url,o.source,o.category,o.published_at,o.last_checked_at
    FROM offers o WHERE o.availability!='unavailable' AND o.price>0 AND o.image_url LIKE 'https://%'
    AND COALESCE(o.last_checked_at,o.published_at)>=? AND NOT EXISTS (
      SELECT 1 FROM blog_post_offers b JOIN blog_posts p ON p.id=b.post_id
      WHERE b.offer_id=o.id AND p.created_at>=?
    ) ORDER BY COALESCE(o.last_checked_at,o.published_at) DESC LIMIT 240`).bind(now-7*86400,now-30*86400).all();
  const selected=selectComparableOffers(result.results||[]);
  if(!selected)return {created:false,reason:'no_comparable_offers'};
  const draft=buildComparisonDraft(selected.type,selected.offers,new Date(now*1000));
  const statements=[env.DB.prepare(`INSERT INTO blog_posts(id,slug,title,excerpt,body_markdown,cover_image_url,category,status,meta_title,meta_description,published_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(draft.id,draft.slug,draft.title,draft.excerpt,draft.body_markdown,draft.cover_image_url,draft.category,'draft',draft.meta_title,draft.meta_description,null,now,now),...draft.offer_ids.map((offerId,index)=>env.DB.prepare('INSERT INTO blog_post_offers(post_id,offer_id,position) VALUES(?,?,?)').bind(draft.id,offerId,index))];
  try{await env.DB.batch(statements);}catch(error){
    if(String(error?.message||'').toLowerCase().includes('unique'))return {created:false,reason:'already_exists'};
    throw error;
  }
  return {created:true,post:{id:draft.id,slug:draft.slug,title:draft.title,status:'draft',offer_ids:draft.offer_ids}};
}
