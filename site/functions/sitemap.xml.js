import {SITE,offerPath,slugify,xml} from './_site.js';
import {MIN_COLLECTION_OFFERS,MIN_PRICE_HISTORY_DAYS} from './_indexing.js';

function entry(location,lastmod='',changefreq='daily',priority='0.8') {
  return `  <url><loc>${xml(`${SITE}${location}`)}</loc>${lastmod?`<lastmod>${lastmod}</lastmod>`:''}<changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
}

export async function onRequestGet({env}) {
  const since30d=Math.floor(Date.now()/1000)-30*86400;
  const [offers,categories,shops]=await Promise.all([
    env.DB.prepare(`SELECT o.id,o.title,COALESCE(o.last_checked_at,o.published_at) updated_at FROM offers o
      WHERE o.availability='active' AND (SELECT COUNT(*) FROM offer_prices p WHERE p.offer_id=o.id AND p.observed_at>=?)>=?
      ORDER BY updated_at DESC LIMIT 5000`).bind(since30d,MIN_PRICE_HISTORY_DAYS).all(),
    env.DB.prepare("SELECT category value FROM offers WHERE availability!='unavailable' AND category IS NOT NULL AND TRIM(category)!='' GROUP BY category HAVING COUNT(*)>=?").bind(MIN_COLLECTION_OFFERS).all(),
    env.DB.prepare("SELECT shop value FROM offers WHERE availability!='unavailable' AND shop IS NOT NULL AND TRIM(shop)!='' GROUP BY shop HAVING COUNT(*)>=?").bind(MIN_COLLECTION_OFFERS).all()
  ]);
  let posts=[];try{const result=await env.DB.prepare("SELECT slug,updated_at FROM blog_posts WHERE status='published' AND published_at<=? ORDER BY published_at DESC LIMIT 1000").bind(Math.floor(Date.now()/1000)).all();posts=result.results||[];}catch{}
  const urls=[entry('/','','hourly','1.0'),entry('/stories','','hourly','0.8'),entry('/cupons','','hourly','0.9'),entry('/blog','','daily','0.8'),
    entry('/quedas-de-preco','','hourly','0.9'),entry('/menores-precos','','daily','0.9'),
    entry('/mais-acessadas','','daily','0.8'),entry('/mais-vendidos','','daily','0.8'),
    entry('/faixas-de-preco/ate-50','','daily','0.7'),entry('/faixas-de-preco/de-50-a-100','','daily','0.7'),
    entry('/faixas-de-preco/de-100-a-200','','daily','0.7'),entry('/faixas-de-preco/acima-de-200','','daily','0.7'),
    entry('/sobre','','monthly','0.6'),entry('/politica-editorial','','monthly','0.6'),entry('/como-escolhemos','','monthly','0.6'),entry('/faq','','monthly','0.6'),entry('/privacidade','','yearly','0.3'),entry('/termos','','yearly','0.2'),entry('/exclusao-de-dados','','yearly','0.2'),entry('/contato','','monthly','0.4'),
    ...(categories.results||[]).map(row=>entry(`/categorias/${slugify(row.value)}`)),
    ...(shops.results||[]).map(row=>entry(`/lojas/${slugify(row.value)}`)),
    ...posts.map(post=>entry(`/blog/${post.slug}`,new Date(Number(post.updated_at)*1000).toISOString(),'monthly','0.7')),
    ...(offers.results||[]).map(offer=>entry(offerPath(offer),new Date(Number(offer.updated_at)*1000).toISOString()))
  ];
  const body=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
  return new Response(body,{headers:{'Content-Type':'application/xml; charset=utf-8',
    'Cache-Control':'public, max-age=900, stale-while-revalidate=3600','X-Content-Type-Options':'nosniff'}});
}
