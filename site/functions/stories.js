import {SITE,ageLabel,footer,head,header,html,money,responseHtml} from './_site.js';

const STORY_LIFETIME=24*60*60;

function card(story,now) {
  const source=story.shop||story.source||'Instagram';
  const image=story.image_url
    ?`<img src="${html(story.image_url)}" alt="${html(story.title)}" loading="lazy">`
    :'<span class="story-placeholder" aria-hidden="true">🛍️</span>';
  return `<article class="story-offer-card"><div class="story-offer-media">${image}</div><div class="story-offer-body"><div class="card-kicker"><span class="source">${html(source)}</span><time>${html(ageLabel(story.published_at,now))}</time></div><h2>${html(story.title)}</h2><span class="price">${html(money(story.price))}</span><a class="buy" href="/story-go/${encodeURIComponent(story.media_id)}" rel="nofollow sponsored">Ver esta oferta ↗</a></div></article>`;
}

export async function onRequestGet({env}) {
  const now=Math.floor(Date.now()/1000);
  let stories=[];
  try {
    const result=await env.DB.prepare(`SELECT s.media_id,s.offer_id,s.title,s.price,s.published_at,
      o.image_url,o.shop,o.source
      FROM instagram_story_offers s
      LEFT JOIN offers o ON o.id=s.offer_id
      WHERE s.published_at>=? AND s.expires_at>?
        AND (o.availability IS NULL OR o.availability!='unavailable')
      ORDER BY s.published_at DESC LIMIT 48`).bind(now-STORY_LIFETIME,now).all();
    stories=result.results||[];
  } catch (error) {
    if(!String(error?.message||error).toLowerCase().includes('no such table')) throw error;
  }
  const canonical=`${SITE}/stories`;
  const title='Ofertas dos Stories do Instagram | Tá Barato';
  const description='Encontre as ofertas publicadas nos Stories do Tá Barato nas últimas 24 horas.';
  const content=stories.length
    ?`<div class="story-offer-grid">${stories.map(story=>card(story,now)).join('')}</div>`
    :'<div class="empty"><span>⏳</span><h2>Nenhum Story ativo agora</h2><p>Veja as ofertas mais recentes do canal enquanto preparamos os próximos Stories.</p><a class="buy" href="/?sort=recent">Ver ofertas recentes</a></div>';
  const telegram=`<section class="stories-telegram"><div><p class="eyebrow">OFERTAS EM TEMPO REAL</p><h2>Entre no canal gratuito do Telegram</h2><p>Receba as oportunidades assim que forem encontradas e não dependa do algoritmo das redes sociais.</p></div><a class="buy" href="https://t.me/CanalTaBarato" rel="noopener noreferrer">Entrar no Telegram ↗</a></section>`;
  return responseHtml(`<!doctype html><html lang="pt-BR"><head>${head({title,description,canonical})}</head><body>${header()}<main class="stories-page"><div class="collection-heading"><p class="eyebrow">VISTO NO INSTAGRAM</p><h1>Ofertas dos Stories</h1><p>As ofertas publicadas nas últimas 24 horas aparecem aqui, com as mais recentes primeiro. Escolha o produto que você viu no Story.</p><strong>${stories.length} ${stories.length===1?'oferta ativa':'ofertas ativas'}</strong></div>${telegram}${content}<p class="stories-note">Preços e estoque podem mudar. Os links podem gerar comissão para o canal, sem custo adicional para você.</p></main>${footer()}</body></html>`,200,'public, max-age=60, stale-while-revalidate=180');
}
