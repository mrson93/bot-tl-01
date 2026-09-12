export async function onRequestGet({params,env}) {
  const match=/^([a-f0-9]{32})\.jpg$/.exec(String(params.id||''));
  if(!match) return new Response('Not found',{status:404});
  const now=Math.floor(Date.now()/1000);
  const row=await env.DB.prepare('SELECT image FROM story_assets WHERE id=? AND expires_at>?').bind(match[1],now).first();
  if(!row?.image) return new Response('Not found',{status:404});
  return new Response(row.image,{headers:{
    'Content-Type':'image/jpeg',
    'Content-Length':String(row.image.byteLength),
    'Content-Disposition':'inline; filename="story.jpg"',
    'Cache-Control':'public, max-age=86400, immutable',
    'X-Content-Type-Options':'nosniff',
  }});
}

// Alguns rastreadores fazem HEAD antes do GET. Responder com os mesmos
// cabeçalhos evita que a Meta interprete a ausência de corpo nesse primeiro
// passo como uma mídia inválida.
export async function onRequestHead(context) {
  const response=await onRequestGet(context);
  return new Response(null,{status:response.status,headers:response.headers});
}
