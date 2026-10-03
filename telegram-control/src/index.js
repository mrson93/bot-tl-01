import {
  AUDIT_VARIABLE,
  CATEGORIES,
  DISTRIBUTION_KEYS,
  SETTINGS,
  STORE_KEYS,
  defaultValues,
  displayValue,
  effectiveValue,
  settingsForCategory,
  validateSetting,
  validateDistribution,
} from "./settings.js";
import { checkUsageLimit } from "./usage-monitor.js";

const MODES = Object.freeze({
  economico: {
    label: "Econômico",
    detail: "30 min no pico e poucas consultas fora dele",
    actionsPerDay: 22,
  },
  normal: {
    label: "Normal",
    detail: "15 min no pico e 30 min fora dele",
    actionsPerDay: 53,
  },
  rapido: {
    label: "Rápido",
    detail: "8–11 min no pico e 16–22 min fora dele",
    actionsPerDay: 82,
  },
  pausado: {
    label: "Pausado",
    detail: "sem consultas ou publicações automáticas",
    actionsPerDay: 0,
  },
});

// Registro único das campanhas que podem ser disparadas separadamente. Para
// adicionar outra campanha, inclua-a aqui e no workflow do GitHub.
const CAMPAIGNS = Object.freeze({
  shopee_vip: {
    label: "Shopee VIP",
    emoji: "👑",
    activeSetting: "SHOPEE_VIP_ATIVO",
  },
});

function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function constantTimeEqual(left, right) {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(left || ""))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(right || ""))),
  ]);
  const a = new Uint8Array(leftDigest);
  const b = new Uint8Array(rightDigest);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function adminId(env) {
  return String(env.TELEGRAM_ADMIN_ID || "").trim();
}

export function authorizedUpdate(update, env) {
  const chat = update?.callback_query?.message?.chat || update?.message?.chat;
  const actor = update?.callback_query?.from || update?.message?.from;
  return Boolean(
    adminId(env)
      && chat?.type === "private"
      && String(chat?.id) === adminId(env)
      && String(actor?.id) === adminId(env)
  );
}

export function parseCommand(rawText) {
  const text = String(rawText || "").trim();
  if (!text.startsWith("/")) return { name: "painel", args: [] };
  const parts = text.split(/\s+/);
  const name = parts.shift().slice(1).split("@", 1)[0].toLowerCase();
  return { name, args: parts.map((part) => part.toLowerCase()) };
}

function panelKeyboard(mode = "economico") {
  const paused = mode === "pausado";
  return {
    inline_keyboard: [
      [{ text: CATEGORIES.canais.label, callback_data: "menu:canais" }],
      [
        { text: "💚 Econômico", callback_data: "mode:economico" },
        { text: "⚡ Normal", callback_data: "mode:normal" },
      ],
      [{ text: "🚀 Rápido", callback_data: "mode:rapido" }],
      [{
        text: paused ? "▶️ Ativar" : "⏸ Pausar",
        callback_data: paused ? "mode:economico" : "mode:pausado",
      }],
      [
        { text: "📊 Status", callback_data: "action:status" },
        { text: "📄 Relatório", callback_data: "action:relatorio" },
      ],
      [{ text: "▶️ Executar agora", callback_data: "action:executar:ask" }],
      [
        { text: "⚙️ Configurações", callback_data: "menu:root" },
        { text: "❓ Ajuda", callback_data: "help:root" },
      ],
    ],
  };
}

function settingsRootKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: CATEGORIES.lojas.label, callback_data: "menu:lojas" },
        { text: CATEGORIES.filtros.label, callback_data: "menu:filtros" },
      ],
      [{ text: CATEGORIES.canais.label, callback_data: "menu:canais" }],
      [
        { text: CATEGORIES.horarios.label, callback_data: "menu:horarios" },
        { text: CATEGORIES.variedade.label, callback_data: "menu:variedade" },
      ],
      [
        { text: CATEGORIES.relatorio.label, callback_data: "menu:relatorio" },
        { text: CATEGORIES.selecao.label, callback_data: "menu:selecao" },
      ],
      [
        { text: CATEGORIES.cupons.label, callback_data: "menu:cupons" },
        { text: CATEGORIES.campanhas.label, callback_data: "menu:campanhas" },
      ],
      [
        { text: "🕘 Histórico", callback_data: "action:audit" },
        { text: "↩️ Restaurar padrões", callback_data: "defaults:ask" },
      ],
      [{ text: "⬅️ Painel principal", callback_data: "menu:panel" }],
      [{ text: "❓ Entenda as configurações", callback_data: "help:settings" }],
    ],
  };
}

function helpKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🎛 Painel e comandos", callback_data: "help:actions" },
        { text: "⏱ Modos de ritmo", callback_data: "help:modes" },
      ],
      [{ text: CATEGORIES.canais.label, callback_data: "help:canais" }],
      [
        { text: CATEGORIES.lojas.label, callback_data: "help:lojas" },
        { text: CATEGORIES.filtros.label, callback_data: "help:filtros" },
      ],
      [
        { text: CATEGORIES.horarios.label, callback_data: "help:horarios" },
        { text: CATEGORIES.variedade.label, callback_data: "help:variedade" },
      ],
      [
        { text: CATEGORIES.relatorio.label, callback_data: "help:relatorio" },
        { text: CATEGORIES.cupons.label, callback_data: "help:cupons" },
      ],
      [
        { text: CATEGORIES.campanhas.label, callback_data: "help:campanhas" },
        { text: CATEGORIES.selecao.label, callback_data: "help:selecao" },
      ],
      [{ text: "⬅️ Painel principal", callback_data: "menu:panel" }],
    ],
  };
}

function helpBackKeyboard() {
  return { inline_keyboard: [[{ text: "⬅️ Índice da ajuda", callback_data: "help:root" }]] };
}

async function telegramRequest(env, method, body, fetchImpl) {
  const token = String(env.TELEGRAM_BOT_TOKEN || "");
  if (!token) throw new Error("telegram_not_configured");
  const response = await fetchImpl(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw new Error(`telegram_${response.status}`);
  return response;
}

async function sendMessage(env, chatId, text, fetchImpl, replyMarkup = panelKeyboard()) {
  return telegramRequest(env, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  }, fetchImpl);
}

async function answerCallback(env, callbackId, text, fetchImpl) {
  if (!callbackId) return;
  await telegramRequest(env, "answerCallbackQuery", {
    callback_query_id: callbackId,
    text,
  }, fetchImpl);
}

