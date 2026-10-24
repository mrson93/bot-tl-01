const campo = document.getElementById("lista");
const estado = document.getElementById("estado");

chrome.storage.sync.get("listaId").then(({ listaId }) => {
  campo.value = listaId || "2ZUSMM2BR8LVZ";
});

document.getElementById("salvar").addEventListener("click", async () => {
  const valor = campo.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{8,20}$/.test(valor)) {
    estado.textContent = "Código inválido.";
    return;
  }
  await chrome.storage.sync.set({ listaId: valor });
  estado.textContent = "Salvo.";
});
