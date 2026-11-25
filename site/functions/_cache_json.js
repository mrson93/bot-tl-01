// Resultado de consulta guardado no cache da Cloudflare (por data center) por
// alguns minutos. As páginas mais visitadas por robôs repetiam as mesmas
// consultas pesadas a cada visita e estouraram a cota diária de leituras do D1
// (5 milhões de linhas no plano gratuito, 25/11/2026).
const ORIGEM='https://cache.canaltabarato.internal/';

export async function cachedJson(chave,ttlSegundos,produzir,cache=globalThis.caches?.default) {
  if(!cache) return produzir();
  const pedido=new Request(ORIGEM+encodeURIComponent(chave));
  try{
    const salvo=await cache.match(pedido);
    if(salvo) return await salvo.json();
  }catch{ /* cache indisponível: consulta direto */ }
  const valor=await produzir();
  try{
    await cache.put(pedido,new Response(JSON.stringify(valor),{headers:{
      'Content-Type':'application/json','Cache-Control':`public, max-age=${Math.max(1,Math.floor(ttlSegundos))}`}}));
  }catch{ /* sem cache, o valor vale do mesmo jeito */ }
  return valor;
}
