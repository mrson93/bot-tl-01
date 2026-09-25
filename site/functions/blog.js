import {SITE,footer,head,header,responseHtml} from './_site.js';
import {blogCard} from './_blog.js';

export async function onRequestGet({env}) {
  let rows=[];
  try {
    const result=await env.DB.prepare(`SELECT slug,title,excerpt,cover_image_url,category,published_at
      FROM blog_posts WHERE status='published' AND published_at<=?
      ORDER BY published_at DESC LIMIT 100`).bind(Math.floor(Date.now()/1000)).all();
    rows=result.results||[];
  } catch {}
  const canonical=`${SITE}/blog`;
  const title='Guias, comparativos e reviews | Tá Barato';
  const description='Conteúdo para comparar produtos, entender diferenças e comprar com mais segurança.';
  const body=rows.length?`<div class="blog-grid">${rows.map(blogCard).join('')}</div>`:
    '<div class="empty"><span>✍️</span><h2>As primeiras matérias estão sendo preparadas</h2><p>Em breve você encontrará guias, comparativos e reviews por aqui.</p></div>';
  return responseHtml(`<!doctype html><html lang="pt-BR"><head>${head({title,description,canonical})}</head><body>${header('blog')}<main class="blog-page"><div class="collection-heading"><p class="eyebrow">CONTEÚDO PARA ESCOLHER MELHOR</p><h1>Guias e comparativos</h1><p>Explicações diretas sobre produtos, diferenças importantes e o que observar antes da compra.</p><strong>${rows.length} ${rows.length===1?'matéria publicada':'matérias publicadas'}</strong></div>${body}</main>${footer()}</body></html>`);
}
