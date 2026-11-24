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

async function baixarAqui(url) {
  const resposta = await fetch(url, { credentials: "include", cache: "no-store" });
  return { html: await resposta.text(), url: resposta.url, status: resposta.status };
}

// Plano B: a mesma leitura feita de dentro de uma aba do Mercado Livre já
// aberta (cookies de primeira parte), quando a leitura em segundo plano cai
// na verificação.
async function baixarNaAba(url) {
  const [aba] = await chrome.tabs.query({ url: "https://www.mercadolivre.com.br/*" });
  if (!aba?.id) return null;
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId: aba.id },
    func: async (endereco) => {
      const r = await fetch(endereco, { credentials: "include", cache: "no-store" });
      return { html: await r.text(), url: r.url, status: r.status };
    },
    args: [url],
  });
  return result || null;
}

async function lerCategoria(categoria) {
  const url = BASE + categoria;
  let pagina = await baixarAqui(url);
  if (pediuVerificacao(pagina.html, pagina.url)) pagina = (await baixarNaAba(url)) || pagina;
  if (pediuVerificacao(pagina.html, pagina.url)) {
    throw new Error("O Mercado Livre pediu verificação. Abra mercadolivre.com.br, entre na conta e deixe uma aba aberta.");
  }
  if (pagina.status >= 400) throw new Error(`O Mercado Livre respondeu ${pagina.status}`);
  return lerPagina(pagina.html, categoria);
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
    for (const [i, categoria] of escolhidas.entries()) {
      if (i) await esperar(PAUSA_MS);
      produtos.push(...await lerCategoria(categoria));
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
