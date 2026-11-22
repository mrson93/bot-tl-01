import {shopeeConfigurada,shopeeGraphql} from './_product_search.js';

// Histórico diário do catálogo: cada oferta ativa ganha um preço por dia.
// A Shopee é lida aqui, em lotes pequenos, chamada pelo painel (Cloudflare) a
// cada 15 min; Mercado Livre e AliExpress são lidos pela coleta (Python), que
// usa a mesma fila (candidatosDoDia) pelo /api/refresh-candidates?daily=1.
const FUSO=3*3600;
export const inicioDoDia=now=>Math.floor((now-FUSO)/86400)*86400+FUSO;
export const LOJAS_DIARIAS=new Set(['Shopee','Mercado Livre','AliExpress']);

// Quem ainda não foi conferido hoje (Brasília): primeiro os mais clicados.
export async function candidatosDoDia(env,source,limite,now) {
  if(!LOJAS_DIARIAS.has(source)) return [];
  const {results=[]}=await env.DB.prepare(
    `SELECT o.id,o.source,o.price FROM offers o
     LEFT JOIN (SELECT offer_id,COUNT(*) quantity FROM clicks WHERE clicked_at>=? GROUP BY offer_id) c ON c.offer_id=o.id
     WHERE o.source=? AND o.availability!='unavailable' AND COALESCE(o.last_checked_at,0)<?
     ORDER BY COALESCE(c.quantity,0) DESC,COALESCE(o.last_checked_at,0) ASC LIMIT ?`,
  ).bind(now-7*86400,source,inicioDoDia(now),Math.max(1,Math.min(20,Number(limite)||12))).all();
  return results;
}

// Um produto da Shopee: {ok:true,item} quando a API respondeu (item null = sumiu).
async function lerShopeeDiario(env,shop,item,fetcher) {
  try{
    const data=await shopeeGraphql(env,`{productOfferV2(shopId:${shop},itemId:${item},limit:1,page:1){nodes{itemId shopId priceMin price ratingStar sales}}}`,fetcher);
    const node=(data?.productOfferV2?.nodes||[]).find(n=>String(n.shopId)===shop&&String(n.itemId)===item);
    const preco=Number(node?.priceMin||node?.price);
    return {ok:true,item:preco>0?{preco,nota:Number(node.ratingStar)||null,vendas:Number(node.sales)||null}:null};
  }catch{ return {ok:false}; }
}

export function statementsDoPreco(env,id,leitura,now) {
  const dia=new Date(now*1000).toISOString().slice(0,10);
  if(!leitura) return [env.DB.prepare(`UPDATE offers SET last_checked_at=?,refresh_failures=MIN(refresh_failures+1,3),
    availability=CASE WHEN refresh_failures+1>=3 THEN 'unavailable' ELSE 'unverified' END WHERE id=?`).bind(now,id)];
  return [
    env.DB.prepare(`UPDATE offers SET price_changed_at=CASE WHEN price<>?1 THEN ?2 ELSE COALESCE(price_changed_at,?2) END,price=?1,
      rating=COALESCE(?3,rating),sales=COALESCE(?4,sales),last_checked_at=?2,last_seen_at=?2,availability='active',refresh_failures=0 WHERE id=?5`)
      .bind(leitura.preco,now,leitura.nota,leitura.vendas,id),
    env.DB.prepare(`INSERT INTO offer_prices(offer_id,observed_on,price,observed_at) SELECT id,?,?,? FROM offers WHERE id=?
      ON CONFLICT(offer_id,observed_on) DO UPDATE SET price=excluded.price,observed_at=excluded.observed_at`).bind(dia,leitura.preco,now,id),
  ];
}

export async function atualizarShopeeDoDia(env,now=Math.floor(Date.now()/1000),limite=12,fetcher=fetch) {
  if(!shopeeConfigurada(env)) return {lidos:0,encontrados:0,erro:'shopee_sem_chave'};
  const fila=await candidatosDoDia(env,'Shopee',limite,now);
  const statements=[];let encontrados=0,lidos=0;
  for(const o of fila){
    const m=String(o.id).match(/^shopee_(\d{1,15})_(\d{1,15})$/);
    if(!m) continue;
    const r=await lerShopeeDiario(env,m[1],m[2],fetcher);
    if(!r.ok) break;   // API fora: tenta de novo no próximo lote, sem marcar ninguém
    lidos++;
    if(r.item) encontrados++;
    statements.push(...statementsDoPreco(env,o.id,r.item,now));
  }
  if(statements.length) await env.DB.batch(statements);
  return {lidos,encontrados,restantes:fila.length-lidos};
}