function githubHeaders(env) {
  const token = String(env.GITHUB_TOKEN || "");
  if (!token) throw new Error("github_not_configured");
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "deal-signal-control",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function githubBase(env) {
  const owner = encodeURIComponent(String(env.GITHUB_OWNER || ""));
  const repo = encodeURIComponent(String(env.GITHUB_REPO || ""));
  if (!owner || !repo) throw new Error("github_repo_not_configured");
  return `https://api.github.com/repos/${owner}/${repo}`;
}

async function githubRequest(env, path, options, fetchImpl) {
  return fetchImpl(`${githubBase(env)}${path}`, {
    ...options,
    headers: { ...githubHeaders(env), ...(options?.headers || {}) },
  });
}

async function getMode(env, fetchImpl) {
  const response = await githubRequest(
    env, "/actions/variables/BOT_MODE", { method: "GET" }, fetchImpl,
  );
  if (response.status === 404) return "economico";
  if (!response.ok) throw new Error(`github_variable_read_${response.status}`);
  const value = String((await response.json()).value || "").toLowerCase();
  return MODES[value] ? value : "economico";
}

async function getVariables(env, fetchImpl) {
  const variables = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = await githubRequest(
      env, `/actions/variables?per_page=30&page=${page}`,
      { method: "GET" }, fetchImpl,
    );
    if (!response.ok) throw new Error(`github_variables_read_${response.status}`);
    const data = await response.json();
    const batch = data.variables || [];
    variables.push(...batch);
    if (batch.length < 30 || variables.length >= Number(data.total_count || Infinity)) {
      return Object.fromEntries(variables.map((item) =>
        [String(item.name), String(item.value)]));
    }
  }
  throw new Error("github_variables_pagination_incomplete");
}

async function setVariable(env, name, value, fetchImpl) {
  const body = JSON.stringify({ name, value: String(value) });
  let response = await githubRequest(
    env, `/actions/variables/${encodeURIComponent(name)}`, { method: "PATCH", body }, fetchImpl,
  );
  if (response.status === 404) {
    response = await githubRequest(
      env, "/actions/variables", { method: "POST", body }, fetchImpl,
    );
  }
  if (!response.ok) throw new Error(`github_variable_write_${response.status}`);
}

async function setMode(env, mode, fetchImpl) {
  if (!MODES[mode]) throw new Error("invalid_mode");
  await setVariable(env, "BOT_MODE", mode, fetchImpl);
}

async function recordAudit(env, entry, fetchImpl) {
  try {
    const variables = await getVariables(env, fetchImpl);
    let previous = [];
    try {
      const parsed = JSON.parse(variables[AUDIT_VARIABLE] || "[]");
      if (Array.isArray(parsed)) previous = parsed;
    } catch {
      previous = [];
    }
    const history = [...previous, {
      at: new Date().toISOString(),
      key: entry.key,
      before: String(entry.before),
      after: String(entry.after),
    }].slice(-10);
    await setVariable(env, AUDIT_VARIABLE, JSON.stringify(history), fetchImpl);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "audit_error";
    console.error("configuration_audit_failed", reason);
  }
}

async function latestSuccessfulRun(env, fetchImpl) {
  const response = await githubRequest(
    env,
    "/actions/workflows/bot.yml/runs?status=success&per_page=1",
    { method: "GET" },
    fetchImpl,
  );
  if (!response.ok) throw new Error(`github_runs_${response.status}`);
  return (await response.json()).workflow_runs?.[0] || null;
}

async function dispatchReport(env, fetchImpl) {
  const branch = String(env.GITHUB_DEFAULT_BRANCH || "main");
  const response = await githubRequest(
    env,
    "/actions/workflows/bot.yml/dispatches",
    {
      method: "POST",
      body: JSON.stringify({
        ref: branch,
        inputs: { somente_relatorio: "true" },
      }),
    },
    fetchImpl,
  );
  if (!response.ok) throw new Error(`github_dispatch_${response.status}`);
}

async function dispatchBot(env, fetchImpl) {
  const branch = String(env.GITHUB_DEFAULT_BRANCH || "main");
  const response = await githubRequest(
    env,
    "/actions/workflows/bot.yml/dispatches",
    {
      method: "POST",
      body: JSON.stringify({
        ref: branch,
        inputs: { executar_bot: "true" },
      }),
    },
    fetchImpl,
  );
  if (!response.ok) throw new Error(`github_dispatch_${response.status}`);
}

async function dispatchCampaign(env, campaignId, fetchImpl) {
  if (!CAMPAIGNS[campaignId]) throw new Error("invalid_campaign");
  const branch = String(env.GITHUB_DEFAULT_BRANCH || "main");
  const response = await githubRequest(
    env,
    "/actions/workflows/bot.yml/dispatches",
    {
      method: "POST",
      body: JSON.stringify({
        ref: branch,
        inputs: { campanha: campaignId },
      }),
    },
    fetchImpl,
  );
  if (!response.ok) throw new Error(`github_dispatch_${response.status}`);
}

function categoryKeyboard(category, variables) {
  const rows = category === "lojas" ? [[{
    text: "🎚 Ajustar distribuição das lojas (100%)", callback_data: "distribution:prompt",
  }]] : [];
  rows.push(...settingsForCategory(category).map(([key, setting]) => [{
    text: `${setting.label}: ${displayValue(key, effectiveValue(key, variables))}`.slice(0, 60),
    callback_data: `setting:${key}`,
  }]));
  if (category === "campanhas") {
    for (const [campaignId, campaign] of Object.entries(CAMPAIGNS)) {
      rows.push([{
        text: `▶️ Executar ${campaign.label} agora`,
        callback_data: `campaign:${campaignId}:ask`,
      }]);
    }
  }
  rows.push([{ text: "⬅️ Configurações", callback_data: "menu:root" }]);
  return { inline_keyboard: rows };
}

