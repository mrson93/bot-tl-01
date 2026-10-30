const campo = document.getElementById("lista");
const nome = document.getElementById("nome");
const estado = document.getElementById("estado");
const vitrine = document.getElementById("vitrine");
const token = document.getElementById("token");
const envio = document.getElementById("envio");

const tags = [...document.querySelectorAll(".tag")];
const descontoMin = document.getElementById("desconto-min");

chrome.storage.sync.get(["listaId", "listaNome", "vitrine", "filtroTags", "descontoMin", "soOfertas"]).then((valores) => {
  campo.value = valores.listaId || "2ZUSMM2BR8LVZ";
  nome.value = valores.listaNome || "Ofertas";
  vitrine.value = valores.vitrine || "emersonpettor";
  // "soOfertas" era a opção da versão 1.3, antes de existir a escolha de tags.
  const marcadas = valores.filtroTags || (valores.soOfertas ? ["oferta"] : []);
  for (const caixa of tags) caixa.checked = marcadas.includes(caixa.value);
  descontoMin.value = valores.descontoMin || "";
});

function salvarFiltro() {
  chrome.storage.sync.set({
    filtroTags: tags.filter((caixa) => caixa.checked).map((caixa) => caixa.value),
    descontoMin: Math.min(95, Math.max(0, Number(descontoMin.value) || 0)),
  });
}
for (const caixa of tags) caixa.addEventListener("change", salvarFiltro);
descontoMin.addEventListener("input", salvarFiltro);

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
