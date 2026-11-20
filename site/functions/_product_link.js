// Reconhece o produto pelo link (ASIN da Amazon ou MLB do Mercado Livre).
// Mesma regra do painel privado (telegram-control/src/monitor.js).

const HOSTS_ML = ["mercadolivre.com.br", "mercadolivre.com"];
const HOSTS_AMAZON = ["amazon.com.br"];
const HOSTS_CURTOS = ["meli.la", "amzn.to", "mercadolivre.com"];
const IDENTIFICACAO = { "User-Agent": "TaBaratoAlertaBot/1.0 (+https://canaltabarato.com.br)" };

function hostDe(url, hosts) {
  const host = url.hostname.toLowerCase();
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

function lerUrl(valor) {
  try {
    const url = new URL(String(valor || "").trim());
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function parseProductLink(valor) {
  const url = lerUrl(valor);
  if (!url) return null;
  if (hostDe(url, HOSTS_AMAZON)) {
    const asin = url.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin)\/([A-Z0-9]{10})(?:[/?]|$)/i);
    return asin ? { loja: "amazon", id_produto: asin[1].toUpperCase(), tipo: null } : null;
  }
  if (hostDe(url, HOSTS_ML)) {
    const params = new URLSearchParams(`${url.search.slice(1)}&${url.hash.slice(1)}`);
    const wid = params.get("wid") || "";
    if (/^MLB\d+$/i.test(wid)) return { loja: "mercadolivre", id_produto: wid.toUpperCase(), tipo: "anuncio" };
    const catalogo = url.pathname.match(/\/p\/(MLB\d+)/i);
    if (catalogo) return { loja: "mercadolivre", id_produto: catalogo[1].toUpperCase(), tipo: "catalogo" };
    const anuncio = url.pathname.match(/\/MLB-?(\d+)/i);
    if (anuncio) return { loja: "mercadolivre", id_produto: `MLB${anuncio[1]}`, tipo: "anuncio" };
  }
  return null;
}

// Links curtos (meli.la, amzn.to): segue os redirecionamentos só entre as lojas.
export async function resolveProductLink(valor, fetchImpl = fetch) {
  let url = lerUrl(valor);
  for (let salto = 0; url && salto < 5; salto += 1) {
    const produto = parseProductLink(url.toString());
    if (produto) return produto;
    // Link "compartilhar" do programa de afiliados: abre o perfil de afiliado
    // e o produto vai codificado no parâmetro ref, sem o MLB no endereço.
    if (hostDe(url, HOSTS_ML) && /^\/social\//i.test(url.pathname)) return { erro: "perfil_afiliado" };
    if (!hostDe(url, [...HOSTS_CURTOS, ...HOSTS_ML, ...HOSTS_AMAZON])) return null;
    let resposta;
    try {
      // O meli.la recusa (403) pedidos sem User-Agent; o bot se identifica.
      resposta = await fetchImpl(url.toString(), { method: "GET", redirect: "manual", headers: IDENTIFICACAO });
    } catch {
      return null;
    }
    const destino = resposta.headers.get("Location");
    if (!destino) return null;
    url = lerUrl(new URL(destino, url).toString());
  }
  return null;
}