function settingKeyboard(key, value) {
  const setting = SETTINGS[key];
  const rows = [];
  if (setting.type === "distribution") {
    rows.push([{ text: "🎚 Ajustar os quatro percentuais", callback_data: "distribution:prompt" }]);
  } else if (setting.type === "boolean") {
    rows.push([
      { text: "✅ Ativar", callback_data: `propose:${key}:true` },
      { text: "🚫 Desativar", callback_data: `propose:${key}:false` },
    ]);
  } else if (setting.type === "choice") {
    rows.push(setting.choices.map((choice) => ({
      text: displayValue(key, choice), callback_data: `propose:${key}:${choice}`,
    })));
  } else {
    rows.push([{ text: "✏️ Alterar valor", callback_data: `prompt:${key}` }]);
  }
  if (setting.type !== "distribution" && value !== setting.default) {
    rows.push([{ text: "↩️ Usar padrão", callback_data: `propose:${key}:${setting.default}` }]);
  }
  rows.push([{ text: "⬅️ Voltar", callback_data: `menu:${setting.category}` }]);
  return { inline_keyboard: rows };
}

function confirmKeyboard(key, value) {
  return {
    inline_keyboard: [[
      { text: "✅ Confirmar", callback_data: `apply:${key}:${value}` },
      { text: "Cancelar", callback_data: `setting:${key}` },
    ]],
  };
}

function configurationText() {
  return [
    "⚙️ Configurações do bot",
    "",
    "Escolha uma área. Senhas, tokens e limites críticos continuam protegidos fora deste painel.",
    "Toda alteração é validada, confirmada e registrada.",
  ].join("\n");
}

async function showConfigurationRoot(env, chatId, fetchImpl) {
  return sendMessage(env, chatId, configurationText(), fetchImpl, settingsRootKeyboard());
}

async function showCategory(env, chatId, category, fetchImpl) {
  const metadata = CATEGORIES[category];
  if (!metadata) return showConfigurationRoot(env, chatId, fetchImpl);
  const variables = await getVariables(env, fetchImpl);
  const lines = settingsForCategory(category).map(([key, setting]) =>
    `• ${setting.label}: ${displayValue(key, effectiveValue(key, variables))}`);
  return sendMessage(
    env,
    chatId,
    `${metadata.label}\n${metadata.description}\n\n${lines.join("\n")}\n\nToque em uma opção para consultar ou alterar.`,
    fetchImpl,
    categoryKeyboard(category, variables),
  );
}

async function showSetting(env, chatId, key, fetchImpl) {
  const setting = SETTINGS[key];
  if (!setting) return showConfigurationRoot(env, chatId, fetchImpl);
  const variables = await getVariables(env, fetchImpl);
  const value = effectiveValue(key, variables);
  return sendMessage(
    env,
    chatId,
    `⚙️ ${setting.label}\n\nValor atual: ${displayValue(key, value)}\nPadrão seguro: ${displayValue(key, setting.default)}\n\n${setting.hint}`,
    fetchImpl,
    settingKeyboard(key, value),
  );
}

async function promptSetting(env, chatId, key, fetchImpl) {
  const setting = SETTINGS[key];
  if (setting?.type === "distribution") return promptDistribution(env, chatId, fetchImpl);
  if (!setting || ["boolean", "choice"].includes(setting.type)) {
    return showSetting(env, chatId, key, fetchImpl);
  }
  return sendMessage(
    env,
    chatId,
    `✏️ Configurar ${key}\n\n${setting.label}\n${setting.hint}\n\nResponda a esta mensagem com o novo valor.`,
    fetchImpl,
    { force_reply: true, selective: true, input_field_placeholder: "Digite o novo valor" },
  );
}

function storeSelectionIsSafe(key, value, variables) {
  if (!STORE_KEYS.includes(key)) return true;
  return STORE_KEYS.some((storeKey) =>
    (storeKey === key ? value : effectiveValue(storeKey, variables)) === "true");
}

async function proposeSetting(env, chatId, key, rawValue, fetchImpl) {
  if (!SETTINGS[key]) {
    return sendMessage(env, chatId, "⚠️ Configuração não permitida.", fetchImpl, settingsRootKeyboard());
  }
  if (SETTINGS[key].type === "distribution") {
    return sendMessage(env, chatId, "⚠️ Ajuste os quatro percentuais juntos para somarem 100%.", fetchImpl,
      { inline_keyboard: [[{ text: "🎚 Ajustar distribuição", callback_data: "distribution:prompt" }]] });
  }
  const result = validateSetting(key, rawValue);
  if (!result.ok) {
    return sendMessage(env, chatId, `⚠️ ${result.error}`, fetchImpl, settingKeyboard(key, SETTINGS[key].default));
  }
  const variables = await getVariables(env, fetchImpl);
  if (!storeSelectionIsSafe(key, result.value, variables)) {
    return sendMessage(
      env, chatId, "⚠️ Pelo menos uma loja precisa permanecer ativa.", fetchImpl,
      settingKeyboard(key, effectiveValue(key, variables)),
    );
  }
  const current = effectiveValue(key, variables);
  if (current === result.value) {
    return sendMessage(env, chatId, "ℹ️ Esse valor já está ativo.", fetchImpl, settingKeyboard(key, current));
  }
  return sendMessage(
    env,
    chatId,
    `Confirma esta alteração?\n\n${SETTINGS[key].label}\nDe: ${displayValue(key, current)}\nPara: ${displayValue(key, result.value)}`,
    fetchImpl,
    confirmKeyboard(key, result.value),
  );
}

async function applySetting(env, chatId, key, rawValue, callbackId, fetchImpl) {
  if (SETTINGS[key]?.type === "distribution") {
    return answerCallback(env, callbackId, "Ajuste os quatro percentuais juntos", fetchImpl);
  }
  const result = validateSetting(key, rawValue);
  if (!result.ok) {
    await answerCallback(env, callbackId, result.error, fetchImpl);
    return showSetting(env, chatId, key, fetchImpl);
  }
  const variables = await getVariables(env, fetchImpl);
  if (!storeSelectionIsSafe(key, result.value, variables)) {
    await answerCallback(env, callbackId, "Mantenha pelo menos uma loja ativa", fetchImpl);
    return showSetting(env, chatId, key, fetchImpl);
  }
  const before = effectiveValue(key, variables);
  await setVariable(env, key, result.value, fetchImpl);
  await recordAudit(env, { key, before, after: result.value }, fetchImpl);
  await answerCallback(env, callbackId, "Configuração atualizada", fetchImpl);
  const updated = { ...variables, [key]: result.value };
  return sendMessage(
    env,
    chatId,
    `✅ ${SETTINGS[key].label} atualizado para ${displayValue(key, result.value)}.\nA próxima execução já usará este valor.`,
    fetchImpl,
    categoryKeyboard(SETTINGS[key].category, updated),
  );
}

