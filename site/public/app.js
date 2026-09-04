const grid = document.querySelector('#offers');
const featuredRoot = document.querySelector('#featured');
const empty = document.querySelector('#empty');
const search = document.querySelector('#search');
let allOffers = [];
let source = '';
const previewOffers = [
  {id:'demo-1',title:'Fone Bluetooth com cancelamento de ruído',price:79.90,original_price:159.90,discount:50,rating:4.8,sales:2350,shop:'Loja Oficial',image_url:'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=80',source:'Shopee',category:'eletronicos'},
  {id:'demo-2',title:'Jogo de panelas antiaderente 5 peças',price:129.90,original_price:249.90,discount:48,rating:4.9,sales:5180,shop:'Casa Prática',image_url:'https://images.unsplash.com/photo-1584990347449-a1846f1a2616?auto=format&fit=crop&w=900&q=80',source:'AliExpress',category:'cozinha'},
  {id:'demo-3',title:'Garrafa térmica inox 1 litro',price:49.90,original_price:89.90,discount:44,rating:4.8,sales:3240,shop:'Loja Boa',image_url:'https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=900&q=80',source:'Amazon',category:'hidratacao'},
  {id:'demo-4',title:'Echo Dot com Alexa e som potente',price:299.00,original_price:429.00,discount:30,rating:4.9,sales:9010,shop:'Amazon',image_url:'https://images.unsplash.com/photo-1543512214-318c7553f230?auto=format&fit=crop&w=900&q=80',source:'Amazon',category:'eletronicos'}
];

const money = new Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'});
const esc = (value='') => String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const image = offer => esc(offer.image_url || '');
const rating = offer => offer.rating ? `⭐ ${Number(offer.rating).toFixed(1)}` : '';
const sales = offer => offer.sales ? ` · ${Number(offer.sales).toLocaleString('pt-BR')} vendidos` : '';

function offerMeta(offer) { return `${rating(offer)}${sales(offer)}` || 'Oferta verificada recentemente'; }
function buyUrl(offer) { return `/go/${encodeURIComponent(offer.id)}`; }

function featuredCard(offer) {
  return `<article class="featured">
    <div class="featured-media"><span class="discount">−${Math.round(offer.discount)}%</span><img src="${image(offer)}" alt="${esc(offer.title)}" loading="eager"></div>
    <div class="featured-body"><span class="source">DESTAQUE · ${esc(offer.source)}</span><h3>${esc(offer.title)}</h3>
      <div><span class="price">${money.format(offer.price)}</span>${offer.original_price ? `<span class="was">${money.format(offer.original_price)}</span>` : ''}</div>
      <p class="meta">${esc(offerMeta(offer))}</p><a class="buy" href="${buyUrl(offer)}" rel="nofollow sponsored">Ver oferta ↗</a>
    </div></article>`;
}

function card(offer) {
  return `<article class="offer-card"><div class="offer-media"><span class="discount">−${Math.round(offer.discount)}%</span><img src="${image(offer)}" alt="${esc(offer.title)}" loading="lazy"></div>
    <div class="offer-body"><span class="source">${esc(offer.source)}</span><h3>${esc(offer.title)}</h3><span class="price">${money.format(offer.price)}</span>
    <p class="meta">${esc(offerMeta(offer))}</p><a class="buy" href="${buyUrl(offer)}" rel="nofollow sponsored">Ver oferta ↗</a></div></article>`;
}

function render() {
  const term = search.value.trim().toLocaleLowerCase('pt-BR');
  const offers = allOffers.filter(o => (!source || o.source === source) && (!term || o.title.toLocaleLowerCase('pt-BR').includes(term)));
  const featured = offers[0];
  featuredRoot.innerHTML = featured ? featuredCard(featured) : '';
  grid.innerHTML = offers.slice(1).map(card).join('');
  empty.hidden = offers.length > 0;
}

document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
  document.querySelector('.filter.active')?.classList.remove('active'); button.classList.add('active'); source = button.dataset.source; render();
}));
search.addEventListener('input', render);
document.querySelector('#year').textContent = new Date().getFullYear();
featuredRoot.innerHTML = '<div class="skeleton" aria-label="Carregando ofertas"></div>';

fetch('/api/offers').then(r => { if (!r.ok) throw new Error('API'); return r.json(); }).then(data => {
  allOffers = Array.isArray(data.offers) ? data.offers : [];
  document.querySelector('#offer-count').textContent = allOffers.length;
  document.querySelector('#best-discount').textContent = allOffers.length ? `${Math.max(...allOffers.map(o=>Number(o.discount)||0))}%` : '—';
  render();
}).catch(() => {
  allOffers = ['localhost','127.0.0.1'].includes(location.hostname) ? previewOffers : [];
  document.querySelector('#offer-count').textContent=allOffers.length;
  document.querySelector('#best-discount').textContent=allOffers.length ? `${Math.max(...allOffers.map(o=>Number(o.discount)||0))}%` : '—';
  render();
});
