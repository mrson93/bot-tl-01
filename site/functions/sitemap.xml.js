const SITE = 'https://canaltabarato.pages.dev';

function xml(value='') {
  return String(value).replace(/[<>&'\"]/g, char => ({
    '<':'&lt;', '>':'&gt;', '&':'&amp;', "'":'&apos;', '"':'&quot;'
  }[char]));
}

export async function onRequestGet({env}) {
  const since=Math.floor(Date.now()/1000)-30*86400;
  const result=await env.DB.prepare(
    'SELECT id,published_at FROM offers WHERE published_at>=? ORDER BY published_at DESC LIMIT 1000'
  ).bind(since).all();
  const urls=[
    `  <url><loc>${SITE}/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>`,
    ...(result.results||[]).map(offer => {
      const location=`${SITE}/oferta/${encodeURIComponent(offer.id)}`;
      const lastmod=new Date(Number(offer.published_at)*1000).toISOString();
      return `  <url><loc>${xml(location)}</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`;
    })
  ];
  const body=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
  return new Response(body,{headers:{
    'Content-Type':'application/xml; charset=utf-8',
    'Cache-Control':'public, max-age=900, stale-while-revalidate=3600',
    'X-Content-Type-Options':'nosniff'
  }});
}
