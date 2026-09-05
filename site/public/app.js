const grid=document.querySelector('#offers');
const featuredRoot=document.querySelector('#featured');
const empty=document.querySelector('#empty');
const search=document.querySelector('#search');
const category=document.querySelector('#category');
const minPrice=document.querySelector('#min-price');
const maxPrice=document.querySelector('#max-price');
const minRating=document.querySelector('#min-rating');
const shop=document.querySelector('#shop');
const sort=document.querySelector('#sort');
const resultCount=document.querySelector('#result-count');
const clearFilters=document.querySelector('#clear-filters');
const sourceFilters=document.querySelector('#source-filters');
const categoryLinks=document.querySelector('#category-links');
const browseModes=document.querySelector('.browse-modes');
let allOffers=[];
let source='';
const now=Math.floor(Date.now()/1000);
const previewOffers=[
  {id:'demo-1',title:'Fone Bluetooth com cancelamento de ruído',price:79.90,original_price:159.90,discount:50,rating:4.8,sales:2350,shop:'Loja Oficial',image_url:'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=80',source:'Shopee',category:'eletronicos',published_at:now-1200,coupon_code:'APP20',coupon_condition:'R$ 20 acima de R$ 100',payment_label:'Preço no app',clicks_24h:8},
  {id:'demo-2',title:'Jogo de panelas antiaderente 5 peças',price:129.90,original_price:249.90,discount:48,rating:4.9,sales:5180,shop:'Casa Prática',image_url:'https://images.unsplash.com/photo-1584990347449-a1846f1a2616?auto=format&fit=crop&w=900&q=80',source:'AliExpress',category:'cozinha',published_at:now-4500,clicks_24h:3},
  {id:'demo-3',title:'Garrafa térmica inox 1 litro',price:49.90,original_price:89.90,discount:44,rating:4.8,sales:3240,shop:'Loja Boa',image_url:'https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=900&q=80',source:'Shopee',category:'hidratacao',published_at:now-9000,clicks_24h:1},
  {id:'demo-4',title:'Caixa de som inteligente com assistente de voz',price:299.00,original_price:429.00,discount:30,rating:4.9,sales:9010,shop:'Tech Global',image_url:'https://images.unsplash.com/photo-1543512214-318c7553f230?auto=format&fit=crop&w=900&q=80',source:'AliExpress',category:'eletronicos',published_at:now-18000,clicks_24h:0}
];

const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const esc=(value='')=>String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const normalized=(value='')=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
const slugify=value=>normalized(value).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80)||'oferta';
const image=offer=>esc(offer.image_url||'');
const buyUrl=offer=>`/go/${encodeURIComponent(offer.id)}`;
const detailUrl=offer=>`/oferta/${slugify(offer.title)}--${encodeURIComponent(offer.id)}`;

function label(value='') {
  const names={eletronicos:'Eletrônicos',hidratacao:'Hidratação',automotivo:'Automotivo',infantil:'Infantil',ferramentas:'Ferramentas',outros:'Outros'};
  const text=String(value).replace(/[_-]+/g,' ');
  return names[normalized(text)]||text.replace(/(^|\s)(\p{L})/gu,(_,space,letter)=>space+letter.toLocaleUpperCase('pt-BR'));
}

function ageLabel(timestamp) {
  const seconds=Math.max(0,Math.floor(Date.now()/1000)-Number(timestamp||Date.now()/1000));
  if(seconds<3600) return `há ${Math.max(1,Math.floor(seconds/60))} min`;
  if(seconds<86400) return `há ${Math.floor(seconds/3600)} h`;
  const days=Math.floor(seconds/86400);
  return `há ${days} ${days===1?'dia':'dias'}`;
}

function offerMeta(offer) {
  const parts=[];
  if(offer.rating) parts.push(`⭐ ${Number(offer.rating).toFixed(1)}`);
  if(offer.sales) parts.push(`${Number(offer.sales).toLocaleString('pt-BR')} vendidos`);
  return parts.join(' · ')||'Oferta verificada recentemente';
}

function flags(offer) {
  const couponActive=offer.coupon_code&&(!offer.coupon_expires_at||Number(offer.coupon_expires_at)>Date.now()/1000);
  return [offer.payment_label,couponActive?`Cupom ${offer.coupon_code}`:''].filter(Boolean);
}

