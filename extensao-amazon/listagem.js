// Coloca um checkbox em cada produto das páginas de listagem da Amazon
// (Ofertas do Dia, busca, mais vendidos...). Ao marcar, pede ao background
// para adicionar o produto à lista de ofertas, sem sair da página.
(() => {
  const ASIN = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?=[/?#]|$)/;
  const MARCA = "tb-lista-ofertas";

  function asinDoLink(href) {
    const achado = String(href || "").match(ASIN);
    return achado ? achado[1] : null;
  }

  // Na própria página do produto o botão da Amazon já resolve.
  function paginaDeProduto() {
    return ASIN.test(location.pathname);
  }

  function cartaoDoLink(link) {
    return link.closest("[data-asin]:not([data-asin=''])")
      || link.closest("[data-testid*='card' i], [class*='card' i], .s-result-item, li")
      || link.parentElement;
  }

  function aplicarEstado(caixa, estado, detalhe) {
    const rotulo = caixa.parentElement;
    rotulo.dataset.estado = estado;
    const texto = rotulo.querySelector("span");
    texto.textContent = {
      livre: "Adicionar às Ofertas",
      enviando: "Adicionando…",
      ok: "Na lista de Ofertas ✓",
      erro: "Não deu certo, tente de novo",
    }[estado];
    rotulo.title = detalhe || "";
    caixa.checked = estado === "ok" || estado === "enviando";
    caixa.disabled = estado === "enviando" || estado === "ok";
  }

  function criarCaixa(asin, jaAdicionado) {
    const rotulo = document.createElement("label");
    rotulo.className = MARCA;
    rotulo.addEventListener("click", (evento) => evento.stopPropagation());
    const caixa = document.createElement("input");
    caixa.type = "checkbox";
    const texto = document.createElement("span");
    rotulo.append(caixa, texto);
    aplicarEstado(caixa, jaAdicionado ? "ok" : "livre");
    caixa.addEventListener("change", (evento) => {
      evento.stopPropagation();
      if (!caixa.checked) return;
      aplicarEstado(caixa, "enviando");
      chrome.runtime.sendMessage({ tipo: "adicionar", asin }, (resposta) => {
        if (chrome.runtime.lastError || !resposta) {
          aplicarEstado(caixa, "erro", "A extensão não respondeu.");
        } else if (resposta.ok) {
          aplicarEstado(caixa, "ok", resposta.detalhe);
        } else {
          aplicarEstado(caixa, "erro", resposta.motivo);
        }
      });
    });
    return rotulo;
  }

  async function marcar() {
    if (paginaDeProduto()) return;
    const { adicionados = {} } = await chrome.storage.local.get("adicionados");
    const vistos = new Set();
    for (const link of document.querySelectorAll("a[href*='/dp/'], a[href*='/gp/product/']")) {
      const asin = asinDoLink(link.getAttribute("href"));
      if (!asin) continue;
      const cartao = cartaoDoLink(link);
      if (!cartao || cartao.dataset.tbAsin || vistos.has(cartao)) continue;
      vistos.add(cartao);
      cartao.dataset.tbAsin = asin;
      const caixa = criarCaixa(asin, Boolean(adicionados[asin]));
      // Dentro de um link, o clique abriria o produto: fica logo antes dele.
      const linkPai = cartao.closest("a");
      if (linkPai && linkPai.parentElement) {
        linkPai.parentElement.insertBefore(caixa, linkPai);
      } else {
        cartao.prepend(caixa);
      }
    }
  }

  let agendado = null;
  new MutationObserver(() => {
    clearTimeout(agendado);
    agendado = setTimeout(marcar, 400);
  }).observe(document.body, { childList: true, subtree: true });
  marcar();
})();
