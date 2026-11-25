// Lê os produtos da página "Mais vendidos" do Mercado Livre (o HTML traz os
// cartões num bloco de dados `_n.ctx.r={...}`). Sem DOM: roda no service worker.

const IMAGEM_PADRAO = "https://http2.mlstatic.com/D_{square}_NP{2x}_{id}-{size}{sanitized_title}.webp";
const ID = /^MLB\d{6,15}$/;
const FOTO = /^[\w-]{6,80}$/;

// Fecha o objeto JSON que começa em `inicio`, respeitando textos entre aspas.
export function extrairObjeto(texto, inicio) {
  let nivel = 0, emTexto = false, escape = false;
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];
    if (emTexto) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') emTexto = false;
      continue;
    }
    if (c === '"') emTexto = true;
    else if (c === "{") nivel++;
    else if (c === "}" && --nivel === 0) return texto.slice(inicio, i + 1);
  }
  return null;
}

function blocosDeDados(html) {
  const blocos = [];
  for (const achado of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
    const corpo = achado[1];
    if (!corpo.includes('"polycards"')) continue;
    const json = extrairObjeto(corpo, corpo.indexOf("{"));
    if (!json) continue;
    try { blocos.push(JSON.parse(json)); } catch { /* bloco que não é JSON puro */ }
  }
  return blocos;
}

// Todas as listas "polycards" do bloco, com o contexto (modelo de foto) de cada uma.
function listas(no, saida = []) {
  if (!no || typeof no !== "object") return saida;
  if (Array.isArray(no.polycards)) saida.push({ cartoes: no.polycards, contexto: no.polycard_context || {} });
  for (const valor of Object.values(no)) listas(valor, saida);
  return saida;
}

function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function imagem(cartao, contexto) {
  const id = cartao?.pictures?.pictures?.[0]?.id;
  if (!FOTO.test(String(id || ""))) return null;
  return String(contexto.picture_template || IMAGEM_PADRAO)
    .replace("{square}", contexto.picture_square_default || "Q")
    .replace("{2x}", "_2X")
    .replace("{id}", id)
    .replace("{size}", contexto.picture_size_default || "AB")
    .replace("{sanitized_title}", "");
}

function endereco(meta, contexto) {
  const bruto = String(meta?.url || "").split(/[?#]/)[0];
  if (!bruto) return null;
  const url = /^https?:\/\//.test(bruto) ? bruto : `${contexto.url_prefix || "https://"}${bruto}`;
  try {
    const partes = new URL(url);
    if (partes.protocol !== "https:" || !/(^|\.)mercadolivre\.com\.br$/.test(partes.hostname)) return null;
    return `https://${partes.hostname}${partes.pathname}`;
  } catch {
    return null;
  }
}

export function lerCartao(cartao, contexto = {}) {
  const meta = cartao?.metadata || {};
  const partes = Array.isArray(cartao?.components) ? cartao.components : [];
  const titulo = partes.find((p) => p?.type === "title")?.title?.text;
  const preco = partes.find((p) => p?.type === "price")?.price || {};
  const atual = numero(preco.current_price?.value);
  // O preço "de" vem em price_labels ({previous_price}); previous_price fica
  // como reserva caso a página volte ao formato antigo.
  const rotulo = (Array.isArray(preco.price_labels) ? preco.price_labels : [])
    .flatMap((l) => (Array.isArray(l?.values) ? l.values : []))
    .find((v) => v?.key === "previous_price");
  const anterior = numero(rotulo?.price?.value ?? preco.previous_price?.value);
  // O preço do cartão costuma ser o do Pix ("no Pix" vem num campo à parte).
  const complemento = (Array.isArray(preco.discount_complement?.values) ? preco.discount_complement.values : [])
    .map((v) => String(v?.label?.text || "")).join(" ");
  const produto = {
    id: String(meta.id || ""),
    product_id: ID.test(String(meta.product_id || "")) ? meta.product_id : null,
    title: String(titulo || "").replace(/\s+/g, " ").trim().slice(0, 300),
    price: atual,
    original_price: anterior && atual && anterior > atual ? anterior : null,
    image: imagem(cartao, contexto),
    url: endereco(meta, contexto),
    pix: /\bpix\b/i.test(complemento),
  };
  if (!ID.test(produto.id) || !produto.title || !produto.price || !produto.image || !produto.url) return null;
  return produto;
}

// Produtos da página, na ordem em que aparecem (posição = ranking de mais vendidos).
export function lerPagina(html, categoria) {
  const vistos = new Set();
  const produtos = [];
  for (const bloco of blocosDeDados(html)) {
    for (const { cartoes, contexto } of listas(bloco)) {
      for (const cartao of cartoes) {
        const produto = lerCartao(cartao, contexto);
        if (!produto || vistos.has(produto.id)) continue;
        vistos.add(produto.id);
        produtos.push({ ...produto, category: categoria, position: produtos.length + 1 });
      }
    }
  }
  return produtos;
}

export function pediuVerificacao(html, urlFinal = "") {
  return /account-verification|negative_traffic/.test(urlFinal) || /\/gz\/account-verification/.test(html.slice(0, 20000));
}
