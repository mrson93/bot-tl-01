// Monitor de preços: comandos do chat de admin e disparo da coleta a cada N horas.
// Os dados ficam no D1 do site (binding MONITOR_DB); a coleta e os posts rodam
// no bot (GitHub Actions), que já tem as credenciais das lojas.

const HOSTS_ML = ["mercadolivre.com.br", "mercadolivre.com"];
const HOSTS_AMAZON = ["amazon.com.br"];
const HOSTS_CURTOS = ["meli.la", "amzn.to", "mercadolivre.com", "s.shopee.com.br", "shope.ee"];
const HOSTS_SHOPEE = ["shopee.com.br"];
const LOJA = { mercadolivre: "Mercado Livre", amazon: "Amazon", shopee: "Shopee" };
const IDENTIFICACAO = { "User-Agent": "TaBaratoAlertaBot/1.0 (+https://canaltabarato.com.br)" };

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
  if (hostDe(url, HOSTS_SHOPEE)) {
    // shopee.com.br/nome-do-produto-i.LOJA.ITEM
    const nomeado = url.pathname.match(/^\/(.+)-i\.(\d+)\.(\d+)\/?$/);
    if (nomeado) return { loja: "shopee", id_produto: `${nomeado[2]}_${nomeado[3]}`, tipo: null };
    // /product/LOJA/ITEM e /opaanlp/LOJA/ITEM (destino dos links curtos s.shopee.com.br)
    const direto = url.pathname.match(/^\/[a-z_-]+\/(\d+)\/(\d+)\/?$/i);
    if (direto) return { loja: "shopee", id_produto: `${direto[1]}_${direto[2]}`, tipo: null };
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

// O "compartilhar" do programa de afiliados abre /social/<afiliado> com o
// produto codificado no ref. A página mostra o produto compartilhado como o
// primeiro link de produto (o mesmo da prévia og:title que o Telegram exibe).
// Uma leitura só, para achar o MLB; o preço continua vindo da API oficial.
async function produtoDoPerfil(url, fetchImpl) {
  try {
    const resposta = await fetchImpl(url.toString(), { method: "GET", redirect: "manual", headers: IDENTIFICACAO });
    if (resposta.status !== 200) return null;
    const html = (await resposta.text()).slice(0, 2_000_000);
    const achado = html.match(/https:\/\/www\.mercadolivre\.com\.br\/[^"'\s<>]*?\/p\/(MLB\d+)/i);
    return achado ? { loja: "mercadolivre", id_produto: achado[1].toUpperCase(), tipo: "catalogo" } : null;
  } catch {
    return null;
  }
}

// Links curtos (meli.la, amzn.to): segue os redirecionamentos só entre as lojas.
export async function resolveProductLink(valor, fetchImpl = fetch) {
  let url = lerUrl(valor);
  for (let salto = 0; url && salto < 5; salto += 1) {
    const produto = parseProductLink(url.toString());
    if (produto) return produto;
    // Link "compartilhar" do programa de afiliados: abre o perfil de afiliado
    // e o produto vai codificado no parâmetro ref, sem o MLB no endereço.
    if (hostDe(url, HOSTS_ML) && /^\/social\//i.test(url.pathname)) {
      return (await produtoDoPerfil(url, fetchImpl)) || { erro: "perfil_afiliado" };
    }
    if (!hostDe(url, [...HOSTS_CURTOS, ...HOSTS_ML, ...HOSTS_AMAZON, ...HOSTS_SHOPEE])) return null;
    let resposta;
    try {
      // O meli.la recusa (403) pedidos sem User-Agent; o bot se identifica.
      resposta = await fetchImpl(url.toString(), { method: "GET", redirect: "manual", headers: IDENTIFICACAO });
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

export const MONITOR_COMMANDS = ["add", "remover", "lista", "teste_monitor", "estatisticas", "estatísticas", "stats", "cupom", "cupons", "cupom_apagar"];

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

  if (["estatisticas", "estatísticas", "stats"].includes(name)) return reply(await estatisticas(db, agora));

  if (name === "cupom") {
    const cupom = parseCupom(String(rawText || "").replace(/^\/\S+\s*/, ""), agora);
    if (cupom.erro) return reply(`❌ ${cupom.erro}\n\n${AJUDA_CUPOM}`);
    await db.prepare(
      `INSERT INTO coupons(id,source,code,title,kind,condition,destination,active_at,expires_at,published_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
    ).bind(cupom.id, cupom.loja, cupom.codigo, cupom.titulo, cupom.codigo ? "code" : "voucher", cupom.condicao,
      cupom.link, agora, cupom.expira, agora).run();
    return reply(`✅ Cupom ${cupom.id.replace(/^painel_/, "")} no site: ${cupom.loja}${cupom.codigo ? ` · ${cupom.codigo}` : " · voucher"}`
      + `\n${cupom.condicao}\nVale até ${dataCurta(cupom.expira)}.\n\nAparece em canaltabarato.com.br/cupons em até 1 minuto.`);
  }

  if (name === "cupons") {
    const { results = [] } = await db.prepare(
      `SELECT id,source,code,condition,title,expires_at FROM coupons
       WHERE (active_at IS NULL OR active_at<=?1) AND (expires_at IS NULL OR expires_at>?1) ORDER BY expires_at LIMIT 30`,
    ).bind(agora).all();
    if (!results.length) return reply(`🎟 Nenhum cupom ativo no site.\n\n${AJUDA_CUPOM}`);
    return reply(["🎟 Cupons ativos no site:", "",
      ...results.map((c) => `${String(c.id).replace(/^painel_/, "")} · ${c.source} · ${c.code || "voucher"} · ${String(c.condition || c.title || "").slice(0, 60)}`
        + `${c.expires_at ? ` · até ${dataCurta(c.expires_at)}` : ""}`),
      "", "Para tirar: /cupom_apagar <código da esquerda>"].join("\n"));
  }

  if (name === "cupom_apagar") {
    const alvo = String(argumento || "").trim();
    if (!/^[a-z0-9_]{4,40}$/i.test(alvo)) return reply("Use: /cupom_apagar <código da esquerda em /cupons>");
    const r = await db.prepare("DELETE FROM coupons WHERE id=? OR id=?").bind(alvo, `painel_${alvo}`).run();
    return reply(Number(r?.meta?.changes) ? "🗑 Cupom tirado do site." : "Não achei esse cupom. Veja os códigos em /cupons.");
  }

  if (name === "add") {
    if (!argumento) return reply("Use: /add <link do produto na Amazon ou no Mercado Livre>");
    const produto = await resolveProductLink(argumento, fetchImpl);
    if (produto?.erro === "perfil_afiliado") return reply("❌ Esse link abre a página de perfil de afiliado do Mercado Livre, não a do produto, e nele não dá para saber qual é o produto. Abra o produto e copie o link da barra de endereços (ele tem /p/MLB… ou MLB-…).");
    if (!produto) {
      return reply("❌ Não reconheci o produto. Mande o link da página do produto no Mercado Livre (com MLB), na Shopee ou na Amazon (com /dp/ASIN).");
    }
    const linha = await db.prepare(
      `INSERT INTO monitor_produtos(loja,id_produto,tipo,ativo,canal,criado_em) VALUES(?,?,?,1,1,?)
       ON CONFLICT(loja,id_produto) DO UPDATE SET ativo=1,canal=1,tipo=COALESCE(excluded.tipo,monitor_produtos.tipo)
       RETURNING id,nome`,
    ).bind(produto.loja, produto.id_produto, produto.tipo, agora).first();
    const avisoAmazon = produto.loja === "amazon"
      ? "\n\n⏳ A Amazon ainda não liberou a API oficial para a sua conta (precisa de 10 vendas em 30 dias). O produto fica cadastrado e começa a ser lido assim que liberar."
      : "";
    if (produto.loja !== "amazon") {
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
       FROM monitor_produtos p WHERE p.ativo=1 AND p.canal=1 ORDER BY p.id LIMIT 60`,
    ).all();
    const publico = await db.prepare(
      `SELECT COUNT(DISTINCT chat_id) AS pessoas,COUNT(DISTINCT produto_id) AS produtos,COUNT(*) AS alertas
       FROM alerta_precos WHERE ativo=1 AND expira_em>?`,
    ).bind(agora).first();
    const rodape = publico?.alertas
      ? `\n🔔 Bot de alertas: ${publico.alertas} alerta(s) de ${publico.pessoas} pessoa(s), em ${publico.produtos} produto(s). Eles só geram avisos no privado, não vão para o canal.`
      : "";
    if (!results.length) return reply(`📭 Nenhum produto seu no monitor. Use /add <link>.${rodape}`);
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
    return reply(`${texto}\nDetalhes: /historico <id>${rodape}`);
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
// --- Cupons cadastrados pelo painel --------------------------------------------
// As lojas não entregam cupons pela API; quem cadastra é o admin, numa linha:
// /cupom Loja | CÓDIGO ou - | condição | dd/mm[/aaaa] | link
// O link precisa ser de afiliado: Shopee aceita qualquer link da loja (o site
// converte no primeiro clique); as outras só aceitam o link curto de afiliado.
export const AJUDA_CUPOM = "Formato:\n/cupom Loja | CÓDIGO (ou -) | condição | validade dd/mm | link\n\n"
  + "Ex.: /cupom Shopee | BLACK20 | R$ 20 off acima de R$ 100 | 30/11 | https://s.shopee.com.br/abc\n\n"
  + "Links aceitos: Shopee (qualquer link da Shopee), Mercado Livre (meli.la), Amazon (amzn.to), AliExpress (s.click.aliexpress.com).";
const LOJAS_CUPOM = {
  shopee: { nome: "Shopee", hosts: ["shopee.com.br", "shope.ee"] },
  "mercado livre": { nome: "Mercado Livre", hosts: ["meli.la"] },
  mercadolivre: { nome: "Mercado Livre", hosts: ["meli.la"] },
  amazon: { nome: "Amazon", hosts: ["amzn.to"] },
  aliexpress: { nome: "AliExpress", hosts: ["s.click.aliexpress.com"] },
};

export function parseCupom(texto, agora, aleatorio = () => crypto.getRandomValues(new Uint32Array(1))[0]) {
  const partes = String(texto || "").split("|").map((p) => p.trim());
  if (partes.length !== 5) return { erro: "Faltam campos: são 5, separados por |." };
  const [lojaTexto, codigoTexto, condicao, validade, linkTexto] = partes;
  const loja = LOJAS_CUPOM[lojaTexto.toLowerCase()];
  if (!loja) return { erro: "Loja desconhecida. Use Shopee, Mercado Livre, Amazon ou AliExpress." };
  const codigo = codigoTexto === "-" ? "" : codigoTexto.toUpperCase();
  if (codigo && !/^[A-Z0-9_-]{2,40}$/.test(codigo)) return { erro: "Código inválido (só letras, números, - e _)." };
  if (condicao.length < 3 || condicao.length > 200) return { erro: "Escreva a condição do cupom (até 200 letras)." };
  const data = validade.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (!data) return { erro: "Validade no formato dd/mm (ou dd/mm/aaaa)." };
  const hoje = new Date(agora * 1000);
  const ano = Number(data[3]) || Number(diaBrasilia(hoje).slice(0, 4));
  // Fim do dia em Brasília (UTC-3).
  const expira = Math.floor(Date.UTC(ano, Number(data[2]) - 1, Number(data[1]), 23, 59, 59) / 1000) + 3 * 3600;
  const conferida = new Date((expira - 3 * 3600) * 1000);
  if (conferida.getUTCDate() !== Number(data[1]) || conferida.getUTCMonth() !== Number(data[2]) - 1) return { erro: "Essa data não existe." };
  if (expira <= agora) return { erro: "Essa validade já passou." };
  let url;
  try { url = new URL(linkTexto); } catch { return { erro: "O link não é válido." }; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !loja.hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
    return { erro: `Para ${loja.nome}, use ${loja.nome === "Shopee" ? "um link da Shopee" : `o link curto de afiliado (${loja.hosts[0]})`}.` };
  }
  const id = `painel_${(aleatorio() >>> 0).toString(36).padStart(6, "0").slice(-6)}`;
  return { id, loja: loja.nome, codigo, condicao, titulo: codigo ? `${condicao}` : condicao, expira, link: url.href };
}

export function monitorDue(hour, minute, intervalHours) {
  const intervalo = Math.min(24, Math.max(1, Number.parseInt(intervalHours, 10) || 2));
  return Number(minute) === 7 && Number(hour) % intervalo === 0;
}

// Dia de Brasília (AAAA-MM-DD) de um instante.
export function diaBrasilia(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(date);
}

// Intervalo da coleta: de hora em hora dentro da janela MONITOR_HORA_EM_HORA
// ("2026-11-24/2026-12-01", dias de Brasília, inclusive), senão o normal.
export function intervaloDoMonitor(env, date) {
  const normal = Math.min(24, Math.max(1, Number.parseInt(env?.MONITOR_INTERVALO_HORAS, 10) || 2));
  const janela = String(env?.MONITOR_HORA_EM_HORA || "").match(/^(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/);
  if (!janela) return normal;
  const dia = diaBrasilia(date);
  return dia >= janela[1] && dia <= janela[2] ? 1 : normal;
}

// Coleta parada? Olha a última leitura gravada. Avisa uma vez quando passa do
// limite (duas coletas perdidas + 1 h) e depois a cada 12 h, sem guardar estado:
// a checagem roda no minuto 37 de cada hora.
export const MINUTO_SAUDE = 37;
export async function coletaAtrasada(db, agoraSeg, intervaloHoras) {
  const linha = await db.prepare(
    `SELECT MAX(lido_em) AS ultima,
       (SELECT COUNT(*) FROM monitor_produtos p WHERE (p.ativo=1 AND p.canal=1)
          OR EXISTS(SELECT 1 FROM alerta_precos a WHERE a.produto_id=p.id AND a.ativo=1 AND a.expira_em>?1)) AS produtos
     FROM monitor_leituras`,
  ).bind(agoraSeg).first();
  if (!Number(linha?.produtos) || !Number(linha?.ultima)) return null;
  const limite = (2 * intervaloHoras + 1) * 3600;
  const atraso = agoraSeg - Number(linha.ultima);
  if (atraso < limite) return null;
  const horasAlem = Math.floor((atraso - limite) / 3600);
  if (horasAlem % 12 !== 0) return null;
  return { horas: Math.floor(atraso / 3600), ultima: Number(linha.ultima) };
}

export function textoColetaAtrasada(atraso) {
  return `⚠️ A coleta de preços está parada há ${atraso.horas} h (última leitura: ${dataCurta(atraso.ultima)}).\n\n`
    + "Os alertas de preço não avisam ninguém enquanto isso. Confira a aba Actions do GitHub (rodada \"monitor_precos\") e use /teste_monitor para testar.";
}

// Painel do admin: quem usa o bot de alertas, quantos produtos e quantos avisos.
export async function estatisticas(db, agora) {
  const n = (valor) => Number(valor || 0).toLocaleString("pt-BR");
  const ativo = "a.ativo=1 AND a.expira_em>?";
  const alertas = await db.prepare(
    `SELECT COUNT(DISTINCT a.chat_id) AS pessoas,COUNT(*) AS total,SUM(a.avisar_menor) AS menor,
       SUM(a.preco_alvo IS NOT NULL) AS valor,SUM(a.queda_percent IS NOT NULL) AS queda,SUM(a.avisar_estoque) AS estoque,
       SUM(a.origem='canal') AS canal,SUM(a.origem='link') AS link
     FROM alerta_precos a WHERE ${ativo}`,
  ).bind(agora).first();
  const historicoPessoas = await db.prepare("SELECT COUNT(DISTINCT chat_id) AS total FROM alerta_precos").first();
  const { results: porLoja = [] } = await db.prepare(
    `SELECT p.loja,SUM(p.ativo=1 AND p.canal=1) AS canal,
       SUM(EXISTS(SELECT 1 FROM alerta_precos a WHERE a.produto_id=p.id AND ${ativo})) AS publico
     FROM monitor_produtos p GROUP BY p.loja ORDER BY p.loja`,
  ).bind(agora).all();
  const palavras = await db.prepare(
    "SELECT COUNT(DISTINCT chat_id) AS pessoas,COUNT(*) AS total FROM alert_subscriptions",
  ).first();
  const avisos = await db.prepare(
    `SELECT SUM(enviado_em>=?1) AS dia,SUM(enviado_em>=?2) AS semana,COUNT(*) AS mes
     FROM alerta_avisos WHERE enviado_em>=?3`,
  ).bind(agora - 86400, agora - 7 * 86400, agora - 30 * 86400).first();
  const palavrasAvisos = await db.prepare(
    "SELECT COUNT(*) AS semana FROM alert_deliveries WHERE sent_at>=?",
  ).bind(agora - 7 * 86400).first();
  const { results: top = [] } = await db.prepare(
    `SELECT p.nome,p.id_produto,COUNT(*) AS total FROM alerta_precos a JOIN monitor_produtos p ON p.id=a.produto_id
     WHERE ${ativo} GROUP BY a.produto_id ORDER BY total DESC LIMIT 5`,
  ).bind(agora).all();
  const linhas = [
    "📊 Bot de alertas (@TaBaratoAlertaDePrecoBot)",
    "",
    `👥 Pessoas com alerta de preço ativo: ${n(alertas?.pessoas)} (já usaram: ${n(historicoPessoas?.total)})`,
    `🔔 Alertas de preço ativos: ${n(alertas?.total)} · pelo botão do canal: ${n(alertas?.canal)} · por link: ${n(alertas?.link)}`,
    `   Tipos: menor preço ${n(alertas?.menor)} · valor ${n(alertas?.valor)} · queda % ${n(alertas?.queda)} · estoque ${n(alertas?.estoque)}`,
    `🔤 Alertas por palavra: ${n(palavras?.total)} de ${n(palavras?.pessoas)} pessoa(s)`,
    "",
    "📦 Produtos monitorados:",
    ...(porLoja.length ? porLoja.map((l) => `   ${LOJA[l.loja] || l.loja}: ${n(l.canal)} do canal (/add) · ${n(l.publico)} do público`) : ["   nenhum"]),
    "",
    `📨 Avisos de preço enviados: hoje ${n(avisos?.dia)} · 7 dias ${n(avisos?.semana)} · 30 dias ${n(avisos?.mes)}`,
    `📨 Avisos por palavra (7 dias): ${n(palavrasAvisos?.semana)}`,
  ];
  if (top.length) {
    linhas.push("", "🏆 Produtos com mais alertas:",
      ...top.map((p, i) => `   ${i + 1}. ${String(p.nome || p.id_produto).slice(0, 60)} (${n(p.total)})`));
  }
  const cliques = await db.prepare(
    `SELECT SUM(CASE WHEN canal='alerta' AND dia>=?1 THEN total ELSE 0 END) AS avisos7,
       SUM(CASE WHEN canal='alerta_cartao' AND dia>=?1 THEN total ELSE 0 END) AS cartao7,
       SUM(CASE WHEN canal='alerta' THEN total ELSE 0 END) AS avisos30,
       SUM(CASE WHEN canal='alerta_cartao' THEN total ELSE 0 END) AS cartao30
     FROM alerta_cliques_diarios WHERE dia>=?2`,
  ).bind(diaBrasilia(new Date((agora - 6 * 86400) * 1000)), diaBrasilia(new Date((agora - 29 * 86400) * 1000))).first()
    .catch(() => null);
  if (cliques) {
    const taxa = (c, a) => (Number(a) ? ` (${Math.round(Number(c || 0) / Number(a) * 100)}% dos avisos)` : "");
    linhas.push("", "👆 Cliques para a loja:",
      `   Nos avisos: 7 dias ${n(cliques.avisos7)}${taxa(cliques.avisos7, avisos?.semana)} · 30 dias ${n(cliques.avisos30)}${taxa(cliques.avisos30, avisos?.mes)}`,
      `   No cartão e no mini app: 7 dias ${n(cliques.cartao7)} · 30 dias ${n(cliques.cartao30)}`);
  }
  linhas.push("", "Vendas dos avisos aparecem no relatório diário, no canal \"alerta\".");
  return linhas.join("\n");
}
