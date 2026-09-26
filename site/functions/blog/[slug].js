import {SITE,footer,head,header,html,money,notFound,responseHtml,shorten} from '../_site.js';
import {articleSidebarAd,articleTableOfContents,comparisonTable,renderArticleBody} from '../_blog.js';

function relatedOffer(offer) {
  return `<article class="article-offer"><img src="${html(offer.image_url)}" alt="${html(offer.title)}" loading="lazy"><div><span>${html(offer.source)}</span><h3>${html(offer.title)}</h3><strong>${html(money(offer.price))}</strong><a class="buy" href="/go/${encodeURIComponent(offer.id)}" rel="nofollow sponsored">Ver preço atual ↗</a></div></article>`;
}

export async function onRequestGet({params,env}) {
  let post;
  try {
    post=await env.DB.prepare(`SELECT id,slug,title,excerpt,body_markdown,cover_image_url,
      category,meta_title,meta_description,published_at,updated_at FROM blog_posts
      WHERE slug=? AND status='published' AND published_at<=?`).bind(String(params.slug||''),Math.floor(Date.now()/1000)).first();
  } catch { return notFound('Matéria não encontrada'); }
  if(!post) return notFound('Matéria não encontrada');
  const result=await env.DB.prepare(`SELECT o.id,o.title,o.price,o.original_price,o.discount,o.rating,o.sales,o.image_url,o.source,o.shop
    FROM blog_post_offers b JOIN offers o ON o.id=b.offer_id
    WHERE b.post_id=? AND o.availability!='unavailable' ORDER BY b.position LIMIT 8`).bind(post.id).all();
  const offers=result.results||[],canonical=`${SITE}/blog/${post.slug}`;
  const title=shorten(post.meta_title||`${post.title} | Tá Barato`,65);
  const description=shorten(post.meta_description||post.excerpt,155);
  const structured=JSON.stringify({'@context':'https://schema.org','@graph':[
    {'@type':'Article',headline:shorten(post.title,110),description,image:post.cover_image_url?[post.cover_image_url]:undefined,
      datePublished:new Date(Number(post.published_at)*1000).toISOString(),dateModified:new Date(Number(post.updated_at)*1000).toISOString(),
      mainEntityOfPage:canonical,author:{'@type':'Organization',name:'Tá Barato'},publisher:{'@type':'Organization',name:'Tá Barato',url:SITE}},
    {'@type':'BreadcrumbList',itemListElement:[
      {'@type':'ListItem',position:1,name:'Início',item:`${SITE}/`},
      {'@type':'ListItem',position:2,name:'Blog',item:`${SITE}/blog`},
      {'@type':'ListItem',position:3,name:shorten(post.title,150),item:canonical},
    ]},
  ]}).replace(/</g,'\\u003c');
  const cover=post.cover_image_url?`<img class="article-cover" src="${html(post.cover_image_url)}" alt="${html(post.title)}">`:'';
  const blocks=Object.fromEntries(offers.map(offer=>[`{{offer:${offer.id}}}`,`<aside class="article-inline-offer" aria-label="Oferta relacionada">${relatedOffer(offer)}</aside>`]));
  blocks['{{comparison-table}}']=comparisonTable(offers);
  const hasInlineOffers=/\{\{offer:[^}]+\}\}/.test(post.body_markdown);
  const offerSection=!hasInlineOffers&&offers.length?`<section class="article-products"><p class="eyebrow">PRODUTOS CITADOS</p><h2>Confira os preços atuais</h2><p class="affiliate-note">Os links abaixo podem gerar comissão para o Tá Barato, sem custo adicional para você.</p><div>${offers.map(relatedOffer).join('')}</div></section>`:'';
  const publishedDate=new Date(Number(post.published_at)*1000),updatedDate=new Date(Number(post.updated_at)*1000);
  const updated=Number(post.updated_at)>Number(post.published_at)+3600?` · Atualizado em <time datetime="${updatedDate.toISOString()}">${updatedDate.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})}</time>`:'';
  return responseHtml(`<!doctype html><html lang="pt-BR"><head>${head({title,description,canonical,structured,image:post.cover_image_url})}<script src="/adsense-units.js" defer></script></head><body>${header('blog')}<main class="article-page"><nav class="breadcrumbs" aria-label="Navegação"><a href="/">Início</a><span>›</span><a href="/blog">Blog</a><span>›</span><span>Matéria</span></nav><article><header class="article-header"><p class="eyebrow">${html(post.category||'GUIA DE COMPRA')}</p><h1>${html(post.title)}</h1><p>${html(post.excerpt)}</p><p class="article-dates"><time datetime="${publishedDate.toISOString()}">Publicado em ${publishedDate.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})}</time>${updated}</p></header>${cover}<div class="article-layout"><div class="article-main">${articleTableOfContents(post.body_markdown)}<div class="article-content">${renderArticleBody(post.body_markdown,blocks)}</div>${offerSection}<p class="article-disclosure">Transparência: esta matéria pode conter links de afiliado. Preços e disponibilidade podem mudar após a publicação.</p></div>${articleSidebarAd()}</div></article></main>${footer()}</body></html>`);
}
