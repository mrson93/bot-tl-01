// Lê os cupons públicos da página https://www.mercadolivre.com.br/cupons
// (bloco de dados `_n.ctx.r={...}`, landingData.groupings[].rawCoupons).
// Fica só com cupons de campanha ("Em produtos selecionados"); os de seguidor,
// de loja específica e da aba "Meus cupons" são pessoais e ficam de fora.
import { extrairObjeto } from "./leitura.js";

const GRUPOS_PESSOAIS = new Set(["my_page", "recommended"]);
const CAMPANHA = /^\d{4,15}$/;

export function valorEmReais(texto) {
  const achado = String(texto || "").match(/R\$\s*([\d.]+(?:,\d{1,2})?)/);
  if (!achado) return null;
  const valor = Number(achado[1].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(valor) && valor > 0 ? valor : null;
}

function dados(html) {
  for (const achado of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
    const corpo = achado[1];
    if (!corpo.startsWith("_n.ctx.r=") || !corpo.includes("rawCoupons")) continue;
    const json = extrairObjeto(corpo, corpo.indexOf("{"));
    try { return json ? JSON.parse(json) : null; } catch { return null; }
  }
  return null;
}

function epoch(iso) {
  const ms = Date.parse(String(iso || ""));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export function lerCupom(bruto, grupo) {
  const titulo = String(bruto?.title?.text || "").replace(/\s+/g, " ").trim();
  const subtitulo = String(bruto?.initial_subtitle?.text || "").trim();
  const campanha = String(bruto?.campaign_id || "");
  if (!CAMPANHA.test(campanha) || !titulo || titulo.length > 120) return null;
  if (/seguidor/i.test(titulo) || bruto?.is_new_follower_coupon) return null;
  if (!/^Em produtos selecionados/i.test(subtitulo)) return null;
  const info = bruto?.future_coupon_info || {};
  const minimo = String(bruto?.amount?.min_amount || "").trim();
  const limite = String(bruto?.amount?.cap_amount || "").trim();
  return {
    id: campanha,
    title: titulo,
    min_text: minimo.slice(0, 60),
    cap_text: limite.slice(0, 60),
    min_value: /sem compra m[ií]nima/i.test(minimo) ? 0 : valorEmReais(minimo),
    cap_value: valorEmReais(limite),
    starts_at: epoch(info.start_date),
    expires_at: epoch(info.expiration_date),
    group: String(grupo || "").slice(0, 30),
  };
}

// Cupons de campanha da página, sem repetir (o mesmo cupom aparece em vários grupos).
export function lerCupons(html) {
  const grupos = dados(html)?.appProps?.pageProps?.landingData?.groupings;
  if (!Array.isArray(grupos)) return [];
  const vistos = new Map();
  for (const grupo of grupos) {
    if (GRUPOS_PESSOAIS.has(grupo?.key)) continue;
    for (const bruto of Array.isArray(grupo?.rawCoupons) ? grupo.rawCoupons : []) {
      const cupom = lerCupom(bruto, grupo.key);
      if (cupom && !vistos.has(cupom.id)) vistos.set(cupom.id, cupom);
    }
  }
  return [...vistos.values()];
}
