const token = document.getElementById("token");
const categorias = document.getElementById("categorias");
const envio = document.getElementById("envio");

function mostrarEnvio(ultimo) {
  if (!ultimo) {
    envio.textContent = "Nenhum envio ainda.";
    return;
  }
  const quando = new Date(ultimo.em).toLocaleString("pt-BR");
  envio.textContent = ultimo.ok
    ? `Último envio: ${quando} · ${ultimo.produtos} produtos (${(ultimo.categorias || []).join(", ")}).`
    : `Último envio falhou (${quando}): ${ultimo.erro}`;
}

async function enviarAgora() {
  envio.textContent = "Lendo os mais vendidos…";
  mostrarEnvio(await chrome.runtime.sendMessage({ tipo: "enviar-mais-vendidos" }).then(
    (resultado) => ({ ...resultado, em: Date.now() }),
  ));
}

chrome.storage.local.get(["tokenSite", "ultimoEnvio"]).then((valores) => {
  if (valores.tokenSite) token.placeholder = "token salvo (cole outro para trocar)";
  mostrarEnvio(valores.ultimoEnvio);
});
chrome.storage.sync.get("categorias").then(({ categorias: lista }) => {
  categorias.value = Array.isArray(lista) ? lista.join(", ") : "";
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
  await enviarAgora(); // confere o token na hora, sem esperar a próxima hora
});

document.getElementById("salvar-categorias").addEventListener("click", async () => {
  const lista = categorias.value.toUpperCase().split(/[\s,;]+/).filter(Boolean);
  if (lista.some((codigo) => !/^MLB\d{3,9}$/.test(codigo))) {
    envio.textContent = "Código de categoria inválido.";
    return;
  }
  await chrome.storage.sync.set({ categorias: lista });
  await chrome.storage.local.set({ rodizio: 0 });
  envio.textContent = lista.length ? "Categorias salvas." : "Usando as categorias do bot.";
});

document.getElementById("enviar-agora").addEventListener("click", enviarAgora);
