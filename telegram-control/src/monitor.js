// Monitor de preços: comandos do chat de admin e disparo da coleta a cada N horas.
// Os dados ficam no D1 do site (binding MONITOR_DB); a coleta e os posts rodam
// no bot (GitHub Actions), que já tem as credenciais das lojas.

const HOSTS_ML = ["mercadolivre.com.br", "mercadolivre.com"];
const HOSTS_AMAZON = ["amazon.com.br"];
const HOSTS_CURTOS = ["meli.la", "amzn.to", "mercadolivre.com"];
const LOJA = { mercadolivre: "Mercado Livre", amazon: "Amazon" };

function hostDe(url, hosts) {
  const host = url.hostname.toLowerCase();
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

function lerUrl(valor) {
  try {
    const url = new URL(String(valor || "").trim());
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

// Reconhece o produto pelo link: ASIN da Amazon ou MLB do Mercado Livre.
export function parseProductLink(valor) {
  const url = lerUrl(valor);
  if (!url) return null;
  if (hostDe(url, HOSTS_AMAZON)) {
    const asin = url.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin)\/([A-Z0-9]{10})(?:[/?]|$)/i);
    return asin ? { loja: "amazon", id_produto: asin[1].toUpperCase(), tipo: null } : null;
  }
  if (hostDe(url, HOSTS_ML)) {
    const params = new URLSearchParams(`${url.search.slice(1)}&${url.hash.slice(1)}`);
    const wid = params.get("wid") || "";
    if (/^MLB\d+$/i.test(wid)) return { loja: "mercadolivre", id_produto: wid.toUpperCase(), tipo: "anuncio" };
    const catalogo = url.pathname.match(/\/p\/(MLB\d+)/i);
    if (catalogo) return { loja: "mercadolivre", id_produto: catalogo[1].toUpperCase(), tipo: "catalogo" };
    const anuncio = url.pathname.match(/\/MLB-?(\d+)/i);
    if (anuncio) return { loja: "mercadolivre", id_produto: `MLB${anuncio[1]}`, tipo: "anuncio" };
  }
  return null;
}

// Links curtos (meli.la, amzn.to): segue os redirecionamentos só entre as lojas.
export async function resolveProductLink(valor, fetchImpl = fetch) {
  let url = lerUrl(valor);
  for (let salto = 0; url && salto < 5; salto += 1) {
    const produto = parseProductLink(url.toString());
    if (produto) return produto;
    if (!hostDe(url, [...HOSTS_CURTOS, ...HOSTS_ML, ...HOSTS_AMAZON])) return null;
    let resposta;
    try {
      resposta = await fetchImpl(url.toString(), { method: "GET", redirect: "manual" });
    } catch {
      return null;
    }
    const destino = resposta.headers.get("Location");
    if (!destino) return null;
    url = lerUrl(new URL(destino, url).toString());
  }
  return null;
}

function idValido(valor) {
  const id = Number.parseInt(String(valor || "").replace(/^#/, ""), 10);
  return Number.isInteger(id) && id > 0 && String(id) === String(valor || "").replace(/^#/, "") ? id : null;
}

function reais(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dataCurta(epoch) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(Number(epoch) * 1000));
}

function nomeDe(produto) {
  return produto.nome || `${LOJA[produto.loja]} ${produto.id_produto} (nome na próxima leitura)`;
}

export const MONITOR_COMMANDS = ["add", "remover", "lista", "teste_monitor"];

export function isMonitorCommand(name, args) {
  if (MONITOR_COMMANDS.includes(name)) return true;
  return ["historico", "histórico"].includes(name) && idValido(args[0]) !== null;
}

export async function handleMonitorCommand({ name, rawText, env, reply, dispatch, fetchImpl = fetch }) {
  const db = env.MONITOR_DB;
  if (!db) return reply("⚠️ O monitor de preços ainda não está ligado ao banco (binding MONITOR_DB).");
  const argumento = String(rawText || "").trim().split(/\s+/).slice(1).join(" ");
  const agora = Math.floor(Date.now() / 1000);

  if (name === "teste_monitor") {
    await dispatch("monitor_teste");
    return reply("🧪 Teste do monitor solicitado. A prévia chega nesta conversa em 1 a 2 minutos, sem ir para o canal.");
  }

  if (name === "add") {
    if (!argumento) return reply("Use: /add <link do produto na Amazon ou no Mercado Livre>");
    const produto = await resolveProductLink(argumento, fetchImpl);
    if (!produto) {
      return reply("❌ Não reconheci o produto. Mande o link da página do produto na Amazon (com /dp/ASIN) ou no Mercado Livre (com MLB).");
    }
    const linha = await db.prepare(
      `INSERT INTO monitor_produtos(loja,id_produto,tipo,ativo,criado_em) VALUES(?,?,?,1,?)
       ON CONFLICT(loja,id_produto) DO UPDATE SET ativo=1,tipo=COALESCE(excluded.tipo,monitor_produtos.tipo)
       RETURNING id,nome`,
    ).bind(produto.loja, produto.id_produto, produto.tipo, agora).first();
    const avisoAmazon = produto.loja === "amazon"
      ? "\n\n⏳ A Amazon ainda não liberou a API oficial para a sua conta (precisa de 10 vendas em 30 dias). O produto fica cadastrado e começa a ser lido assim que liberar."
      : "";
    if (produto.loja === "mercadolivre") {
      try { await dispatch("monitor_precos"); } catch { /* a coleta normal lê depois */ }
    }
    return reply(
      `✅ Produto #${linha.id} no monitor: ${LOJA[produto.loja]} ${produto.id_produto}${linha.nome ? `\n${linha.nome}` : ""}.\n\n`
      + "A primeira leitura chega em poucos minutos. Ele só pode ir para o canal depois de 7 dias de histórico."
      + avisoAmazon,
    );
  }

  if (name === "remover") {
    const id = idValido(argumento);
    if (!id) return reply("Use: /remover <id> (veja os ids em /lista)");
    const linha = await db.prepare("UPDATE monitor_produtos SET ativo=0 WHERE id=? RETURNING id,loja,id_produto,nome").bind(id).first();
    if (!linha) return reply(`Não existe produto #${id} no monitor.`);
    await db.prepare("DELETE FROM monitor_fila WHERE produto_id=?").bind(id).run();
    return reply(`🗑 #${id} saiu do monitor: ${nomeDe(linha)}.\nO histórico fica guardado; /add com o mesmo link reativa.`);
  }

  if (name === "lista") {
    const { results = [] } = await db.prepare(
      `SELECT p.id,p.loja,p.id_produto,p.nome,
         (SELECT preco FROM monitor_leituras l WHERE l.produto_id=p.id AND l.preco>0 ORDER BY l.lido_em DESC LIMIT 1) AS ultimo,
         (SELECT disponivel FROM monitor_leituras l WHERE l.produto_id=p.id ORDER BY l.lido_em DESC LIMIT 1) AS disponivel,
         EXISTS(SELECT 1 FROM monitor_fila f WHERE f.produto_id=p.id) AS na_fila
       FROM monitor_produtos p WHERE p.ativo=1 ORDER BY p.id LIMIT 60`,
    ).all();
    if (!results.length) return reply("📭 Nenhum produto no monitor. Use /add <link>.");
    const linhas = results.map((p) => {
      const preco = p.ultimo ? `R$ ${reais(p.ultimo)}` : "sem leitura";
      const estoque = p.disponivel === 0 ? " · sem estoque" : "";
      const fila = p.na_fila ? " · 🌙 na fila" : "";
      return `#${p.id} ${LOJA[p.loja]}: ${nomeDe(p).slice(0, 70)}\n   ${preco}${estoque}${fila}`;
    });
    let texto = `📋 Monitor de preços (${results.length})\n\n`;
    for (const linha of linhas) {
      if (texto.length + linha.length > 3800) { texto += "\n…"; break; }
      texto += `${linha}\n`;
    }
    return reply(`${texto}\nDetalhes: /historico <id>`);
  }

  // /historico <id>
  const id = idValido(argumento);
  const dias = Number.parseInt(env.MONITOR_DIAS_HISTORICO || "90", 10) || 90;
  const produto = await db.prepare("SELECT id,loja,id_produto,nome,ativo FROM monitor_produtos WHERE id=?").bind(id).first();
  if (!produto) return reply(`Não existe produto #${id} no monitor.`);
  const resumo = await db.prepare(
    `SELECT MIN(preco) AS minimo,MAX(preco) AS maximo,AVG(preco) AS media,COUNT(*) AS leituras,MIN(lido_em) AS desde
     FROM monitor_leituras WHERE produto_id=? AND lido_em>=? AND disponivel=1 AND preco>0`,
  ).bind(id, agora - dias * 86400).first();
  const ultima = await db.prepare(
    "SELECT preco,disponivel,lido_em FROM monitor_leituras WHERE produto_id=? ORDER BY lido_em DESC LIMIT 1",
  ).bind(id).first();
  const post = await db.prepare(
    "SELECT preco,postado_em FROM monitor_posts WHERE produto_id=? ORDER BY postado_em DESC LIMIT 1",
  ).bind(id).first();
  const linhas = [`📈 #${id} ${nomeDe(produto)}`, `${LOJA[produto.loja]} ${produto.id_produto}${produto.ativo ? "" : " · removido"}`, ""];
  if (!resumo?.leituras) {
    linhas.push(`Ainda não há leituras com estoque nos últimos ${dias} dias.`);
  } else {
    const diasColetados = Math.max(1, Math.round((agora - resumo.desde) / 86400));
    linhas.push(
      `Últimos ${dias} dias (${resumo.leituras} leituras em ${diasColetados} dia(s)):`,
      `⬇️ Mínimo: R$ ${reais(resumo.minimo)}`,
      `⬆️ Máximo: R$ ${reais(resumo.maximo)}`,
      `➗ Média: R$ ${reais(resumo.media)}`,
    );
  }
  if (ultima) {
    linhas.push("", `Última leitura (${dataCurta(ultima.lido_em)}): ${ultima.preco ? `R$ ${reais(ultima.preco)}` : "sem preço"}${ultima.disponivel ? "" : " · sem estoque"}`);
  }
  if (post) linhas.push(`Último post: R$ ${reais(post.preco)} em ${dataCurta(post.postado_em)}`);
  return reply(linhas.join("\n"));
}

// Disparo da coleta: no minuto 7 das horas múltiplas do intervalo (Brasília).
export function monitorDue(hour, minute, intervalHours) {
  const intervalo = Math.min(24, Math.max(1, Number.parseInt(intervalHours, 10) || 2));
  return Number(minute) === 7 && Number(hour) % intervalo === 0;
}
