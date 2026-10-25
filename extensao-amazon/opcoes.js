const campo = document.getElementById("lista");
const nome = document.getElementById("nome");
const estado = document.getElementById("estado");

const soOfertas = document.getElementById("so-ofertas");

chrome.storage.sync.get(["listaId", "listaNome", "soOfertas"]).then(({ listaId, listaNome, soOfertas: ligado }) => {
  campo.value = listaId || "2ZUSMM2BR8LVZ";
  nome.value = listaNome || "Ofertas";
  soOfertas.checked = Boolean(ligado);
});

soOfertas.addEventListener("change", () => {
  chrome.storage.sync.set({ soOfertas: soOfertas.checked });
});

document.getElementById("salvar").addEventListener("click", async () => {
  const valor = campo.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{8,20}$/.test(valor)) {
    estado.textContent = "Código inválido.";
    return;
  }
  await chrome.storage.sync.set({ listaId: valor, listaNome: nome.value.trim() || "Ofertas" });
  estado.textContent = "Salvo.";
});
