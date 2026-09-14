const SHORT_CODE=/^(?:[A-Za-z0-9]{8}|[a-f0-9]{16})$/;

export function onRequestGet(context) {
  const slug=String(context.params.slug||'');
  // Só os códigos do encurtador pertencem a esta rota. Qualquer outro nome
  // continua para os arquivos e páginas normais do site.
  if(!SHORT_CODE.test(slug)) return context.next();
  return new Response(null,{status:302,headers:{
    Location:`https://go.canaltabarato.com.br/${slug}`,
    'Cache-Control':'no-store',
    'Referrer-Policy':'no-referrer',
  }});
}