function flagsHtml(offer) {
  const values=flags(offer);
  return values.length?`<div class="offer-flags">${values.map(value=>`<span>${esc(value)}</span>`).join('')}</div>`:'';
}

function storeHtml(offer) {
  return offer.shop?`<a class="store-link" href="/lojas/${slugify(offer.shop)}">${esc(offer.shop)}</a>`:esc(offer.source);
}

function cardKicker(offer,prefix='') {
  return `<div class="card-kicker"><span class="source">${prefix}${esc(offer.source)}</span><time>${esc(ageLabel(offer.published_at))}</time></div>`;
}

function featuredCard(offer) {
  return `<article class="featured"><div class="featured-media">${offer.discount?`<span class="discount">−${Math.round(offer.discount)}%</span>`:''}<a class="offer-detail-link" href="${detailUrl(offer)}" aria-label="Ver detalhes de ${esc(offer.title)}"><img src="${image(offer)}" alt="${esc(offer.title)}" loading="eager"></a></div><div class="featured-body">${cardKicker(offer,'DESTAQUE · ')}<h3><a class="title-link" href="${detailUrl(offer)}">${esc(offer.title)}</a></h3>${flagsHtml(offer)}<div class="card-price"><span class="price">${money.format(offer.price)}</span>${offer.original_price?`<span class="was">${money.format(offer.original_price)}</span>`:''}</div><p class="meta">${esc(offerMeta(offer))}</p><p class="card-store">Loja: ${storeHtml(offer)}</p><a class="buy" href="${buyUrl(offer)}" rel="nofollow sponsored">Ver oferta ↗</a></div></article>`;
}

function card(offer) {
  return `<article class="offer-card"><div class="offer-media">${offer.discount?`<span class="discount">−${Math.round(offer.discount)}%</span>`:''}<a class="offer-detail-link" href="${detailUrl(offer)}" aria-label="Ver detalhes de ${esc(offer.title)}"><img src="${image(offer)}" alt="${esc(offer.title)}" loading="lazy"></a></div><div class="offer-body">${cardKicker(offer)}<h3><a class="title-link" href="${detailUrl(offer)}">${esc(offer.title)}</a></h3>${flagsHtml(offer)}<div class="card-price"><span class="price">${money.format(offer.price)}</span>${offer.original_price?`<span class="was">${money.format(offer.original_price)}</span>`:''}</div><p class="meta">${esc(offerMeta(offer))}</p><p class="card-store">${storeHtml(offer)}</p><a class="buy" href="${buyUrl(offer)}" rel="nofollow sponsored">Ver oferta ↗</a></div></article>`;
}

function numberOrNull(value) {
  const parsed=Number(value);
  return value!==''&&Number.isFinite(parsed)?parsed:null;
}

