// Recebe os produtos marcados e, um de cada vez, abre a página do produto
// numa aba em segundo plano, usa o próprio botão "Adicionar à Lista" da
// Amazon para gravar na lista de ofertas e fecha a aba.
const LISTA_PADRAO = "2ZUSMM2BR8LVZ"; // lista pública "Ofertas"
const fila = [];
let processando = false;

chrome.runtime.onMessage.addListener((mensagem, _remetente, responder) => {
  if (mensagem?.tipo !== "adicionar" || !/^[A-Z0-9]{10}$/.test(mensagem.asin || "")) return false;
  fila.push({ asin: mensagem.asin, responder });
  processar();
  return true; // resposta assíncrona
});

async function processar() {
  if (processando) return;
  processando = true;
  while (fila.length) {
    const { asin, responder } = fila.shift();
    let resultado;
    try {
      resultado = await adicionar(asin);
    } catch (erro) {
      resultado = { ok: false, motivo: String(erro?.message || erro).slice(0, 160) };
    }
    if (resultado.ok) {
      const { adicionados = {} } = await chrome.storage.local.get("adicionados");
      adicionados[asin] = Date.now();
      await chrome.storage.local.set({ adicionados });
    }
    try { responder(resultado); } catch { /* aba de origem fechada */ }
    // Pausa curta entre produtos, como alguém clicando com calma.
    await new Promise((r) => setTimeout(r, 1500));
  }
  processando = false;
}

function esperarCarregar(tabId) {
  return new Promise((resolve, reject) => {
    const limite = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(ouvir);
      reject(new Error("A página do produto demorou demais para abrir."));
    }, 30000);
    function ouvir(id, mudanca) {
      if (id === tabId && mudanca.status === "complete") {
        clearTimeout(limite);
        chrome.tabs.onUpdated.removeListener(ouvir);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(ouvir);
  });
}

async function adicionar(asin) {
  const { listaId = LISTA_PADRAO } = await chrome.storage.sync.get("listaId");
  const aba = await chrome.tabs.create({ url: `https://www.amazon.com.br/dp/${asin}`, active: false });
  try {
    await esperarCarregar(aba.id);
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: aba.id }, func: clicarAdicionarNaLista, args: [listaId],
    });
    return result || { ok: false, motivo: "Sem resposta da página do produto." };
  } finally {
    chrome.tabs.remove(aba.id).catch(() => {});
  }
}

// Roda dentro da página do produto: abre o menu de listas e escolhe a lista.
async function clicarAdicionarNaLista(listaId) {
  const esperar = (teste, ms = 10000) => new Promise((resolve) => {
    const inicio = Date.now();
    const tick = () => {
      const valor = teste();
      if (valor || Date.now() - inicio > ms) return resolve(valor || null);
      setTimeout(tick, 250);
    };
    tick();
  });
  const visivel = (el) => el && el.offsetParent !== null;
  const seta = await esperar(() => document.querySelector("#add-to-wishlist-button"));
  if (!seta) return { ok: false, motivo: "Botão 'Adicionar à Lista' não encontrado nesta página." };
  seta.click();
  const item = await esperar(() => document.querySelector(`#atwl-link-to-list-${listaId}`));
  if (!item) return { ok: false, motivo: "A lista de ofertas não apareceu no menu da Amazon." };
  item.click();
  const confirmacao = await esperar(() => {
    const sucesso = document.querySelector("#atwl-inline-sucess-msg, #atwl-inline");
    if (visivel(sucesso)) return "ok";
    const erro = document.querySelector("#atwl-inline-error");
    if (visivel(erro)) return "erro";
    const popover = [...document.querySelectorAll(".a-popover")].find(visivel);
    const texto = (popover?.innerText || "").toLowerCase();
    if (/adicionad|já está|ja esta|added/.test(texto)) return "ok";
    return null;
  });
  if (confirmacao === "ok") return { ok: true, detalhe: "Adicionado à lista de ofertas." };
  if (confirmacao === "erro") return { ok: false, motivo: "A Amazon recusou adicionar este item." };
  return { ok: false, motivo: "A Amazon não confirmou a inclusão. Confira a lista." };
}