function distributionSummary(values) {
  return DISTRIBUTION_KEYS.map((key) => `${SETTINGS[key].label}: ${effectiveValue(key, values)}%`).join("\n");
}

async function promptDistribution(env, chatId, fetchImpl) {
  const variables = await getVariables(env, fetchImpl);
  return sendMessage(env, chatId,
    `✏️ Configurar DISTRIBUICAO\n\nEnvie quatro percentuais inteiros nesta ordem: Shopee, Mercado Livre, Amazon, AliExpress. A soma deve ser 100%.\n\nAtual:\n${distributionSummary(variables)}\n\nExemplo: 30 30 25 15\n\nSão metas: se uma loja não tiver oferta elegível, as outras podem ocupar a vaga. Para desligar uma loja, use o controle de ativação.`,
    fetchImpl, { force_reply: true, selective: true, input_field_placeholder: "30 30 25 15" });
}

async function proposeDistribution(env, chatId, rawValue, fetchImpl) {
  const result = validateDistribution(rawValue);
  if (!result.ok) {
    return sendMessage(env, chatId, `⚠️ ${result.error}\n\nUse /distribuicao 30 30 25 15 ou toque abaixo para tentar novamente.`,
      fetchImpl, { inline_keyboard: [[{ text: "🎚 Tentar novamente", callback_data: "distribution:prompt" }]] });
  }
  const variables = await getVariables(env, fetchImpl);
  if (DISTRIBUTION_KEYS.every((key) => effectiveValue(key, variables) === result.values[key])) {
    return sendMessage(env, chatId, "ℹ️ Essa distribuição já está ativa.", fetchImpl, categoryKeyboard("lojas", variables));
  }
  const encoded = DISTRIBUTION_KEYS.map((key) => result.values[key]).join(",");
  return sendMessage(env, chatId,
    `Confirma a nova distribuição?\n\nAtual:\n${distributionSummary(variables)}\n\nNova:\n${distributionSummary(result.values)}\n\nTotal: 100%. A próxima execução usará estas metas.`,
    fetchImpl, { inline_keyboard: [[
      { text: "✅ Confirmar", callback_data: `distribution:apply:${encoded}` },
      { text: "Cancelar", callback_data: "menu:lojas" },
    ]] });
}

async function applyDistribution(env, chatId, rawValue, callbackId, fetchImpl) {
  const result = validateDistribution(rawValue);
  if (!result.ok) {
    await answerCallback(env, callbackId, result.error, fetchImpl);
    return promptDistribution(env, chatId, fetchImpl);
  }
  const variables = await getVariables(env, fetchImpl);
  const changed = DISTRIBUTION_KEYS.filter((key) => effectiveValue(key, variables) !== result.values[key]);
  const completed = [];
  try {
    for (const key of changed) {
      await setVariable(env, key, result.values[key], fetchImpl);
      completed.push(key);
    }
  } catch (error) {
    const rollback = await Promise.allSettled(completed.map((key) => setVariable(env, key, effectiveValue(key, variables), fetchImpl)));
    const rollbackFailed = rollback.some((item) => item.status === "rejected");
    await answerCallback(env, callbackId, "Falha ao atualizar", fetchImpl);
    return sendMessage(env, chatId,
      rollbackFailed
        ? "⚠️ A atualização falhou e não foi possível restaurar todos os valores. Confira os percentuais atuais antes da próxima execução."
        : "⚠️ A atualização falhou. Os valores anteriores foram restaurados. Tente novamente.",
      fetchImpl, { inline_keyboard: [[{ text: "🏪 Ver lojas", callback_data: "menu:lojas" }]] });
  }
  await recordAudit(env, {
    key: "DISTRIBUICAO_LOJAS",
    before: DISTRIBUTION_KEYS.map((key) => effectiveValue(key, variables)).join("/"),
    after: DISTRIBUTION_KEYS.map((key) => result.values[key]).join("/"),
  }, fetchImpl);
  await answerCallback(env, callbackId, "Distribuição atualizada", fetchImpl);
  const updated = { ...variables, ...result.values };
  return sendMessage(env, chatId, `✅ Distribuição atualizada:\n\n${distributionSummary(updated)}\n\nA próxima execução usará estas metas.`,
    fetchImpl, categoryKeyboard("lojas", updated));
}

async function showAudit(env, chatId, fetchImpl) {
  const variables = await getVariables(env, fetchImpl);
  let history = [];
  try {
    const parsed = JSON.parse(variables[AUDIT_VARIABLE] || "[]");
    if (Array.isArray(parsed)) history = parsed;
  } catch {
    history = [];
  }
  if (!history.length) {
    return sendMessage(env, chatId, "🕘 Ainda não há alterações registradas pelo painel.", fetchImpl, settingsRootKeyboard());
  }
  const lines = history.slice(-8).reverse().map((entry) => {
    const setting = SETTINGS[entry.key];
    const label = setting?.label || entry.key;
    const before = setting ? displayValue(entry.key, entry.before) : entry.before;
    const after = setting ? displayValue(entry.key, entry.after) : entry.after;
    const date = String(entry.at || "").replace("T", " ").slice(0, 16);
    return `• ${date} UTC — ${label}: ${before} → ${after}`;
  });
  return sendMessage(env, chatId, `🕘 Últimas alterações\n\n${lines.join("\n")}`, fetchImpl, settingsRootKeyboard());
}

async function restoreDefaults(env, chatId, callbackId, fetchImpl) {
  const variables = await getVariables(env, fetchImpl);
  const defaults = defaultValues();
  const changed = Object.entries(defaults).filter(([key, value]) => effectiveValue(key, variables) !== value);
  for (const [key, value] of changed) await setVariable(env, key, value, fetchImpl);
  await recordAudit(env, {
    key: "PADROES_SEGUROS",
    before: `${changed.length} configuração(ões) personalizada(s)`,
    after: "restauradas",
  }, fetchImpl);
  await answerCallback(env, callbackId, "Padrões restaurados", fetchImpl);
  return sendMessage(
    env,
    chatId,
    `✅ Padrões seguros restaurados. ${changed.length} configuração(ões) foram alteradas.\nO modo de ritmo atual foi preservado.`,
    fetchImpl,
    settingsRootKeyboard(),
  );
}