function populateSelect(select,values,firstLabel) {
  const selected=select.value;
  const options=[...new Set(values.filter(Boolean).map(value=>String(value).trim()))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  select.innerHTML=`<option value="">${esc(firstLabel)}</option>${options.map(value=>`<option value="${esc(value)}">${esc(label(value))}</option>`).join('')}`;
  if(options.includes(selected)) select.value=selected;
}

function updateFilterOptions() {
  populateSelect(category,allOffers.map(offer=>offer.category),'Todas');
  populateSelect(shop,allOffers.map(offer=>offer.shop),'Todas');
}

function updateCategoryLinks() {
  const categories=[...new Set(allOffers.map(offer=>String(offer.category||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  categoryLinks.innerHTML=categories.length?`<span>Categorias</span>${categories.map(value=>`<a href="/categorias/${slugify(value)}">${esc(label(value))}</a>`).join('')}`:'';
  categoryLinks.hidden=categories.length===0;
}

function updateSourceFilters() {
  const sources=[...new Set(allOffers.map(offer=>String(offer.source||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  if(source&&!sources.includes(source)) source='';
  sourceFilters.innerHTML=[{value:'',text:'Todas as plataformas'},...sources.map(value=>({value,text:value}))]
    .map(item=>`<button class="filter${item.value===source?' active':''}" data-source="${esc(item.value)}">${esc(item.text)}</button>`).join('');
  sourceFilters.hidden=sources.length===0;
}

function trendScore(offer) {
  const ageHours=Math.max(0,(Date.now()/1000-Number(offer.published_at||0))/3600);
  return Number(offer.clicks_24h||0)*20+Math.log10(Number(offer.sales||0)+1)*12+
    Number(offer.discount||0)*0.7+Number(offer.rating||0)*5-Math.min(ageHours,168)*0.25;
}

function syncBrowseMode() {
  browseModes.querySelectorAll('.browse-mode').forEach(button=>button.classList.toggle('active',button.dataset.sort===sort.value));
}

function render() {
  const term=normalized(search.value.trim());
  const floor=numberOrNull(minPrice.value);
  const ceiling=numberOrNull(maxPrice.value);
  const minimumRating=numberOrNull(minRating.value);
  const offers=allOffers.filter(offer=>{
    const price=Number(offer.price)||0;
    const offerRating=Number(offer.rating)||0;
    return (!source||offer.source===source)&&(!term||normalized(offer.title).includes(term))&&
      (!category.value||offer.category===category.value)&&(!shop.value||offer.shop===shop.value)&&
      (floor===null||price>=floor)&&(ceiling===null||price<=ceiling)&&
      (minimumRating===null||offerRating>=minimumRating);
  });
  const sorters={
    trending:(a,b)=>trendScore(b)-trendScore(a),
    recent:(a,b)=>(Number(b.published_at)||0)-(Number(a.published_at)||0),
    discount:(a,b)=>(Number(b.discount)||0)-(Number(a.discount)||0),
    'price-asc':(a,b)=>(Number(a.price)||0)-(Number(b.price)||0),
    'price-desc':(a,b)=>(Number(b.price)||0)-(Number(a.price)||0),
    rating:(a,b)=>(Number(b.rating)||0)-(Number(a.rating)||0),
    sales:(a,b)=>(Number(b.sales)||0)-(Number(a.sales)||0)
  };
  offers.sort(sorters[sort.value]||sorters.trending);
  featuredRoot.innerHTML=offers[0]?featuredCard(offers[0]):'';
  grid.innerHTML=offers.slice(1).map(card).join('');
  empty.hidden=offers.length>0;
  resultCount.textContent=`${offers.length} ${offers.length===1?'oferta encontrada':'ofertas encontradas'}`;
  clearFilters.disabled=!source&&!term&&!category.value&&!shop.value&&floor===null&&ceiling===null&&minimumRating===null&&sort.value==='trending';
  syncBrowseMode();
}

sourceFilters.addEventListener('click',event=>{
  const button=event.target.closest('.filter');
  if(!button) return;
  source=button.dataset.source||'';
  updateSourceFilters();
  render();
});
browseModes.addEventListener('click',event=>{
  const button=event.target.closest('.browse-mode');
  if(!button) return;
  sort.value=button.dataset.sort;
  render();
});
[search,minPrice,maxPrice].forEach(control=>control.addEventListener('input',render));
[category,minRating,shop,sort].forEach(control=>control.addEventListener('change',render));
clearFilters.addEventListener('click',()=>{
  search.value='';category.value='';minPrice.value='';maxPrice.value='';minRating.value='';shop.value='';sort.value='trending';source='';
  updateSourceFilters();render();search.focus();
});
document.querySelector('#year').textContent=new Date().getFullYear();
featuredRoot.innerHTML='<div class="skeleton" aria-label="Carregando ofertas"></div>';

fetch('/api/offers').then(response=>{if(!response.ok) throw new Error('API');return response.json();}).then(data=>{
  allOffers=Array.isArray(data.offers)?data.offers:[];
  updateSourceFilters();updateFilterOptions();updateCategoryLinks();
  document.querySelector('#offer-count').textContent=allOffers.length;
  document.querySelector('#best-discount').textContent=allOffers.length?`${Math.max(...allOffers.map(offer=>Number(offer.discount)||0))}%`:'—';
  render();
}).catch(()=>{
  allOffers=['localhost','127.0.0.1'].includes(location.hostname)?previewOffers:[];
  updateSourceFilters();updateFilterOptions();updateCategoryLinks();
  document.querySelector('#offer-count').textContent=allOffers.length;
  document.querySelector('#best-discount').textContent=allOffers.length?`${Math.max(...allOffers.map(offer=>Number(offer.discount)||0))}%`:'—';
  render();
});
