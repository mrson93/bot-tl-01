// Radar de cupons em tempo real: a cada 2 minutos, 24 horas por dia, lê
// a página pública t.me/s/<canal> dos canais configurados, publica no canal
// de cupons os códigos novos de Amazon, Mercado Livre e Shopee (com "Copiar
// código" e "Ativar na loja" pelo nosso link de afiliado da loja), coloca no
// site e avisa o admin com um botão para apagar. Quando o canal de origem diz
// que o código esgotou, o post vira "encerrado" e sai do site.

export const RADAR_PADRAO = "sddescontos,baixouprecofcupons";
export const CANAL_CUPONS_PADRAO = "@CanalTaBaratoCupons";
const SITE = "https://canaltabarato.com.br";
const FUSO_MS = 3 * 3600 * 1000;
const JANELA_S = 3 * 3600;          // só mensagens das últimas 3 h
const VALIDADE_S = 12 * 3600;       // sem data informada: 12 h no site
const LOJAS = [
  ["Shopee", "shopee", /shopee|shope\.ee/i],
  ["Amazon", "amazon", /amazon|amzn/i],
  ["Mercado Livre", "mercadolivre", /mercado\s*livre|meli\.la|mercadolivre/i],
];
const OUTRAS_LOJAS = /aliexpress|s\.click|magalu|magazine\s*luiza|shein|kabum|netshoes|centauro|casas\s*bahia/i;
const CODIGO = /(?:[🎟🏷🎫]️?|(?:[Cc][Uu][Pp][Oo][MmNn]|[Cc][ÓóOo][Dd][Ii][Gg][Oo]|[Cc][ÓóOo][Dd]\.?|[Uu][Ss][Ee]|[Aa][Pp][Ll][Ii][Qq][Uu][Ee]|[Vv][Oo][Uu][Cc][Hh][Ee][Rr])\s*(?:[Dd][Ee]\s+[Dd][Ee][Ss][Cc][Oo][Nn][Tt][Oo])?\s*[:\-–]?)\s*["'“`]?([A-Z0-9][A-Z0-9_-]{3,19})(?![a-z])/gu;
const NAO_CODIGO = new Set(("OFF AQUI LINK NOVO HOJE SHOPEE AMAZON PRIME FRETE GRATIS DESCONTO VALIDO ABAIXO ACIMA ATIVE "
  + "RESGATE APP MERCADO LIVRE MAGALU LIMITE CORRE CUPOM CUPONS CUPONZAO LISTA LOGO USA CLIQUE COMPRE ALIEXPRESS "
  + "SHEIN KABUM MAGAZINE LUIZA BLACK FRIDAY TODOS").split(" "));
const ESGOTOU = /esgot(?:ou|ado|ada|aram|amos)|acabou|encerr(?:ou|ado|ada)|expirou|n[aã]o (?:est[aá] )?funciona|morreu|caiu o cupom/i;
const CANAL_VALIDO = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

export function desescapar(texto) {
  return String(texto)
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d{1,7});/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

const escaparHtml = (texto) => String(texto).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function textoDaMensagem(trechoHtml) {
  return desescapar(String(trechoHtml).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// [{texto, momento}] das mensagens da página pública do canal.
export function mensagensDaPagina(html) {
  const resultado = [];
  const padrao = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>[\s\S]*?<time[^>]*datetime="([^"]+)"/g;
  for (const [, corpo, quando] of html.matchAll(padrao)) {
    const momento = Math.floor(Date.parse(quando) / 1000);
    if (Number.isFinite(momento)) resultado.push({ texto: textoDaMensagem(corpo), momento });
  }
  return resultado;
}

export function codigosDoTexto(texto) {
  const achados = [];
  for (const [, bruto] of String(texto).matchAll(CODIGO)) {
    const codigo = bruto.replace(/^[-_]+|[-_]+$/g, "");
    if (codigo.length < 4 || NAO_CODIGO.has(codigo) || !/[A-Z]/.test(codigo) || /^\d+$/.test(codigo)
        || achados.includes(codigo)) continue;
    achados.push(codigo);
  }
  return achados;
}

export function lojaDoTexto(texto) {
  const loja = LOJAS.find(([, , padrao]) => padrao.test(texto));
  return loja ? { nome: loja[0], slug: loja[1] } : null;
}

// Regra do cupom logo depois do código ("R$300 OFF acima de R$2299"), sem links.
export function regraDoCupom(texto, codigo) {
  const depois = String(texto).split(codigo)[1] || "";
  return depois.replace(/https?:\/\/\S+/g, "").split(/[🎟🏷🎫👇]|RESGATE|Na lista/i)[0]
    .replace(/\s+/g, " ").replace(/^[\s:,.-]+|[\s,.-]+$/g, "").slice(0, 120);
}

// Regra do cupom na mensagem: depois do código (lista "🎟 CÓDIGO regra"),
// ou a mensagem inteira quando ela traz um código só (o @baixouprecofcupons
// escreve a regra antes: "R$200 OFF acima de R$500 · Cupom: BFMP100").
export function regraNaMensagem(texto, codigo, total) {
  const depois = formatarRegra(regraDoCupom(texto, codigo));
  if (depois) return depois;
  const semLinks = String(texto).replace(/https?:\/\/\S+/g, " ");
  if (total === 1) return formatarRegra(semLinks);
  const antes = semLinks.split(codigo)[0].split(/[🎟🏷🎫]/).at(-1) || "";
  return formatarRegra(antes);
}

// Condição extra que o canal de origem avisa ("*Válido cartão Mercado Pago").
export function notaDoCupom(texto) {
  if (/cart[aã]o (?:de cr[eé]dito )?mercado ?pago/i.test(texto)) return "Só no cartão Mercado Pago";
  if (/primeira compra/i.test(texto)) return "Só na primeira compra";
  if (/novos? (?:usu[aá]rios?|clientes?)/i.test(texto)) return "Só para novos clientes";
  return "";
}

// "2299" → "R$ 2.299"; "299,90" → "R$ 299,90"; "1.000" → "R$ 1.000".
function reais(texto) {
  const limpo = String(texto).replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const valor = Number(limpo);
  if (!Number.isFinite(valor) || valor <= 0 || valor > 1_000_000) return null;
  return `R$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: Number.isInteger(valor) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

// Regra do cupom em formato fixo: "15% OFF · compra mínima R$ 79 · máximo R$ 60".
// Os canais escrevem de vários jeitos ("200 de 799", "R$300 OFF acima de
// R$2299", "15% acima de 79 máx 60"); sem desconto reconhecido, não mostra nada.
export function formatarRegra(trecho) {
  const t = desescapar(String(trecho || "")).replace(/\s+/g, " ");
  const num = "(\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,2})?|\\d+(?:,\\d{1,2})?)";
  const pct = t.match(/(\d{1,2})\s*%/);
  const offReais = t.match(new RegExp(`R?\\$?\\s*${num}\\s*(?:OFF|de desconto)`, "i"));
  const deAte = t.match(new RegExp(`^\\s*R?\\$?\\s*${num}\\s+(?:de|em compras? de|acima de)\\s+R?\\$?\\s*${num}`, "i"));
  const minimo = t.match(new RegExp(`(?:acima de|a partir de|m[ií]n(?:imo|ima)?(?: de)?|compras? (?:acima )?de)\\s*R?\\$?\\s*${num}`, "i"));
  const maximo = t.match(new RegExp(`(?:m[aá]x(?:imo)?\\.?|limite(?: de)?|at[eé])\\s*(?:de\\s*)?R?\\$?\\s*${num}`, "i"));
  let desconto = null, minimoTexto = minimo ? reais(minimo[1]) : null;
  if (pct) desconto = `${pct[1]}% OFF`;
  else if (offReais && reais(offReais[1])) desconto = `${reais(offReais[1])} OFF`;
  else if (deAte && reais(deAte[1])) { desconto = `${reais(deAte[1])} OFF`; minimoTexto = minimoTexto || reais(deAte[2]); }
  if (!desconto) return "";
  const partes = [desconto];
  if (minimoTexto) partes.push(`compra mínima ${minimoTexto}`);
  if (pct && maximo && reais(maximo[1])) partes.push(`máximo ${reais(maximo[1])}`);
  return partes.join(" · ");
}

export function radarAtivo(agoraMs) {
  const hora = new Date(agoraMs - FUSO_MS).getUTCHours();
  return hora >= 7 && hora < 23;
}

function canais(env) {
  return String(env.RADAR_CUPONS_CANAIS ?? RADAR_PADRAO).split(",").map((c) => c.trim().replace(/^@/, ""))
    .filter((c) => CANAL_VALIDO.test(c)).slice(0, 10);
}

async function telegram(env, metodo, corpo, fetchImpl) {
  const resposta = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${metodo}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!dados.ok) throw new Error(`telegram_${metodo}_${dados.error_code || resposta.status}`);
  return dados.result;
}

async function garantirTabela(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS radar_cupons(chave TEXT PRIMARY KEY,loja TEXT NOT NULL,codigo TEXT NOT NULL,
    canal TEXT NOT NULL,regra TEXT,visto_em INTEGER NOT NULL,status TEXT NOT NULL,mensagem_canal INTEGER,cupom_id TEXT,link_slug TEXT)`).run();
  // Tabela criada antes da coluna link_slug (27/11/2026).
  await db.prepare("ALTER TABLE radar_cupons ADD COLUMN link_slug TEXT").run().catch(() => {});
  await db.prepare("ALTER TABLE radar_cupons ADD COLUMN regra_v INTEGER").run().catch(() => {});
  await db.prepare("ALTER TABLE radar_cupons ADD COLUMN nota TEXT").run().catch(() => {});
  await db.prepare("ALTER TABLE radar_cupons ADD COLUMN ultimo_visto INTEGER").run().catch(() => {});
  // Publicados antes da verificação (28/11/2026): 12 h de prazo a partir de agora.
  await db.prepare("UPDATE radar_cupons SET ultimo_visto=? WHERE ultimo_visto IS NULL AND status='publicado'")
    .bind(Math.floor(Date.now() / 1000)).run().catch(() => {});
}

