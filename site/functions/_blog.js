import {html,shorten} from './_site.js';

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
