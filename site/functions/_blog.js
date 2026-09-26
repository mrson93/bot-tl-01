import {html,money,shorten,slugify} from './_site.js';
import {extractProductSpecs,SPEC_LABELS} from './_product_specs.js';
import {productSpecs as editorialSpecs} from './_blog_products.js';
export {extractProductSpecs} from './_product_specs.js';

export function comparisonTable(offers=[]) {
  if(!offers.length)return '';
  const enriched=offers.map(offer=>({...offer,specs:extractProductSpecs(offer.title)}));
  const keys=Object.keys(SPEC_LABELS).filter(key=>enriched.some(offer=>offer.specs[key])).slice(0,4);
  const specHeaders=keys.length?keys.map(key=>`<th>${SPEC_LABELS[key]}</th>`).join(''):'<th>Especificações informadas</th>';
  const rows=enriched.map(offer=>{
    const specs=keys.length?keys.map(key=>`<td data-label="${html(SPEC_LABELS[key])}">${html(offer.specs[key]||'Não informado')}</td>`).join(''):'<td data-label="Especificações">Não informado no título</td>';
    return `<tr><th scope="row"><a href="/go/${encodeURIComponent(offer.id)}" rel="nofollow sponsored">${html(offer.title)}<small>Ver produto ↗</small></a></th>${specs}<td data-label="Preço de referência"><strong>${html(money(offer.price))}</strong><small>Pode mudar</small></td></tr>`;
  }).join('');
  return `<p class="article-table-note">A comparação técnica usa as informações disponíveis no catálogo. Confirme a ficha completa com a loja ou o fabricante.</p><div class="article-table-wrap" tabindex="0" aria-label="Tabela comparativa com rolagem horizontal em telas médias"><table class="article-comparison"><thead><tr><th>Produto</th>${specHeaders}<th>Preço de referência</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function editorialProductCard(product) {
  const image=product.image_url?`<img src="${html(product.image_url)}" alt="${html(product.name)}" loading="lazy">`:'<span class="article-product-placeholder" aria-hidden="true">✦</span>';
  const brand=product.brand?`<span>${html(product.brand)}</span>`:'';
  const summary=product.summary?`<p>${html(product.summary)}</p>`:'';
  const price=product.price_label?`<strong>${html(product.price_label)}</strong>`:'';
  return `<article class="article-offer editorial-product">${image}<div>${brand}<h3>${html(product.name)}</h3>${summary}${price}<a class="buy" href="${html(product.affiliate_url)}" target="_blank" rel="nofollow sponsored noopener">Ver produto ↗</a></div></article>`;
}

export function editorialComparisonTable(products=[]) {
  if(!products.length)return '';
  const enriched=products.map(product=>({...product,specs:editorialSpecs(product.specs_json||product.specs)}));
  const keys=[...new Set(enriched.flatMap(product=>Object.keys(product.specs)))].slice(0,5),hasPrice=enriched.some(product=>product.price_label);
  const headers=keys.map(key=>`<th>${html(key)}</th>`).join('');
  const rows=enriched.map(product=>`<tr><th scope="row"><a href="${html(product.affiliate_url)}" target="_blank" rel="nofollow sponsored noopener">${html(product.name)}<small>Ver produto ↗</small></a></th>${keys.map(key=>`<td data-label="${html(key)}">${html(product.specs[key]||'Não informado')}</td>`).join('')}${hasPrice?`<td data-label="Preço de referência">${html(product.price_label||'Consultar')}</td>`:''}</tr>`).join('');
  return `<p class="article-table-note">Comparação baseada nas fichas técnicas cadastradas para esta matéria. Confirme versões e especificações no fabricante.</p><div class="article-table-wrap" tabindex="0" aria-label="Tabela comparativa de produtos"><table class="article-comparison editorial-comparison"><thead><tr><th>Produto</th>${headers}${hasPrice?'<th>Preço de referência</th>':''}</tr></thead><tbody>${rows}</tbody></table></div>`;
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