// "R$ 200 OFF · compra mínima R$ 500 · máximo R$ 60" → linhas do post.
export function linhasDaRegra(regra) {
  return String(regra || "").split(" · ").filter(Boolean).map((parte, i) => {
    if (/^compra mínima /.test(parte)) return `🛒 Compra mínima ${parte.slice(14)}`;
    if (/^máximo /.test(parte)) return `🔝 Desconto máximo ${parte.slice(7)}`;
    return i === 0 ? `💸 ${parte}` : parte;
  });
}

export function textoDoPost(cupom) {
  const linhas = [`🎟 <b>CUPOM DISPONÍVEL · ${escaparHtml(cupom.loja.toUpperCase())}</b>`, "",
    `🔑 Código: <code>${escaparHtml(cupom.codigo)}</code>`, ...linhasDaRegra(cupom.regra).map(escaparHtml)];
  if (cupom.nota) linhas.push(`💳 ${escaparHtml(cupom.nota)}`);
  linhas.push("", "👉 Copie o código e use no carrinho.", "⏳ Pode acabar a qualquer momento.");
  return linhas.join("\n");
}

export function botoesDoPost(cupom) {
  return { inline_keyboard: [
    [{ text: "📋 Copiar código", copy_text: { text: cupom.codigo } }],
    [{ text: `🛒 Ativar na ${cupom.loja === "Mercado Livre" ? "loja" : cupom.loja}`, url: `${SITE}/loja/${cupom.linkSlug || cupom.slug}` }],
  ] };
}

