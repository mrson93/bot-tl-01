import {compact,html,money,shorten} from './_site.js';

const SPEC_LABELS={battery:'Capacidade',power:'Potência',storage:'Memória/capacidade',screen:'Tela',voltage:'Voltagem',dimensions:'Dimensões',features:'Recursos'};
const unique=values=>[...new Set(values.filter(Boolean))];
const matches=(text,regex,format=match=>match[0])=>unique([...text.matchAll(regex)].map(format));

export function extractProductSpecs(title='') {
  const text=String(title||''),lower=text.toLocaleLowerCase('pt-BR'),specs={};
  const battery=matches(text,/(\d{3,6}(?:[.,]\d+)?)\s*m\s*ah/gi,match=>`${match[1].replace('.',',')} mAh`);
  const power=matches(text,/(\d{1,4}(?:[.,]\d+)?)\s*w(?:atts?)?\b/gi,match=>`${match[1].replace('.',',')} W`);
  const storage=matches(text,/(\d+(?:[.,]\d+)?)\s*(tb|gb)\b/gi,match=>`${match[1].replace('.',',')} ${match[2].toUpperCase()}`);
  const screen=matches(text,/(\d{1,3}(?:[.,]\d+)?)\s*(?:["”]|pol(?:egadas?)?)(?=\s|$|[,;])/gi,match=>`${match[1].replace('.',',')}″`);
  const voltage=matches(text,/\b(bivolt|110\s*v|127\s*v|220\s*v)\b/gi,match=>match[1].replace(/\s+/g,'').replace(/^bivolt$/i,'Bivolt').toUpperCase().replace('BIVOLT','Bivolt'));
  const dimensions=matches(text,/\b(\d{1,4}\s*x\s*\d{1,4}(?:\s*x\s*\d{1,4})?)\s*(mm|cm|m)\b/gi,match=>`${match[1].replace(/\s+/g,'')} ${match[2].toLowerCase()}`);
  const features=[];
  const bluetooth=lower.match(/bluetooth\s*(\d+(?:[.,]\d+)?)?/i);if(bluetooth)features.push(`Bluetooth${bluetooth[1]?` ${bluetooth[1].replace(',','.')}`:''}`);
  const featurePatterns=[[/\bwi[ -]?fi\b/i,'Wi-Fi'],[/\b5g\b/i,'5G'],[/\b4g\b/i,'4G'],[/\busb[ -]?c\b/i,'USB-C'],[/\bnfc\b/i,'NFC'],[/\bgps\b/i,'GPS'],[/\banc\b|cancelamento (?:ativo )?de ru[ií]do/i,'ANC'],[/sem fio|wireless/i,'Sem fio'],[/magn[eé]tic/i,'Magnético'],[/carregamento r[aá]pido|fast charg/i,'Carga rápida'],[/resistente [àa] [aá]gua|imperme[aá]vel/i,'Resistente à água']];
  for(const [pattern,label] of featurePatterns)if(pattern.test(lower))features.push(label);
  if(battery.length)specs.battery=battery.join(' / ');if(power.length)specs.power=power.join(' / ');
  if(storage.length)specs.storage=storage.join(' / ');if(screen.length)specs.screen=screen.join(' / ');
  if(voltage.length)specs.voltage=voltage.join(' / ');if(dimensions.length)specs.dimensions=dimensions.join(' / ');
  if(features.length)specs.features=unique(features).join(', ');
  return specs;
}

export function comparisonTable(offers=[]) {
  if(!offers.length)return '';
  const enriched=offers.map(offer=>({...offer,specs:extractProductSpecs(offer.title)}));
  const keys=Object.keys(SPEC_LABELS).filter(key=>enriched.some(offer=>offer.specs[key])).slice(0,4);
  const specHeaders=keys.length?keys.map(key=>`<th>${SPEC_LABELS[key]}</th>`).join(''):'<th>Especificações anunciadas</th>';
  const lowest=Math.min(...offers.map(offer=>Number(offer.price)||Infinity));
  const rows=enriched.map(offer=>{
    const difference=Number(offer.price)-lowest,priceNote=difference>0?`+${money(difference)} vs. menor`:'Menor preço';
    const reputation=[offer.rating?`⭐ ${Number(offer.rating).toFixed(1)}`:'Sem nota',offer.sales?`${compact(offer.sales)} vendas`:null].filter(Boolean).join(' · ');
    const specs=keys.length?keys.map(key=>`<td>${html(offer.specs[key]||'Não informado')}</td>`).join(''):'<td>Não informado no título</td>';
    return `<tr><th scope="row">${html(offer.title)}</th><td><strong>${html(money(offer.price))}</strong><small>${html(priceNote)}</small></td><td>${Number(offer.discount)>0?`${Math.round(Number(offer.discount))}%`:'Não informado'}</td><td>${html(reputation)}</td>${specs}<td>${html(offer.shop||offer.source)}</td><td><a href="/go/${encodeURIComponent(offer.id)}" rel="nofollow sponsored">Ver oferta ↗</a></td></tr>`;
  }).join('');
  return `<p class="article-table-note">Especificações extraídas do título dos anúncios. Confirme todos os detalhes na página do produto antes da compra.</p><div class="article-table-wrap"><table class="article-comparison"><thead><tr><th>Produto</th><th>Preço atual</th><th>Desconto</th><th>Nota e vendas</th>${specHeaders}<th>Loja</th><th>Link</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function inline(value='') {
  return html(value)
    .replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>')
    .replace(/_([^_\n]+)_/g,'<em>$1</em>');
}

export function renderArticleBody(markdown='',blocks={}) {
  const lines=String(markdown).replace(/\r/g,'').split('\n').slice(0,1200);
  const output=[];let paragraph=[],list=[];
  const flushParagraph=()=>{if(paragraph.length){output.push(`<p>${inline(paragraph.join(' '))}</p>`);paragraph=[];}};
  const flushList=()=>{if(list.length){output.push(`<ul>${list.map(item=>`<li>${inline(item)}</li>`).join('')}</ul>`);list=[];}};
  for(const raw of lines){
    const line=raw.trim();
    if(!line){flushParagraph();flushList();continue;}
    if(Object.hasOwn(blocks,line)){
      flushParagraph();flushList();output.push(blocks[line]);continue;
    }
    const heading=line.match(/^(#{2,3})\s+(.+)$/);
    if(heading){flushParagraph();flushList();const level=heading[1].length;output.push(`<h${level}>${inline(heading[2])}</h${level}>`);continue;}
    const item=line.match(/^[-*]\s+(.+)$/);
    if(item){flushParagraph();list.push(item[1]);continue;}
    flushList();paragraph.push(line);
  }
  flushParagraph();flushList();
  return output.join('');
}

export function blogCard(post) {
  const image=post.cover_image_url?`<img src="${html(post.cover_image_url)}" alt="" loading="lazy">`:'<span aria-hidden="true">✦</span>';
  const date=post.published_at?new Date(Number(post.published_at)*1000).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}):'';
  return `<article class="blog-card"><a class="blog-card-media" href="/blog/${html(post.slug)}">${image}</a><div><p class="eyebrow">${html(post.category||'GUIA DE COMPRA')}</p><h2><a href="/blog/${html(post.slug)}">${html(post.title)}</a></h2><p>${html(shorten(post.excerpt,190))}</p><small>${html(date)}</small><a class="blog-read" href="/blog/${html(post.slug)}">Ler matéria →</a></div></article>`;
}
