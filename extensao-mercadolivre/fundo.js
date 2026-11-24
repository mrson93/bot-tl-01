// Lê os mais vendidos do Mercado Livre neste navegador (logado, sem a
// verificação anti-robô que o Mercado Livre mostra ao servidor do bot) e
// guarda uma cópia no site. O bot usa essa cópia quando a API não traz preço.
import { lerPagina, pediuVerificacao } from "./leitura.js";

const SITE = "https://canaltabarato.com.br/api/ml-list";
const BASE = "https://www.mercadolivre.com.br/mais-vendidos/";
// Mesmas categorias que o bot usa (config.MERCADOLIVRE_CATEGORIAS).
export const CATEGORIAS_PADRAO = ["MLB1574", "MLB5726", "MLB1000", "MLB1648", "MLB1051", "MLB1246",
  "MLB1276", "MLB263532", "MLB1144", "MLB1132", "MLB1071", "MLB1430"];
const ALARME = "enviar-mais-vendidos";
const INTERVALO_MINUTOS = 60;
const POR_RODADA = 4;
const PAUSA_MS = 4000;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Lido do service worker, o Mercado Livre não recebe o login (cookie de
// terceiro) e devolve uma página vazia, sem produtos. A leitura roda dentro
// de uma aba do Mercado Livre: a que estiver aberta ou uma aberta em segundo
// plano só para isso (fechada no fim).
function esperarCarregar(abaId) {
  return new Promise((resolver) => {
    const limite = setTimeout(fim, 30000);
    function fim() {
      clearTimeout(limite);
      chrome.tabs.onUpdated.removeListener(ouvir);
      resolver();
    }
    function ouvir(id, mudanca) {
      if (id === abaId && mudanca.status === "complete") fim();
    }
    chrome.tabs.onUpdated.addListener(ouvir);
  });
}

async function abaDoMercadoLivre() {
  const abas = await chrome.tabs.query({ url: "https://www.mercadolivre.com.br/*" });
  const pronta = abas.find((aba) => aba.status === "complete") || abas[0];
  if (pronta?.id) return { id: pronta.id, temporaria: false };
  const nova = await chrome.tabs.create({ url: "https://www.mercadolivre.com.br/", active: false });
  await esperarCarregar(nova.id);
  return { id: nova.id, temporaria: true };
}

async function baixarNaAba(abaId, endereco) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId: abaId },
    func: async (url) => {
      const r = await fetch(url, { credentials: "include", cache: "no-store" });
      return { html: await r.text(), url: r.url, status: r.status };
    },
    args: [endereco],
  });
  if (!result) throw new Error("Não consegui ler a página na aba do Mercado Livre.");
  return result;
}

async function lerCategoria(abaId, categoria) {
  const pagina = await baixarNaAba(abaId, BASE + categoria);
  if (pediuVerificacao(pagina.html, pagina.url)) {
    throw new Error("O Mercado Livre pediu verificação. Abra mercadolivre.com.br e entre na conta.");
  }
  if (pagina.status >= 400) throw new Error(`O Mercado Livre respondeu ${pagina.status}`);
  const produtos = lerPagina(pagina.html, categoria);
  if (!produtos.length && pagina.html.length < 50000) {
    throw new Error("A página veio sem produtos: confira se está logado no Mercado Livre neste navegador.");
  }
  return produtos;
}

export function categoriasDaRodada(lista, inicio, quantidade = POR_RODADA) {
  if (!lista.length) return [];
  return Array.from({ length: Math.min(quantidade, lista.length) }, (_, i) => lista[(inicio + i) % lista.length]);
}

async function enviar() {
  const { tokenSite, rodizio = 0 } = await chrome.storage.local.get(["tokenSite", "rodizio"]);
  const { categorias } = await chrome.storage.sync.get("categorias");
  const lista = Array.isArray(categorias) && categorias.length ? categorias : CATEGORIAS_PADRAO;
  const escolhidas = categoriasDaRodada(lista, rodizio);
  let resultado;
  try {
    if (!tokenSite) throw new Error("Falta salvar o token do site.");
    const produtos = [];
    const aba = await abaDoMercadoLivre();
    try {
      for (const [i, categoria] of escolhidas.entries()) {
        if (i) await esperar(PAUSA_MS);
        produtos.push(...await lerCategoria(aba.id, categoria));
      }
    } finally {
      if (aba.temporaria) await chrome.tabs.remove(aba.id).catch(() => {});
    }
    if (!produtos.length) throw new Error("As páginas de mais vendidos vieram sem produtos.");
    const resposta = await fetch(SITE, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenSite}`, "Content-Type": "application/json" },
      body: JSON.stringify({ categories: escolhidas, items: produtos }),
    });
    if (resposta.status === 401) throw new Error("O site recusou o token. Confira nas opções.");
    if (!resposta.ok) throw new Error(`O site respondeu ${resposta.status}`);
    await chrome.storage.local.set({ rodizio: (rodizio + escolhidas.length) % lista.length });
    resultado = { ok: true, produtos: produtos.length, categorias: escolhidas };
  } catch (erro) {
    resultado = { ok: false, erro: String(erro?.message || erro) };
  }
  await chrome.storage.local.set({ ultimoEnvio: { ...resultado, em: Date.now() } });
  return resultado;
}

function agendar() {
  chrome.alarms.create(ALARME, { delayInMinutes: 1, periodInMinutes: INTERVALO_MINUTOS });
}

if (globalThis.chrome?.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(agendar);
  chrome.runtime.onStartup.addListener(agendar);
  chrome.alarms.onAlarm.addListener((alarme) => {
    if (alarme.name === ALARME) enviar();
  });
  // Botão "Enviar agora" das opções.
  chrome.runtime.onMessage.addListener((mensagem, _remetente, responder) => {
    if (mensagem?.tipo !== "enviar-mais-vendidos") return false;
    enviar().then(responder);
    return true;
  });
}
