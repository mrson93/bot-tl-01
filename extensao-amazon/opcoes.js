const campo = document.getElementById("lista");
const nome = document.getElementById("nome");
const estado = document.getElementById("estado");

const tags = [...document.querySelectorAll(".tag")];
const descontoMin = document.getElementById("desconto-min");

chrome.storage.sync.get(["listaId", "listaNome", "filtroTags", "descontoMin", "soOfertas"]).then((valores) => {
  campo.value = valores.listaId || "2ZUSMM2BR8LVZ";
  nome.value = valores.listaNome || "Ofertas";
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
  await chrome.storage.sync.set({ listaId: valor, listaNome: nome.value.trim() || "Ofertas" });
  estado.textContent = "Salvo.";
});
