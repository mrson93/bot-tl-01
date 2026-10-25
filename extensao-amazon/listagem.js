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
  // Tags da Amazon que indicam desconto de verdade. "Oferta" não pega "Ofertas".
  const TAGS = {
    oferta: /^\s*Oferta\b(?!s)/i,
    menorPreco: /^\s*Menor preço\b/i,
    prazo: /^\s*(Termina em|Oferta Relâmpago)\b/i,
  };
  const DESCONTO = /(?:^|\s|-)(\d{1,2})\s*%(?:\s*off)?\s*$/i;
  const ESCONDIDO = "tb-sem-oferta";
  let filtro = { tags: [], descontoMin: 0 };
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
    rotulo.dataset.tbPara = asin;
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

  // As tags podem estar dentro de componentes com shadow DOM (loja de livros).
  function lerTags(raiz, achadas = { desconto: 0 }) {
    for (const no of raiz.querySelectorAll("*")) {
      if (no.shadowRoot) lerTags(no.shadowRoot, achadas);
      if (no.children.length || no.classList?.contains(MARCA)) continue;
      const texto = no.textContent;
      if (texto.length > 40) continue;
      for (const [nome, regra] of Object.entries(TAGS)) {
        if (regra.test(texto)) achadas[nome] = true;
      }
      const desconto = texto.match(DESCONTO);
      if (desconto) achadas.desconto = Math.max(achadas.desconto, Number(desconto[1]));
    }
    return achadas;
  }

  function passaNoFiltro(cartao) {
    if (!filtro.tags.length && !filtro.descontoMin) return true;
    const achadas = lerTags(cartao.shadowRoot || cartao);
    if (filtro.tags.length && !filtro.tags.some((nome) => achadas[nome])) return false;
    return achadas.desconto >= filtro.descontoMin;
  }

  function lerFiltro(valores) {
    // "soOfertas" era a opção da versão 1.3, antes de existir a escolha de tags.
    const tags = valores.filtroTags || (valores.soOfertas ? ["oferta"] : []);
    filtro = { tags, descontoMin: Number(valores.descontoMin) || 0 };
  }

  // A caixa do cartão: dentro dele ou, se o cartão está num link, logo antes do link.
  function caixaDoCartao(cartao) {
    const linkPai = cartao.closest("a");
    const vizinha = (linkPai || cartao).previousElementSibling;
    if (vizinha?.classList.contains(MARCA)) return vizinha;
    return cartao.querySelector(":scope > ." + MARCA);
  }

  // Na loja de livros o cartão fica sozinho num bloco junto com a nossa caixa:
  // esconder o bloco evita buracos no carrossel.
  function blocoDoCartao(cartao) {
    const pai = cartao.parentElement;
    const soNosso = pai && [...pai.children].every((f) => f === cartao || f.classList.contains(MARCA));
    return cartao.tagName.includes("-") && soNosso ? pai : cartao;
  }

  function filtrarOfertas() {
    for (const cartao of document.querySelectorAll("[data-tb-asin]")) {
      const esconder = !passaNoFiltro(cartao);
      blocoDoCartao(cartao).classList.toggle(ESCONDIDO, esconder);
      caixaDoCartao(cartao)?.classList.toggle(ESCONDIDO, esconder);
    }
  }

  async function marcar() {
    if (ASIN.test(location.pathname)) return; // na página do produto, use o botão da Amazon
    const { adicionados = {} } = await chrome.storage.local.get("adicionados");
    const vistos = new Set();
    for (const link of document.querySelectorAll("a[href*='/dp/'], a[href*='/gp/product/']")) {
      const asin = asinDoLink(link.getAttribute("href"));
      if (!asin || link.closest(MENU_DO_TOPO)) continue;
      const cartao = cartaoDoLink(link);
      if (!cartao || vistos.has(cartao)) continue;
      vistos.add(cartao);
      // Páginas como a de ofertas reaproveitam o cartão para outro produto ao
      // rolar e apagam a caixa: confere se ela ainda está lá e é deste produto.
      const atual = caixaDoCartao(cartao);
      if (cartao.dataset.tbAsin === asin && atual?.dataset.tbPara === asin) continue;
      atual?.remove();
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
      if (!cartao.parentElement || cartao.parentElement.closest("[data-tb-asin]")
          || cartao.querySelector("[data-tb-asin], ." + MARCA)) continue;
      const atual = caixaDoCartao(cartao);
      if (cartao.dataset.tbAsin === asin && atual?.dataset.tbPara === asin) continue;
      atual?.remove();
      cartao.dataset.tbAsin = asin;
      cartao.parentElement.insertBefore(criarCaixa(asin, Boolean(adicionados[asin])), cartao);
    }
    filtrarOfertas();
  }

  let agendado = null;
  new MutationObserver(() => {
    clearTimeout(agendado);
    agendado = setTimeout(marcar, 400);
  }).observe(document.body, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener((mudancas, area) => {
    if (area !== "sync" || !["filtroTags", "descontoMin", "soOfertas"].some((c) => c in mudancas)) return;
    chrome.storage.sync.get(["filtroTags", "descontoMin", "soOfertas"]).then((valores) => {
      lerFiltro(valores);
      filtrarOfertas();
    });
  });
  // As tags dentro de shadow DOM aparecem depois, sem avisar o observador acima.
  setInterval(() => { if (filtro.tags.length || filtro.descontoMin) filtrarOfertas(); }, 1500);
  chrome.storage.sync.get(["filtroTags", "descontoMin", "soOfertas"]).then((valores) => {
    lerFiltro(valores);
    marcar();
  });
})();