// Página de cupons da loja (link de afiliado sem o nosso perfil), guardada
// pelo bot em store_links como "cupons-<loja>"; sem ela, o atalho da loja.
async function linkDaLoja(db, slug) {
  for (const candidato of [`cupons-${slug}`, slug]) {
    const linha = await db.prepare("SELECT destination FROM store_links WHERE slug=?").bind(candidato).first().catch(() => null);
    if (linha?.destination) return { linkSlug: candidato, destino: linha.destination };
  }
  return { linkSlug: slug, destino: null };
}

async function publicar(env, cupom, agora, fetchImpl) {
  const canal = env.TELEGRAM_CANAL_CUPONS || CANAL_CUPONS_PADRAO;
  const { linkSlug, destino } = await linkDaLoja(env.MONITOR_DB, cupom.slug);
  cupom.linkSlug = linkSlug;
  const post = await telegram(env, "sendMessage", {
    chat_id: canal, text: textoDoPost(cupom), parse_mode: "HTML", disable_web_page_preview: true,
    reply_markup: botoesDoPost(cupom),
  }, fetchImpl);
  const cupomId = `radar_${cupom.slug}_${cupom.codigo}`.slice(0, 100);
  if (destino) {
    await env.MONITOR_DB.prepare(`INSERT INTO coupons(id,source,code,title,kind,condition,destination,active_at,expires_at,published_at)
      VALUES(?,?,?,?,'code',?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET condition=excluded.condition,expires_at=excluded.expires_at,published_at=excluded.published_at`)
      .bind(cupomId, cupom.loja, cupom.codigo, cupom.codigo, [cupom.regra, cupom.nota].filter(Boolean).join(" · ") || null,
        destino, agora, agora + VALIDADE_S, agora).run();
    // "Verificado em" no site (coluna da migração 0034; antes dela, ignora).
    await env.MONITOR_DB.prepare("UPDATE coupons SET verified_at=? WHERE id=?").bind(agora, cupomId).run().catch(() => {});
  }
  await env.MONITOR_DB.prepare("UPDATE radar_cupons SET status='publicado',mensagem_canal=?,cupom_id=?,link_slug=?,regra_v=3,nota=?,ultimo_visto=? WHERE chave=?")
    .bind(post?.message_id || null, destino ? cupomId : null, linkSlug, cupom.nota || null, agora, cupom.chave).run();
  await telegram(env, "sendMessage", {
    chat_id: env.TELEGRAM_ADMIN_ID, disable_web_page_preview: true,
    text: `🎟 Publicado no canal de cupons: ${cupom.loja} · ${cupom.codigo}${cupom.regra ? ` (${cupom.regra})` : ""} — de @${cupom.canal}`,
    reply_markup: { inline_keyboard: [[{ text: "🗑 Apagar", callback_data: `rc:del:${cupom.chave}`.slice(0, 64) }]] },
  }, fetchImpl).catch(() => {});
}

