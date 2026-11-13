const campo = document.getElementById("lista");
const nome = document.getElementById("nome");
const estado = document.getElementById("estado");
const vitrine = document.getElementById("vitrine");
const token = document.getElementById("token");
const envio = document.getElementById("envio");

const tags = [...document.querySelectorAll(".tag")];
const descontoMin = document.getElementById("desconto-min");
const vendasMin = document.getElementById("vendas-min");
const ordenarVendas = document.getElementById("ordenar-vendas");

chrome.storage.sync.get(["listaId", "listaNome", "vitrine", "filtroTags", "descontoMin", "soOfertas", "vendasMin", "ordenarVendas"]).then((valores) => {
  campo.value = valores.listaId || "2ZUSMM2BR8LVZ";
  nome.value = valores.listaNome || "Ofertas";
  vitrine.value = valores.vitrine || "emersonpettor";
  // "soOfertas" era a opção da versão 1.3, antes de existir a escolha de tags.
  const marcadas = valores.filtroTags || (valores.soOfertas ? ["oferta"] : []);
  for (const caixa of tags) caixa.checked = marcadas.includes(caixa.value);
  descontoMin.value = valores.descontoMin || "";
  vendasMin.value = String(valores.vendasMin || 0);
  ordenarVendas.checked = Boolean(valores.ordenarVendas);
});

function salvarFiltro() {
  chrome.storage.sync.set({
    filtroTags: tags.filter((caixa) => caixa.checked).map((caixa) => caixa.value),
    descontoMin: Math.min(95, Math.max(0, Number(descontoMin.value) || 0)),
    vendasMin: Number(vendasMin.value) || 0,
    ordenarVendas: ordenarVendas.checked,
  });
}
for (const caixa of tags) caixa.addEventListener("change", salvarFiltro);
descontoMin.addEventListener("input", salvarFiltro);
vendasMin.addEventListener("change", salvarFiltro);
ordenarVendas.addEventListener("change", salvarFiltro);

document.getElementById("salvar").addEventListener("click", async () => {
  const valor = campo.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{8,20}$/.test(valor)) {
    estado.textContent = "Código inválido.";
    return;
  }
  const loja = vitrine.value.trim();
  if (!/^[\w-]{1,64}$/.test(loja)) {
    estado.textContent = "Vitrine inválida.";
    return;
  }
  await chrome.storage.sync.set({ listaId: valor, listaNome: nome.value.trim() || "Ofertas", vitrine: loja });
  estado.textContent = "Salvo.";
});

function mostrarEnvio(ultimo) {
  if (!ultimo) {
    envio.textContent = "Nenhum envio ainda.";
    return;
  }
  const quando = new Date(ultimo.em).toLocaleString("pt-BR");
  envio.textContent = ultimo.ok
    ? `Último envio: ${quando} · ${ultimo.produtos} produtos em ${ultimo.paginas} página(s).`
    : `Último envio falhou (${quando}): ${ultimo.erro}`;
}

chrome.storage.local.get(["tokenSite", "ultimoEnvio"]).then((valores) => {
  token.placeholder = valores.tokenSite ? "token salvo (cole outro para trocar)" : token.placeholder;
  mostrarEnvio(valores.ultimoEnvio);
});

document.getElementById("salvar-token").addEventListener("click", async () => {
  const valor = token.value.trim();
  if (valor.length < 20) {
    envio.textContent = "Token curto demais.";
    return;
  }
  await chrome.storage.local.set({ tokenSite: valor });
  token.value = "";
  token.placeholder = "token salvo (cole outro para trocar)";
  await enviarAgora(); // confere o token na hora, sem esperar o próximo alarme
});

async function enviarAgora() {
  envio.textContent = "Enviando…";
  await chrome.runtime.sendMessage({ tipo: "enviar-lista" });
  mostrarEnvio((await chrome.storage.local.get("ultimoEnvio")).ultimoEnvio);
}

document.getElementById("enviar").addEventListener("click", enviarAgora);

const limpezaAtiva = document.getElementById("limpeza-ativa");
const limpezaDias = document.getElementById("limpeza-dias");
const limpezaDesconto = document.getElementById("limpeza-desconto");
const limpezaEstado = document.getElementById("limpeza");

function mostrarLimpeza(ultima) {
  if (!ultima) {
    limpezaEstado.textContent = "Nenhuma limpeza ainda.";
    return;
  }
  const quando = new Date(ultima.em).toLocaleString("pt-BR");
  limpezaEstado.textContent = ultima.ok
    ? `Última limpeza: ${quando} · ${ultima.removidos} removido(s) de ${ultima.lidos} ` +
      `(${ultima.sem_promocao} sem promoção, ${ultima.desconto_baixo} com desconto baixo).`
    : `Última limpeza falhou (${quando}): ${ultima.erro}`;
}

chrome.storage.sync.get(["limpezaAtiva", "limpezaDias", "limpezaDescontoMin"]).then((v) => {
  limpezaAtiva.checked = v.limpezaAtiva !== false;
  limpezaDias.value = v.limpezaDias || "";
  limpezaDesconto.value = v.limpezaDescontoMin ?? "";
});
chrome.storage.local.get("ultimaLimpeza").then((v) => mostrarLimpeza(v.ultimaLimpeza));

function salvarLimpeza() {
  chrome.storage.sync.set({
    limpezaAtiva: limpezaAtiva.checked,
    limpezaDias: Math.min(30, Math.max(1, Number(limpezaDias.value) || 3)),
    limpezaDescontoMin: Math.min(90, Math.max(0, Number(limpezaDesconto.value) || 20)),
  });
}
limpezaAtiva.addEventListener("change", salvarLimpeza);
limpezaDias.addEventListener("input", salvarLimpeza);
limpezaDesconto.addEventListener("input", salvarLimpeza);

document.getElementById("limpar-agora").addEventListener("click", async () => {
  await chrome.storage.local.set({ ultimaLimpeza: null, limpezaTrava: 0 });
  limpezaEstado.textContent = "Agendada: abra ou recarregue uma página da Amazon e aguarde alguns minutos.";
});