function brasiliaTime(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export async function runScheduledReport(controller, env, fetchImpl = fetch) {
  const variables = await getVariables(env, fetchImpl);
  const now = brasiliaTime(new Date(controller?.scheduledTime || Date.now()));
  const hour = effectiveValue("RELATORIO_HORA", variables).padStart(2, "0");
  const minute = effectiveValue("RELATORIO_MINUTO", variables).padStart(2, "0");
  if (now.hour !== hour || now.minute !== minute) return false;
  await dispatchReport(env, fetchImpl);
  return true;
}

const NEXT_AUTOMATIC_DISPATCH_AT = "NEXT_AUTOMATIC_DISPATCH_AT";
const LAST_AUTOMATIC_DISPATCH_AT = "LAST_AUTOMATIC_DISPATCH_AT";
const AUTOMATIC_DISPATCH_MISSING_COUNT = "AUTOMATIC_DISPATCH_MISSING_COUNT";

async function automaticRunExists(env, attemptedAt, fetchImpl) {
  const response = await githubRequest(
    env, "/actions/workflows/bot.yml/runs?event=workflow_dispatch&per_page=20",
    { method: "GET" }, fetchImpl,
  );
  if (!response.ok) throw new Error(`github_runs_read_${response.status}`);
  const runs = (await response.json()).workflow_runs || [];
  return runs.some((run) =>
    Number.isFinite(Date.parse(run.created_at)) &&
    Date.parse(run.created_at) >= attemptedAt - 15000
  );
}

function integerVariable(variables, name, fallback) {
  const parsed = Number.parseInt(variables[name], 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function hoursVariable(variables) {
  return String(variables.HORAS_PICO || "12,13,18,19,20,21,22")
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 23);
}

function insidePublicationWindow(hour, variables) {
  const start = integerVariable(variables, "HORA_INICIO", 6);
  const end = integerVariable(variables, "HORA_FIM", 0);
  if (start <= end) return hour >= start && hour <= end;
  return hour >= start || hour <= end;
}

function randomInteger(minimum, maximum) {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return minimum + (bytes[0] % (maximum - minimum + 1));
}

function automaticIntervalMinutes(mode, peak) {
  if (mode === "rapido") return peak ? randomInteger(8, 11) : randomInteger(16, 22);
  if (mode === "normal") return peak ? 15 : 30;
  return peak ? 30 : 120;
}

export async function runScheduledAutomation(controller, env, fetchImpl = fetch) {
  const variables = await getVariables(env, fetchImpl);
  const mode = String(variables.BOT_MODE || "economico").toLowerCase();
  if (!MODES[mode] || mode === "pausado") return false;

  const scheduledTime = Number(controller?.scheduledTime || Date.now());
  const now = brasiliaTime(new Date(scheduledTime));
  const hour = Number.parseInt(now.hour, 10);
  if (!insidePublicationWindow(hour, variables)) return false;

  const nextAt = Number.parseInt(variables[NEXT_AUTOMATIC_DISPATCH_AT], 10);
  if (!Number.isFinite(nextAt)) {
    const minutes = automaticIntervalMinutes(mode, hoursVariable(variables).includes(hour));
    await setVariable(env, NEXT_AUTOMATIC_DISPATCH_AT, scheduledTime + minutes * 60000, fetchImpl);
    return false;
  }
  if (scheduledTime < nextAt) return false;

  const minutes = automaticIntervalMinutes(mode, hoursVariable(variables).includes(hour));
  const previousAttempt = Number.parseInt(variables[LAST_AUTOMATIC_DISPATCH_AT], 10);
  if (Number.isFinite(previousAttempt) && previousAttempt > 0) {
    if (await automaticRunExists(env, previousAttempt, fetchImpl)) {
      await setVariable(env, LAST_AUTOMATIC_DISPATCH_AT, 0, fetchImpl);
      await setVariable(env, AUTOMATIC_DISPATCH_MISSING_COUNT, 0, fetchImpl);
      await setVariable(env, NEXT_AUTOMATIC_DISPATCH_AT,
        scheduledTime + minutes * 60000, fetchImpl);
      console.log(JSON.stringify({ event: "automatic_dispatch_confirmed", previousAttempt }));
      return false;
    }
  }
  const misses = Number.parseInt(variables[AUTOMATIC_DISPATCH_MISSING_COUNT], 10) || 0;
  if (previousAttempt > 0 && misses >= 3) {
    await setVariable(env, LAST_AUTOMATIC_DISPATCH_AT, 0, fetchImpl);
    await setVariable(env, AUTOMATIC_DISPATCH_MISSING_COUNT, 0, fetchImpl);
    await setVariable(env, NEXT_AUTOMATIC_DISPATCH_AT,
      scheduledTime + 30 * 60000, fetchImpl);
    console.error(JSON.stringify({ event: "automatic_dispatch_missing", previousAttempt }));
    return false;
  }
  await dispatchBot(env, fetchImpl);
  await setVariable(env, LAST_AUTOMATIC_DISPATCH_AT, scheduledTime, fetchImpl);
  await setVariable(env, AUTOMATIC_DISPATCH_MISSING_COUNT,
    previousAttempt > 0 ? misses + 1 : 0, fetchImpl);
  // Confirmamos a criação de uma execução real no próximo cron. Um HTTP 204
  // sozinho já avançou o relógio antes sem aparecer nenhuma rodada no GitHub.
  await setVariable(env, NEXT_AUTOMATIC_DISPATCH_AT,
    scheduledTime + 2 * 60000, fetchImpl);
  console.log(JSON.stringify({ event: "automatic_dispatch_requested", scheduledTime }));
  return true;
}

function modeText(mode) {
  const selected = MODES[mode] || MODES.economico;
  return `${selected.label}: ${selected.detail}. Estimativa: ${selected.actionsPerDay} Actions/dia.`;
}

async function showStatus(env, chatId, fetchImpl) {
  const [mode, run] = await Promise.all([
    getMode(env, fetchImpl),
    latestSuccessfulRun(env, fetchImpl),
  ]);
  const lastRun = run?.created_at
    ? `\nÚltima execução bem-sucedida: ${run.created_at}`
    : "\nAinda não encontrei uma execução bem-sucedida.";
  await sendMessage(env, chatId, `🤖 Bot de ofertas\n${modeText(mode)}${lastRun}`,
    fetchImpl, panelKeyboard(mode));
}

async function showPanel(env, chatId, fetchImpl) {
  const mode = await getMode(env, fetchImpl);
  return sendMessage(env, chatId, panelText(), fetchImpl, panelKeyboard(mode));
}

async function chooseMode(env, chatId, mode, callbackId, fetchImpl) {
  const before = await getMode(env, fetchImpl);
  await setMode(env, mode, fetchImpl);
  if (before !== mode && mode !== "pausado") {
    // O prazo antigo pode ter sido calculado no modo Econômico (120 min fora
    // do pico). Recalcular evita que o Normal/Rápido espere esse prazo antigo.
    const variables = await getVariables(env, fetchImpl);
    const hour = Number.parseInt(brasiliaTime(new Date()).hour, 10);
    const minutes = automaticIntervalMinutes(mode, hoursVariable(variables).includes(hour));
    await setVariable(env, NEXT_AUTOMATIC_DISPATCH_AT, Date.now() + minutes * 60000, fetchImpl);
  }
  await recordAudit(env, { key: "BOT_MODE", before, after: mode }, fetchImpl);
  await answerCallback(env, callbackId, `Modo ${MODES[mode].label} ativado`, fetchImpl);
  await sendMessage(
    env,
    chatId,
    `✅ Configuração atualizada no GitHub.\n${modeText(mode)}`,
    fetchImpl,
    panelKeyboard(mode),
  );
}

export function helpText() {
  return [
    "❓ Ajuda do bot de ofertas",
    "",
    "Este painel controla quando o bot consulta as plataformas, quais ofertas podem passar e como ele escolhe o que publicar.",
    "",
    "Escolha abaixo o assunto que deseja entender. Cada configuração é explicada com seu efeito prático.",
    "",
    "Somente o administrador autorizado pode usar estes controles.",
  ].join("\n");
}

function panelText() {
  return [
    "🔐 Painel privado do bot de ofertas",
    "",
    "Escolha um modo, consulte o status, execute uma rodada ou abra as configurações.",
    "Use Ajuda para entender o efeito de cada função antes de alterar.",
  ].join("\n");
}

export function helpActionsText() {
  return [
    "🎛 Painel e comandos",
    "",
    "📊 Status (/status): mostra o modo atual e a última execução bem-sucedida. Não publica nada.",
    "📄 Relatório (/relatorio): pede ao GitHub o relatório privado imediatamente. É uma execução separada da busca de ofertas.",
    "▶️ Executar agora (/executar): inicia uma rodada extra. Ela pode publicar, mas continua respeitando horário, filtros, repetição e limite diário.",
    "⚙️ Configurações (/config): abre os controles operacionais. A mudança é validada, pede confirmação, fica registrada e vale na próxima execução.",
    "🏪 Distribuição (/distribuicao 30 30 25 15): define as metas percentuais de Shopee, Mercado Livre, Amazon e AliExpress; a soma deve ser 100%.",
    "🕘 Histórico (/historico): mostra as alterações recentes feitas por este painel.",
    "⏸ Pausar (/pausar): interrompe somente as rodadas automáticas. Configurações, histórico e relatório continuam disponíveis.",
    "▶️ Retomar (/retomar): reativa no modo Econômico; depois você pode escolher outro ritmo.",
    "↩️ Restaurar padrões: volta as configurações operacionais aos valores seguros, sem apagar credenciais nem trocar o modo.",
    "",
    "Também é possível usar /definir NOME VALOR para outras configurações. Os percentuais das lojas devem ser alterados juntos em /distribuicao.",
  ].join("\n");
}

export function helpModesText() {
  return [
    "⏱ Modos de ritmo",
    "",
    `💚 ${modeText("economico")} Bom para reduzir o consumo do GitHub.`,
    `⚡ ${modeText("normal")} Equilibra frequência e quantidade de Actions.`,
    `🚀 ${modeText("rapido")} Procura com mais frequência; não garante publicação se nenhuma oferta passar nos filtros.`,
    `⏸ ${modeText("pausado")} Use em manutenção ou quando não quiser novas ofertas.`,
    "",
    "O ritmo define quando consultar. O número de publicações continua limitado por Ofertas por rodada e Limite diário.",
  ].join("\n");
}

export function helpCategoryText(category) {
  const metadata = CATEGORIES[category];
  if (!metadata) return helpText();
  const explanations = settingsForCategory(category).map(([, setting]) =>
    `• ${setting.label}: ${setting.hint}`);
  const campaignHelp = category === "campanhas"
    ? [
        "",
        "▶️ Executar agora: cada campanha tem seu próprio botão. Após a confirmação, somente ela é publicada, mesmo fora do calendário. Campanhas desativadas continuam bloqueadas.",
      ]
    : [];
  return [
    `${metadata.label} — como funciona`,
    metadata.description,
    "",
    ...explanations,
    ...campaignHelp,
    "",
    "Para alterar, abra Configurações no painel. O novo valor passa a valer na próxima execução.",
  ].join("\n");
}

async function handleAuthorizedUpdate(update, env, fetchImpl) {
  const callback = update.callback_query;
  const chatId = callback?.message?.chat?.id || update.message.chat.id;
  const callbackData = String(callback?.data || "");
  if (callbackData.startsWith("mode:")) {
    const mode = callbackData.slice(5);
    if (!MODES[mode]) return answerCallback(env, callback.id, "Opção inválida", fetchImpl);
    return chooseMode(env, chatId, mode, callback.id, fetchImpl);
  }
  if (callbackData === "action:status") {
    await answerCallback(env, callback.id, "Consultando o GitHub…", fetchImpl);
    return showStatus(env, chatId, fetchImpl);
  }
  if (callbackData === "action:relatorio") {
    await dispatchReport(env, fetchImpl);
    await answerCallback(env, callback.id, "Relatório solicitado", fetchImpl);
    return sendMessage(env, chatId, "📄 Relatório solicitado. Ele chegará nesta conversa após a execução do GitHub.", fetchImpl);
  }
  if (callbackData === "action:executar:ask") {
    await answerCallback(env, callback.id, "Confirmação necessária", fetchImpl);
    return sendMessage(
      env,
      chatId,
      "▶️ Executar uma rodada agora?\n\nO bot buscará ofertas e poderá publicar conforme as regras atuais.",
      fetchImpl,
      { inline_keyboard: [[
        { text: "▶️ Executar rodada", callback_data: "action:executar:confirm" },
        { text: "Cancelar", callback_data: "menu:panel" },
      ]] },
    );
  }
  if (callbackData === "action:executar:confirm") {
    await dispatchBot(env, fetchImpl);
    await answerCallback(env, callback.id, "Rodada solicitada", fetchImpl);
    return sendMessage(env, chatId, "▶️ Rodada solicitada ao GitHub. A publicação seguirá as regras atuais do bot.", fetchImpl);
  }
  if (callbackData.startsWith("campaign:")) {
    const [, campaignId, action] = callbackData.split(":");
    const campaign = CAMPAIGNS[campaignId];
    if (!campaign || !["ask", "confirm"].includes(action)) {
      return answerCallback(env, callback.id, "Campanha inválida", fetchImpl);
    }
    const variables = await getVariables(env, fetchImpl);
    if (effectiveValue(campaign.activeSetting, variables) !== "true") {
      await answerCallback(env, callback.id, "Campanha desativada", fetchImpl);
      return sendMessage(
        env,
        chatId,
        `${campaign.emoji} ${campaign.label} está desativada. Ative a campanha antes de executá-la.`,
        fetchImpl,
        categoryKeyboard("campanhas", variables),
      );
    }
    if (action === "ask") {
      await answerCallback(env, callback.id, "Confirmação necessária", fetchImpl);
      return sendMessage(
        env,
        chatId,
        `${campaign.emoji} Publicar ${campaign.label} agora?\n\nO calendário e a repetição automática serão ignorados somente neste disparo.`,
        fetchImpl,
        { inline_keyboard: [[
          { text: `▶️ Publicar ${campaign.label}`, callback_data: `campaign:${campaignId}:confirm` },
          { text: "Cancelar", callback_data: "menu:campanhas" },
        ]] },
      );
    }
    await dispatchCampaign(env, campaignId, fetchImpl);
    await answerCallback(env, callback.id, "Campanha solicitada", fetchImpl);
    return sendMessage(
      env,
      chatId,
      `${campaign.emoji} ${campaign.label} foi solicitada ao GitHub e será processada no Telegram.`,
      fetchImpl,
      categoryKeyboard("campanhas", variables),
    );
  }
  if (callbackData === "menu:panel") {
    await answerCallback(env, callback.id, "Painel principal", fetchImpl);
    return showPanel(env, chatId, fetchImpl);
  }
  if (callbackData === "menu:root") {
    await answerCallback(env, callback.id, "Configurações", fetchImpl);
    return showConfigurationRoot(env, chatId, fetchImpl);
  }
  if (callbackData === "help:root" || callbackData === "help:settings") {
    await answerCallback(env, callback.id, "Ajuda", fetchImpl);
    return sendMessage(env, chatId, helpText(), fetchImpl, helpKeyboard());
  }
  if (callbackData === "help:actions") {
    await answerCallback(env, callback.id, "Painel e comandos", fetchImpl);
    return sendMessage(env, chatId, helpActionsText(), fetchImpl, helpBackKeyboard());
  }
  if (callbackData === "help:modes") {
    await answerCallback(env, callback.id, "Modos de ritmo", fetchImpl);
    return sendMessage(env, chatId, helpModesText(), fetchImpl, helpBackKeyboard());
  }
  if (callbackData.startsWith("help:")) {
    const category = callbackData.slice(5);
    await answerCallback(env, callback.id, "Explicação", fetchImpl);
    return sendMessage(env, chatId, helpCategoryText(category), fetchImpl, helpBackKeyboard());
  }
  if (callbackData.startsWith("menu:")) {
    const category = callbackData.slice(5);
    await answerCallback(env, callback.id, "Consultando…", fetchImpl);
    return showCategory(env, chatId, category, fetchImpl);
  }
  if (callbackData === "distribution:prompt") {
    await answerCallback(env, callback.id, "Envie os quatro percentuais", fetchImpl);
    return promptDistribution(env, chatId, fetchImpl);
  }
  if (callbackData.startsWith("distribution:apply:")) {
    return applyDistribution(env, chatId, callbackData.slice("distribution:apply:".length), callback.id, fetchImpl);
  }
  if (callbackData.startsWith("setting:")) {
    const key = callbackData.slice(8);
    await answerCallback(env, callback.id, "Consultando…", fetchImpl);
    return showSetting(env, chatId, key, fetchImpl);
  }
  if (callbackData.startsWith("prompt:")) {
    const key = callbackData.slice(7);
    await answerCallback(env, callback.id, "Envie o novo valor", fetchImpl);
    return promptSetting(env, chatId, key, fetchImpl);
  }
  if (callbackData.startsWith("propose:")) {
    const [, key, ...valueParts] = callbackData.split(":");
    await answerCallback(env, callback.id, "Revise antes de confirmar", fetchImpl);
    return proposeSetting(env, chatId, key, valueParts.join(":"), fetchImpl);
  }
  if (callbackData.startsWith("apply:")) {
    const [, key, ...valueParts] = callbackData.split(":");
    return applySetting(env, chatId, key, valueParts.join(":"), callback.id, fetchImpl);
  }
  if (callbackData === "action:audit") {
    await answerCallback(env, callback.id, "Consultando histórico…", fetchImpl);
    return showAudit(env, chatId, fetchImpl);
  }
  if (callbackData === "defaults:ask") {
    await answerCallback(env, callback.id, "Confirmação necessária", fetchImpl);
    return sendMessage(
      env,
      chatId,
      "↩️ Restaurar todas as configurações operacionais aos padrões seguros?\n\nO modo de ritmo e todas as credenciais serão preservados.",
      fetchImpl,
      { inline_keyboard: [[
        { text: "✅ Restaurar", callback_data: "defaults:confirm" },
        { text: "Cancelar", callback_data: "menu:root" },
      ]] },
    );
  }
  if (callbackData === "defaults:confirm") {
    return restoreDefaults(env, chatId, callback.id, fetchImpl);
  }

  const replyText = String(update.message?.reply_to_message?.text || "");
  if (replyText.startsWith("✏️ Configurar DISTRIBUICAO")) {
    return proposeDistribution(env, chatId, update.message?.text, fetchImpl);
  }
  const promptMatch = replyText.match(/^✏️ Configurar ([A-Z0-9_]+)/);
  if (promptMatch && SETTINGS[promptMatch[1]]) {
    return proposeSetting(env, chatId, promptMatch[1], update.message?.text, fetchImpl);
  }

  const { name, args } = parseCommand(update.message?.text);
  if (["ajuda", "help"].includes(name)) {
    return sendMessage(env, chatId, helpText(), fetchImpl, helpKeyboard());
  }
  if (["start", "painel"].includes(name)) {
    return showPanel(env, chatId, fetchImpl);
  }
  if (name === "status") return showStatus(env, chatId, fetchImpl);
  if (["config", "configuracoes", "configurações"].includes(name)) {
    return showConfigurationRoot(env, chatId, fetchImpl);
  }
  if (name === "distribuicao" || name === "distribuição") {
    return args.length ? proposeDistribution(env, chatId, args.join(" "), fetchImpl) : promptDistribution(env, chatId, fetchImpl);
  }
  if (["historico", "histórico"].includes(name)) return showAudit(env, chatId, fetchImpl);
  if (name === "pausar") return chooseMode(env, chatId, "pausado", null, fetchImpl);
  if (name === "retomar") return chooseMode(env, chatId, "economico", null, fetchImpl);
  if (name === "ritmo" && ["economico", "normal", "rapido"].includes(args[0])) {
    return chooseMode(env, chatId, args[0], null, fetchImpl);
  }
  if (name === "relatorio") {
    await dispatchReport(env, fetchImpl);
    return sendMessage(env, chatId, "📄 Relatório solicitado. Ele chegará nesta conversa após a execução do GitHub.", fetchImpl);
  }
  if (name === "executar") {
    return sendMessage(
      env,
      chatId,
      "▶️ Executar uma rodada agora?\n\nO bot buscará ofertas e poderá publicar conforme as regras atuais.",
      fetchImpl,
      { inline_keyboard: [[
        { text: "▶️ Executar rodada", callback_data: "action:executar:confirm" },
        { text: "Cancelar", callback_data: "menu:panel" },
      ]] },
    );
  }
  if (name === "definir" && args.length >= 2) {
    return proposeSetting(env, chatId, args[0].toUpperCase(), args.slice(1).join(" "), fetchImpl);
  }
  return sendMessage(env, chatId, `Comando não reconhecido.\n\n${helpText()}`, fetchImpl);
}

export async function handleRequest(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return textResponse("ok");
  }
  if (request.method === "POST" && url.pathname === "/internal/scheduled") {
    const expectedSecret = String(env.SCHEDULER_SHARED_SECRET || "");
    const receivedSecret = request.headers.get("X-Internal-Scheduler-Secret");
    if (!expectedSecret || !await constantTimeEqual(receivedSecret, expectedSecret)) {
      return textResponse("not found", 404);
    }
    const scheduledTime = Number(request.headers.get("X-Scheduled-Time") || Date.now());
    if (!Number.isFinite(scheduledTime) || scheduledTime <= 0) {
      return textResponse("bad request", 400);
    }
    try {
      await runScheduledTasks({ scheduledTime }, env, fetchImpl);
      console.log(JSON.stringify({ event: "fallback_schedule_processed", scheduledTime }));
      return textResponse("ok");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "scheduled_task_error";
      console.error(JSON.stringify({ event: "fallback_schedule_failed", reason }));
      return textResponse("internal error", 500);
    }
  }
  if (request.method !== "POST" || url.pathname !== "/telegram") {
    return textResponse("not found", 404);
  }
  const expectedSecret = String(env.TELEGRAM_WEBHOOK_SECRET || "");
  const receivedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!expectedSecret || !await constantTimeEqual(receivedSecret, expectedSecret)) {
    return textResponse("not found", 404);
  }
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 32768) return textResponse("too large", 413);

  let update;
  try {
    const rawBody = await request.text();
    if (rawBody.length > 32768) return textResponse("too large", 413);
    update = JSON.parse(rawBody);
  } catch {
    return textResponse("bad request", 400);
  }
  if (!authorizedUpdate(update, env)) return textResponse("ok");

  try {
    await handleAuthorizedUpdate(update, env, fetchImpl);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    console.error("authorized_command_failed", reason);
    const chat = update?.callback_query?.message?.chat || update?.message?.chat;
    try {
      await sendMessage(
        env,
        chat.id,
        "⚠️ Não consegui concluir o comando. A configuração anterior foi preservada.",
        fetchImpl,
      );
    } catch {
      // Não registra conteúdo, IDs ou tokens em logs públicos.
    }
  }
  return textResponse("ok");
}

