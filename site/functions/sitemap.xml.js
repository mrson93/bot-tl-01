import {SITE,offerPath,slugify,xml} from './_site.js';

function entry(location,lastmod='',changefreq='daily',priority='0.8') {
  return `  <url><loc>${xml(`${SITE}${location}`)}</loc>${lastmod?`<lastmod>${lastmod}</lastmod>`:''}<changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
}

export async function onRequestGet({env}) {
  const since=Math.floor(Date.now()/1000)-30*86400;
  const [offers,categories,shops]=await Promise.all([
    env.DB.prepare('SELECT id,title,published_at FROM offers WHERE published_at>=? ORDER BY published_at DESC LIMIT 1000').bind(since).all(),
    env.DB.prepare("SELECT DISTINCT category value FROM offers WHERE published_at>=? AND category IS NOT NULL AND TRIM(category)!=''").bind(since).all(),
    env.DB.prepare("SELECT DISTINCT shop value FROM offers WHERE published_at>=? AND shop IS NOT NULL AND TRIM(shop)!=''").bind(since).all()
  ]);
  const urls=[entry('/','','hourly','1.0'),entry('/cupons','','hourly','0.9'),entry('/como-escolhemos','','monthly','0.6'),entry('/faq','','monthly','0.6'),entry('/privacidade','','yearly','0.3'),entry('/contato','','monthly','0.4'),
    ...(categories.results||[]).map(row=>entry(`/categorias/${slugify(row.value)}`)),
    ...(shops.results||[]).map(row=>entry(`/lojas/${slugify(row.value)}`)),
    ...(offers.results||[]).map(offer=>entry(offerPath(offer),new Date(Number(offer.published_at)*1000).toISOString()))
  ];
  const body=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
  return new Response(body,{headers:{'Content-Type':'application/xml; charset=utf-8',
    'Cache-Control':'public, max-age=900, stale-while-revalidate=3600','X-Content-Type-Options':'nosniff'}});
}
