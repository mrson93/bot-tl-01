// Limpeza automática da lista de ideias "Ofertas".
//
// A Amazon aceita no máximo 400 produtos numa lista de ideias; cheia, ela
// recusa qualquer item novo (até pelo botão dela). A cada 3 dias, quando uma
// página da Amazon é aberta neste navegador, esta rotina remove da lista:
//   - produtos que saíram de promoção (sem preço riscado e sem selo de oferta);
//   - produtos com desconto baixo que também não são populares.
// Roda numa página da própria Amazon para usar a sessão de quem está logado.
(() => {
  if (window.top !== window) return;

  const PADRAO = {
    listaId: "2ZUSMM2BR8LVZ", vitrine: "emersonpettor",
    limpezaAtiva: true, limpezaDias: 3, limpezaDescontoMin: 20,
    limpezaAvaliacoesMin: 1000, limpezaComprasMin: 500,
  };
  const TRAVA_MINUTOS = 20;          // outra aba não começa enquanto esta limpa
  const PROTECAO_HORAS = 24;         // item recém-adicionado pela extensão fica
  const MAX_PAGINAS = 25;            // 400 itens / 20 por página
  const LOTE = 25;
  const ESTADO_ROLAGEM = /data-a-state="\{&quot;key&quot;:&quot;listScrollState&quot;\}">(\{.*?\})<\/script>/s;
  const TOKEN_PAGINA = /name="pageToken" value="([^"]+)"/;
  const MAIS_PAGINAS = /name="shouldListLoadMoreFlag" value="(\w+)"/;
  const COMPRAS = /(\d+(?:[.,]\d+)?)\s*(mil)?\s*\+?\s*compras?\b/i;

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  function desescapar(texto) {
    return texto.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  }

  function numero(texto) {
    const limpo = String(texto || "").replace(/[^\d,]/g, "").replace(",", ".");
    return limpo ? Number(limpo) : 0;
  }

  async function baixar(url, credenciais = "omit") {
    const resposta = await fetch(url, { credentials: credenciais, cache: "no-store" });
    if (!resposta.ok) throw new Error(`A Amazon respondeu ${resposta.status}`);
    return resposta.text();
  }

  // Lê a vitrine pública na ordem da lista, com preço, preço riscado e selos.
  async function lerItens(listaId, vitrine) {
    const primeira = await baixar(`/shop/${vitrine}/list/${listaId}`);
    const paginas = [primeira];
    let estado = {};
    try { estado = JSON.parse(primeira.match(ESTADO_ROLAGEM)?.[1] || "{}"); } catch { estado = {}; }
    let token = estado.pageToken, continuar = estado.shouldListLoadMoreFlag;
    while (token && continuar && paginas.length < MAX_PAGINAS) {
      await esperar(1200);
      const pagina = await baixar(`/shop/${vitrine}/api/listItems?`
        + new URLSearchParams({ listId: listaId, pageToken: token }));
      paginas.push(pagina);
      const proximo = pagina.match(TOKEN_PAGINA);
      token = proximo ? desescapar(proximo[1]) : null;
      continuar = (pagina.match(MAIS_PAGINAS)?.[1] || "").toLowerCase() === "true";
    }
    const itens = new Map();
    for (const html of paginas) {
      const doc = new DOMParser().parseFromString(html, "text/html");
      for (const card of doc.querySelectorAll("[data-asin]")) {
        const bruto = card.getAttribute("data-asin") || "";
        const link = card.querySelector(".single-product-item-link")?.getAttribute("href") || "";
        const asin = (link.match(/\/dp\/([A-Z0-9]{10})/) || bruto.match(/amzn1\.asin\.([A-Z0-9]{10})/) || [])[1];
        if (!asin || itens.has(asin)) continue;
        const preco = numero(card.querySelector(".a-offscreen")?.textContent);
        const original = numero(card.querySelector(".a-text-strike")?.textContent);
        const selo = card.querySelector(".product-badge-label")?.textContent.trim() || "";
        const mensagem = card.querySelector(".product-badge-message")?.textContent.trim() || "";
        let desconto = numero((selo.match(/(\d+)\s*%/) || [])[1]);
        if (!desconto && original > preco && preco > 0) desconto = Math.round((1 - preco / original) * 100);
        itens.set(asin, {
          asin, preco, desconto,
          promocao: Boolean(original > preco || desconto || /:amzn1\.deal\./.test(bruto) || selo || mensagem),
          titulo: card.querySelector(".product-title-text")?.textContent.trim().slice(0, 60) || asin,
        });
      }
    }
    return [...itens.values()];
  }

  // Popularidade pela página do produto: número de avaliações e o selo
  // "Mais de X compras no mês passado".
  async function popularidade(asin) {
    const html = await baixar(`/dp/${asin}`, "include");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const avaliacoes = numero(doc.querySelector("#acrCustomerReviewText")?.textContent);
    let compras = 0;
    // Só o selo do próprio produto: o resto da página traz carrosséis de outros.
    const selo = doc.querySelector("[id^='social-proofing-faceout-title']")?.textContent || "";
    const achado = selo.match(COMPRAS);
    if (achado) {
      const n = Number(achado[1].replace(",", "."));
      compras = achado[2] ? Math.round(n * 1000) : Number(achado[1].replace(/[.,]/g, ""));
    }
    return { avaliacoes, compras };
  }

  async function removerDaLista(listaId, vitrine, asins) {
    const editor = await baixar(
      `/create/collection?id=amzn1.ideas.${listaId}&affiliateId=${vitrine}`, "include");
    const csrf = new DOMParser().parseFromString(editor, "text/html")
      .querySelector("input[name=appActionToken]")?.value;
    if (!csrf) throw new Error("Não achei a permissão do editor de listas. Você está logado?");
    const cabecalhos = { "Content-Type": "application/json", "anti-csrftoken-a2z": csrf };
    const midia = { mediaAci: `amzn1.ideas.${listaId}`, ownerAffiliateId: vitrine };
    const ler = async () => {
      const resposta = await fetch("/create/api/get-shoppable-media", {
        method: "POST", credentials: "include", headers: cabecalhos, body: JSON.stringify(midia),
      });
      if (!resposta.ok) throw new Error(`O editor de listas respondeu ${resposta.status}`);
      return resposta.json();
    };
    let versao = (await ler()).lockingVersion;
    let removidos = 0, retentou = false;
    for (let i = 0; i < asins.length; i += LOTE) {
      const lote = asins.slice(i, i + LOTE);
      const resposta = await fetch("/create/api/autosave-shoppable-media", {
        method: "POST", credentials: "include", headers: cabecalhos,
        body: JSON.stringify({
          ...midia, lockingVersion: versao,
          updateProductList: lote.map((asinId) => ({ asinId, crudAction: "DELETE" })),
        }),
      });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok || corpo.hasError || corpo.lockingVersionCollision) {
        // Outra edição aconteceu no meio: relê a versão e tenta o lote uma vez.
        if (retentou) throw new Error(`A Amazon recusou a remoção (${resposta.status}); ${removidos} removidos antes disso.`);
        retentou = true;
        versao = (await ler()).lockingVersion;
        i -= LOTE;
        continue;
      }
      retentou = false;
      versao = corpo.lockingVersion ?? (await ler()).lockingVersion;
      removidos += lote.length;
      await esperar(800);
    }
    return removidos;
  }

  async function limpar(opcoes) {
    const itens = await lerItens(opcoes.listaId, opcoes.vitrine);
    if (!itens.length) throw new Error("A lista veio vazia; nada foi removido.");
    const { adicionados = {} } = await chrome.storage.local.get("adicionados");
    const protegidoAte = Date.now() - PROTECAO_HORAS * 3600 * 1000;
    const remover = [], motivos = { sem_promocao: 0, desconto_baixo: 0 };
    for (const item of itens) {
      if ((adicionados[item.asin] || 0) > protegidoAte) continue;
      if (!item.promocao) {
        remover.push(item.asin);
        motivos.sem_promocao += 1;
        continue;
      }
      if (item.desconto >= opcoes.limpezaDescontoMin) continue;
      await esperar(1500);
      let pop;
      try { pop = await popularidade(item.asin); } catch { continue; }
      if (pop.avaliacoes < opcoes.limpezaAvaliacoesMin && pop.compras < opcoes.limpezaComprasMin) {
        remover.push(item.asin);
        motivos.desconto_baixo += 1;
      }
    }
    const removidos = remover.length
      ? await removerDaLista(opcoes.listaId, opcoes.vitrine, remover) : 0;
    return { ok: true, lidos: itens.length, removidos, ...motivos };
  }

  async function talvezLimpar() {
    const opcoes = { ...PADRAO, ...(await chrome.storage.sync.get(Object.keys(PADRAO))) };
    if (!opcoes.limpezaAtiva) return;
    const { ultimaLimpeza, limpezaTrava = 0 } =
      await chrome.storage.local.get(["ultimaLimpeza", "limpezaTrava"]);
    // Depois de uma falha tenta de novo em 6 h, não em 3 dias.
    const intervalo = ultimaLimpeza && !ultimaLimpeza.ok ? 6 * 3600 * 1000
      : Math.max(1, Number(opcoes.limpezaDias) || 3) * 86400 * 1000;
    if (ultimaLimpeza && Date.now() - ultimaLimpeza.em < intervalo) return;
    if (Date.now() - limpezaTrava < TRAVA_MINUTOS * 60 * 1000) return;
    await chrome.storage.local.set({ limpezaTrava: Date.now() });
    let resultado;
    try {
      resultado = await limpar(opcoes);
    } catch (erro) {
      resultado = { ok: false, erro: String(erro?.message || erro) };
    }
    await chrome.storage.local.set({
      ultimaLimpeza: { ...resultado, em: Date.now() }, limpezaTrava: 0,
    });
  }

  // Espera a página assentar para não competir com o carregamento dela.
  setTimeout(() => { talvezLimpar().catch(() => {}); }, 8000);
})();
