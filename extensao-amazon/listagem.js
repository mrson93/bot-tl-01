// Coloca um checkbox em cada produto das páginas de listagem da Amazon
// (Ofertas do Dia, busca, mais vendidos...). Ao marcar, adiciona o produto à
// lista de ideias "Ofertas" com a mesma chamada que o botão "Adicionar à Lista"
// da Amazon faz, sem sair da página e sem abrir abas.
(() => {
  const ASIN = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?=[/?#]|$)/;
  const MARCA = "tb-lista-ofertas";
  // Menu e histórico de navegação do topo não são vitrines de produto.
  const MENU_DO_TOPO = "#navbar, #nav-main, [id^='nav-flyout'], .nav-timeline-img-holder, header";
  const LISTA_PADRAO = { listaId: "2ZUSMM2BR8LVZ", listaNome: "Ofertas" };
  let token = null;
  let fila = Promise.resolve();

  function asinDoLink(href) {
    const achado = String(href || "").match(ASIN);
    return achado ? achado[1] : null;
  }

  // O token das listas de ideias vem na página do produto (campo escondido
  // "creator-sp-csrf-form-token"); baixamos a página sem abri-la.
  async function obterToken(asin, renovar = false) {
    if (token && !renovar) return token;
    const resposta = await fetch(`/dp/${asin}`, { credentials: "include" });
    const html = await resposta.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    token = doc.querySelector("#creator-sp-csrf-form-token")?.value || null;
    if (!token) throw new Error("Não achei a permissão da Amazon. Você está logado?");
    return token;
  }

  async function enviar(asin, chave, lista) {
    const sid = (document.cookie.match(/(?:^|; )session-id=([^;]+)/) || [])[1];
    if (!sid) throw new Error("Sessão da Amazon não encontrada. Faça login.");
    const resposta = await fetch("/create/api/addToList?ref=idea_dp_ai", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "text/html,*/*",
        "anti-csrftoken-a2z": chave,
      },
      body: new URLSearchParams({ asin, sid, listId: lista.listaId, listName: lista.listaNome }),
    });
    let corpo = {};
    try { corpo = await resposta.json(); } catch { /* resposta em HTML = recusa */ }
    return { status: resposta.status, ok: resposta.ok && corpo.updateSuccessful === true, corpo };
  }

  async function adicionar(asin) {
    const lista = { ...LISTA_PADRAO, ...(await chrome.storage.sync.get(["listaId", "listaNome"])) };
    let resultado = await enviar(asin, await obterToken(asin), lista);
    if (!resultado.ok) {
      // Token vencido ou de outra sessão: pega um novo e tenta uma vez.
      resultado = await enviar(asin, await obterToken(asin, true), lista);
    }
    if (!resultado.ok) {
      throw new Error(resultado.corpo?.message || `A Amazon recusou (código ${resultado.status}).`);
    }
    const { adicionados = {} } = await chrome.storage.local.get("adicionados");
    adicionados[asin] = Date.now();
    await chrome.storage.local.set({ adicionados });
  }

  function cartaoDoLink(link) {
    return link.closest("[data-asin]:not([data-asin=''])")
      || link.closest("[data-testid*='card' i], [class*='card' i], .s-result-item, li")
      || link.parentElement;
  }

  function aplicarEstado(caixa, estado, detalhe) {
    const rotulo = caixa.parentElement;
    rotulo.dataset.estado = estado;
    rotulo.querySelector("span").textContent = {
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
    rotulo.append(caixa, document.createElement("span"));
    aplicarEstado(caixa, jaAdicionado ? "ok" : "livre");
    caixa.addEventListener("change", (evento) => {
      evento.stopPropagation();
      if (!caixa.checked) return;
      aplicarEstado(caixa, "enviando");
      // Um produto por vez, com uma pausa curta, como cliques com calma.
      fila = fila.then(async () => {
        try {
          await adicionar(asin);
          aplicarEstado(caixa, "ok", "Adicionado à lista de ofertas.");
        } catch (erro) {
          aplicarEstado(caixa, "erro", String(erro?.message || erro));
        }
        await new Promise((r) => setTimeout(r, 800));
      });
    });
    return rotulo;
  }

  async function marcar() {
    if (ASIN.test(location.pathname)) return; // na página do produto, use o botão da Amazon
    const { adicionados = {} } = await chrome.storage.local.get("adicionados");
    const vistos = new Set();
    for (const link of document.querySelectorAll("a[href*='/dp/'], a[href*='/gp/product/']")) {
      const asin = asinDoLink(link.getAttribute("href"));
      if (!asin || link.closest(MENU_DO_TOPO)) continue;
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
    // Páginas como a loja de livros usam componentes próprios sem link /dp/:
    // o código do produto fica no atributo data-csa-c-item-id do cartão.
    for (const cartao of document.querySelectorAll("[data-csa-c-type='item'][data-csa-c-item-id]")) {
      const asin = cartao.getAttribute("data-csa-c-item-id");
      if (!/^[A-Z0-9]{10}$/.test(asin || "") || cartao.closest(MENU_DO_TOPO)) continue;
      if (cartao.dataset.tbAsin || cartao.closest("[data-tb-asin]")
          || cartao.querySelector("[data-tb-asin], ." + MARCA) || !cartao.parentElement) continue;
      cartao.dataset.tbAsin = asin;
      cartao.parentElement.insertBefore(criarCaixa(asin, Boolean(adicionados[asin])), cartao);
    }
  }

  let agendado = null;
  new MutationObserver(() => {
    clearTimeout(agendado);
    agendado = setTimeout(marcar, 400);
  }).observe(document.body, { childList: true, subtree: true });
  marcar();
})();