async function encerrar(env, linha, agora, fetchImpl) {
  const canal = env.TELEGRAM_CANAL_CUPONS || CANAL_CUPONS_PADRAO;
  if (linha.mensagem_canal) {
    await telegram(env, "editMessageText", {
      chat_id: canal, message_id: linha.mensagem_canal, parse_mode: "HTML",
      text: `❌ <b>CUPOM ENCERRADO · ${escaparHtml(linha.loja.toUpperCase())}</b>\n\n🔑 <s>${escaparHtml(linha.codigo)}</s>\n\nEste cupom acabou. Ative as notificações para pegar o próximo.`,
      reply_markup: { inline_keyboard: [] },
    }, fetchImpl).catch(() => {});
  }
  if (linha.cupom_id) {
    await env.MONITOR_DB.prepare("UPDATE coupons SET expires_at=MIN(COALESCE(expires_at,?),?) WHERE id=?")
      .bind(agora, agora, linha.cupom_id).run();
  }
  await env.MONITOR_DB.prepare("UPDATE radar_cupons SET status='encerrado' WHERE chave=?").bind(linha.chave).run();
}

// Conserto único (27/11/2026): os primeiros posts vieram com "R&#036;" da
// página do canal e com o botão para o atalho da loja (que mostra o nosso
// perfil). Corrige o texto, o botão (página de cupons) e o site.
async function consertarRegras(env, fetchImpl) {
  const { results = [] } = await env.MONITOR_DB.prepare(`SELECT chave,loja,codigo,regra,nota,mensagem_canal,cupom_id FROM radar_cupons
    WHERE status='publicado' AND (link_slug IS NULL OR link_slug NOT LIKE 'cupons-%' OR COALESCE(regra_v,0)<3) LIMIT 30`).all();
  const canal = env.TELEGRAM_CANAL_CUPONS || CANAL_CUPONS_PADRAO;
  for (const linha of results) {
    const regra = formatarRegra(linha.regra || "");
    const [slug] = linha.chave.split(":");
    const link = await linkDaLoja(env.MONITOR_DB, slug);
    if (!link.linkSlug.startsWith("cupons-")) continue;   // página de cupons ainda não salva pelo bot
    const cupom = { loja: linha.loja, slug, codigo: linha.codigo, regra, nota: linha.nota, ...link };
    await env.MONITOR_DB.prepare("UPDATE radar_cupons SET regra=?,link_slug=?,regra_v=3 WHERE chave=?").bind(regra, link.linkSlug, linha.chave).run();
    if (linha.cupom_id) {
      await env.MONITOR_DB.prepare("UPDATE coupons SET condition=?,destination=COALESCE(?,destination) WHERE id=?")
        .bind(regra || null, link.destino, linha.cupom_id).run();
    }
    if (linha.mensagem_canal) {
      await telegram(env, "editMessageText", { chat_id: canal, message_id: linha.mensagem_canal, parse_mode: "HTML",
        disable_web_page_preview: true, text: textoDoPost(cupom), reply_markup: botoesDoPost(cupom) }, fetchImpl).catch(() => {});
    }
  }
}