export function selectFetch(candidate) {
  return typeof candidate === "function" ? candidate : fetch;
}

export async function runScheduledUsageMonitor(controller, env, fetchImpl = fetch) {
  if (env.USAGE_MONITOR_ENABLED !== "true") return false;
  const scheduledTime = Number(controller?.scheduledTime || Date.now());
  try {
    return await checkUsageLimit({
      env, scheduledTime, fetchImpl,
      getVariables: () => getVariables(env, fetchImpl),
      setVariable: (name, value) => setVariable(env, name, value, fetchImpl),
      notify: (message) => sendMessage(env, adminId(env), message, fetchImpl, null),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "usage_monitor_error";
    console.error(JSON.stringify({ event: "usage_monitor_failed", reason }));
    // Erros do monitor não podem impedir a rodada normal de ofertas.
    const date = new Date(scheduledTime);
    if (date.getUTCMinutes() === 0) {
      try {
        await sendMessage(env, adminId(env),
          "⚠️ Não consegui conferir o limite gratuito do GitHub Actions. "
          + "A mudança automática de visibilidade não está garantida. Confira o monitor.",
          fetchImpl, null);
      } catch {
        console.error(JSON.stringify({ event: "usage_monitor_alert_failed" }));
      }
    }
    return false;
  }
}

export async function runScheduledTasks(controller, env, fetchImpl = fetch) {
  await Promise.all([
    runScheduledReport(controller, env, fetchImpl),
    runScheduledAutomation(controller, env, fetchImpl),
    runScheduledUsageMonitor(controller, env, fetchImpl),
  ]);
}

export default {
  fetch(request, env, contextOrFetch) {
    return handleRequest(request, env, selectFetch(contextOrFetch));
  },
  async scheduled(controller, env, context) {
    const task = runScheduledTasks(controller, env).catch((error) => {
      const reason = error instanceof Error ? error.message : "scheduled_task_error";
      console.error(JSON.stringify({ event: "scheduled_task_failed", reason }));
    });
    if (context?.waitUntil) context.waitUntil(task);
    else await task;
  },
};
