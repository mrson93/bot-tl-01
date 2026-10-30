// Lê a lista de ideias da Amazon a partir deste navegador (IP de casa, que a
// Amazon não recusa como faz com o GitHub) e guarda a cópia no site. O bot do
// canal usa essa cópia em vez de baixar a lista ele mesmo.
const SITE = "https://canaltabarato.com.br/api/amazon-list";
const PADRAO = { listaId: "2ZUSMM2BR8LVZ", vitrine: "emersonpettor" };
const ALARME = "enviar-lista";
const INTERVALO_MINUTOS = 30;
const MAX_PAGINAS = 8;
const ESTADO_ROLAGEM = /data-a-state="\{&quot;key&quot;:&quot;listScrollState&quot;\}">(\{.*?\})<\/script>/s;
const TOKEN_PAGINA = /name="pageToken" value="([^"]+)"/;
const MAIS_PAGINAS = /name="shouldListLoadMoreFlag" value="(\w+)"/;

function desescapar(texto) {
  return texto.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// Scripts e estilos são a maior parte da página e o bot não usa nada deles.
function enxugar(html) {
  return html.replace(/<script(?![^>]*listScrollState)[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

async function baixar(url) {
  // Sem cookies: a cópia deve ser a vitrine pública, igual à que o bot leria.
  const resposta = await fetch(url, { credentials: "omit", cache: "no-store" });
  if (!resposta.ok) throw new Error(`A Amazon respondeu ${resposta.status}`);
  return resposta.text();
}

async function lerLista(listaId, vitrine) {
  const primeira = await baixar(`https://www.amazon.com.br/shop/${vitrine}/list/${listaId}`);
  const paginas = [primeira];
  const achado = primeira.match(ESTADO_ROLAGEM);
  let estado = {};
  try { estado = achado ? JSON.parse(achado[1]) : {}; } catch { estado = {}; }
  let token = estado.pageToken, continuar = estado.shouldListLoadMoreFlag;
  while (token && continuar && paginas.length < MAX_PAGINAS) {
    await new Promise((r) => setTimeout(r, 1500));
    let pagina;
    try {
      pagina = await baixar(`https://www.amazon.com.br/shop/${vitrine}/api/listItems?`
        + new URLSearchParams({ listId: listaId, pageToken: token }));
    } catch {
      break; // fica com as páginas que já vieram
    }
    paginas.push(pagina);
    const proximo = pagina.match(TOKEN_PAGINA);
    token = proximo ? desescapar(proximo[1]) : null;
    const mais = pagina.match(MAIS_PAGINAS);
    continuar = Boolean(mais && mais[1].toLowerCase() === "true");
  }
  return paginas.map(enxugar);
}

async function enviarLista() {
  const { tokenSite } = await chrome.storage.local.get("tokenSite");
  const opcoes = { ...PADRAO, ...(await chrome.storage.sync.get(["listaId", "vitrine"])) };
  let resultado;
  try {
    if (!tokenSite) throw new Error("Falta salvar o token do site.");
    const paginas = await lerLista(opcoes.listaId, opcoes.vitrine);
    const produtos = paginas.reduce((n, p) => n + (p.match(/single-product-item-link/g) || []).length, 0);
    if (!produtos) throw new Error("A página da lista veio sem produtos.");
    const resposta = await fetch(SITE, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenSite}`, "Content-Type": "application/json" },
      body: JSON.stringify({ list_id: opcoes.listaId, pages: paginas }),
    });
    if (resposta.status === 401) throw new Error("O site recusou o token. Confira nas opções.");
    if (!resposta.ok) throw new Error(`O site respondeu ${resposta.status}`);
    resultado = { ok: true, produtos, paginas: paginas.length };
  } catch (erro) {
    resultado = { ok: false, erro: String(erro?.message || erro) };
  }
  await chrome.storage.local.set({ ultimoEnvio: { ...resultado, em: Date.now() } });
  return resultado;
}

function agendar() {
  chrome.alarms.create(ALARME, { delayInMinutes: 1, periodInMinutes: INTERVALO_MINUTOS });
}

chrome.runtime.onInstalled.addListener(agendar);
chrome.runtime.onStartup.addListener(agendar);
chrome.alarms.onAlarm.addListener((alarme) => {
  if (alarme.name === ALARME) enviarLista();
});
// Botão "Enviar agora" das opções.
chrome.runtime.onMessage.addListener((mensagem, _remetente, responder) => {
  if (mensagem?.tipo !== "enviar-lista") return false;
  enviarLista().then(responder);
  return true;
});