export async function runRadarCupons(controller, env, fetchImpl = fetch) {
  const agoraMs = Number(controller?.scheduledTime || Date.now());
  if (new Date(agoraMs).getUTCMinutes() % 2 !== 0) return null;
  if (!env.MONITOR_DB || !env.TELEGRAM_BOT_TOKEN) return null;
  await garantirTabela(env.MONITOR_DB);
  await consertarRegras(env, fetchImpl).catch(() => {});
  const lista = canais(env);
  if (!lista.length) return null;
  const agora = Math.floor(agoraMs / 1000);
  await garantirTabela(env.MONITOR_DB);
  let publicados = 0, encerrados = 0;
  for (const canal of lista) {
    const resposta = await fetchImpl(`https://t.me/s/${canal}`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; radar-cupons)" } });
    if (!resposta.ok) continue;
    const recentes = mensagensDaPagina(await resposta.text()).filter((m) => agora - m.momento <= JANELA_S);
    const candidatos = new Map();
    const vistos = new Set();
    for (const { texto } of recentes) {
      if (ESGOTOU.test(texto)) continue;
      const loja = lojaDoTexto(texto);
      if (!loja || OUTRAS_LOJAS.test(texto)) continue;
      const codigos = codigosDoTexto(texto);
      for (const codigo of codigos) {
        const chave = `${loja.slug}:${codigo}`;
        vistos.add(chave);
        if (candidatos.has(chave)) continue;
        // Só publica cupom com regra reconhecida (desconto em % ou R$):
        // código solto, sem valor nem mínimo, fica estranho no canal.
        const regra = regraNaMensagem(texto, codigo, codigos.length);
        if (!regra) continue;
        candidatos.set(chave, { chave, loja: loja.nome, slug: loja.slug, codigo, canal, regra, nota: notaDoCupom(texto) });
      }
    }
    // Reapareceu no canal de origem: continua valendo ("Verificado em" no site).
    const reconfirmados = [...vistos];
    for (let i = 0; i < reconfirmados.length; i += 50) {
      const lote = reconfirmados.slice(i, i + 50);
      const marcas = lote.map(() => "?").join(",");
      await env.MONITOR_DB.prepare(`UPDATE radar_cupons SET ultimo_visto=? WHERE status='publicado' AND chave IN (${marcas})`).bind(agora, ...lote).run();
      await env.MONITOR_DB.prepare(`UPDATE coupons SET verified_at=?,expires_at=MAX(COALESCE(expires_at,0),?) WHERE id IN
        (SELECT cupom_id FROM radar_cupons WHERE status='publicado' AND chave IN (${marcas}))`).bind(agora, agora + VALIDADE_S, ...lote).run().catch(() => {});
    }
    const chaves = [...candidatos.keys()];
    const existentes = new Set();
    for (let i = 0; i < chaves.length; i += 50) {
      const lote = chaves.slice(i, i + 50);
      const { results = [] } = await env.MONITOR_DB.prepare(`SELECT chave FROM radar_cupons WHERE chave IN (${lote.map(() => "?").join(",")})`).bind(...lote).all();
      for (const linha of results) existentes.add(linha.chave);
    }
    for (const cupom of candidatos.values()) {
      if (existentes.has(cupom.chave)) continue;
      await env.MONITOR_DB.prepare("INSERT OR IGNORE INTO radar_cupons(chave,loja,codigo,canal,regra,visto_em,status) VALUES(?,?,?,?,?,?,'novo')")
        .bind(cupom.chave, cupom.loja, cupom.codigo, canal, cupom.regra || null, agora).run();
      try {
        await publicar(env, cupom, agora, fetchImpl);
        publicados += 1;
      } catch (error) {
        console.error(JSON.stringify({ event: "radar_publish_failed", chave: cupom.chave, reason: String(error?.message || error).slice(0, 80) }));
      }
    }
    // Esgotou? Os publicados que o canal de origem disse que acabaram.
    const avisos = recentes.filter((m) => ESGOTOU.test(m.texto));
    if (avisos.length) {
      const { results = [] } = await env.MONITOR_DB.prepare("SELECT chave,loja,codigo,mensagem_canal,cupom_id FROM radar_cupons WHERE status='publicado' AND canal=? AND visto_em>=?")
        .bind(canal, agora - 2 * 86400).all();
      for (const linha of results) {
        const citado = avisos.some((m) => new RegExp(`(?<![A-Z0-9])${linha.codigo.replace(/[-_]/g, "\\$&")}(?![A-Z0-9])`).test(m.texto));
        if (!citado) continue;
        await encerrar(env, linha, agora, fetchImpl);
        encerrados += 1;
      }
    }
  }
  // Sumiu do canal de origem há 12 h: encerra (não dá para saber se ainda vale).
  const { results: sumidos = [] } = await env.MONITOR_DB.prepare(`SELECT chave,loja,codigo,mensagem_canal,cupom_id FROM radar_cupons
    WHERE status='publicado' AND COALESCE(ultimo_visto,visto_em)<? LIMIT 20`).bind(agora - VALIDADE_S).all();
  for (const linha of sumidos) {
    await encerrar(env, linha, agora, fetchImpl);
    encerrados += 1;
  }
  if (publicados || encerrados) console.log(JSON.stringify({ event: "radar_cupons", publicados, encerrados }));
  return { publicados, encerrados };
}

// Botão "🗑 Apagar" do aviso no admin: tira do canal de cupons e do site.
export async function apagarCupomDoRadar(env, chave, fetchImpl = fetch) {
  const linha = await env.MONITOR_DB.prepare("SELECT chave,mensagem_canal,cupom_id FROM radar_cupons WHERE chave=?").bind(chave).first();
  if (!linha) return false;
  if (linha.mensagem_canal) {
    await telegram(env, "deleteMessage", { chat_id: env.TELEGRAM_CANAL_CUPONS || CANAL_CUPONS_PADRAO, message_id: linha.mensagem_canal }, fetchImpl).catch(() => {});
  }
  if (linha.cupom_id) await env.MONITOR_DB.prepare("DELETE FROM coupons WHERE id=?").bind(linha.cupom_id).run();
  await env.MONITOR_DB.prepare("UPDATE radar_cupons SET status='apagado' WHERE chave=?").bind(chave).run();
  return true;
}
