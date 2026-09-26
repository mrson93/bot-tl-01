import {compact,html,money,shorten,slugify} from './_site.js';
import {extractProductSpecs,SPEC_LABELS} from './_product_specs.js';
export {extractProductSpecs} from './_product_specs.js';

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

export function articleSidebarAd() {
  return `<aside class="article-ad-sidebar" aria-label="Publicidade"><span>Publicidade</span><ins class="adsbygoogle" data-ad-client="ca-pub-5239970037930660" data-ad-slot="3688125182" data-ad-format="auto" data-full-width-responsive="true"></ins></aside>`;
}

function inline(value='') {
  return html(value)
    .replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>')
    .replace(/_([^_\n]+)_/g,'<em>$1</em>');
}

function headingId(value,seen) {
  const base=slugify(String(value).replace(/[*_]/g,''))||'secao',count=(seen.get(base)||0)+1;
  seen.set(base,count);return count===1?base:`${base}-${count}`;
}

export function articleTableOfContents(markdown='') {
  const seen=new Map(),items=[];
  for(const raw of String(markdown).replace(/\r/g,'').split('\n').slice(0,1200)){
    const match=raw.trim().match(/^(#{2,3})\s+(.+)$/);if(!match)continue;
    items.push({level:match[1].length,title:match[2].replace(/[*_]/g,''),id:headingId(match[2],seen)});
  }
  if(items.filter(item=>item.level===2).length<2)return '';
  return `<nav class="article-toc" aria-label="Sumário da matéria"><strong>Nesta matéria</strong><ol>${items.map(item=>`<li class="level-${item.level}"><a href="#${html(item.id)}">${html(item.title)}</a></li>`).join('')}</ol></nav>`;
}

export function renderArticleBody(markdown='',blocks={}) {
  const lines=String(markdown).replace(/\r/g,'').split('\n').slice(0,1200);
  const output=[],seenHeadings=new Map();let paragraph=[],list=[];
  const flushParagraph=()=>{if(paragraph.length){output.push(`<p>${inline(paragraph.join(' '))}</p>`);paragraph=[];}};
  const flushList=()=>{if(list.length){output.push(`<ul>${list.map(item=>`<li>${inline(item)}</li>`).join('')}</ul>`);list=[];}};
  for(const raw of lines){
    const line=raw.trim();
    if(!line){flushParagraph();flushList();continue;}
    if(Object.hasOwn(blocks,line)){
      flushParagraph();flushList();output.push(blocks[line]);continue;
    }
    const heading=line.match(/^(#{2,3})\s+(.+)$/);
    if(heading){flushParagraph();flushList();const level=heading[1].length,id=headingId(heading[2],seenHeadings);output.push(`<h${level} id="${html(id)}">${inline(heading[2])}</h${level}>`);continue;}
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
