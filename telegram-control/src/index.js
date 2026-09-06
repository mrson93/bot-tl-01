import {
  AUDIT_VARIABLE,
  CATEGORIES,
  SETTINGS,
  STORE_KEYS,
  defaultValues,
  displayValue,
  effectiveValue,
  settingsForCategory,
  validateSetting,
} from "./settings.js";

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

function constantTimeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
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

function panelKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "💚 Econômico", callback_data: "mode:economico" },
        { text: "⚡ Normal", callback_data: "mode:normal" },
      ],
      [{ text: "🚀 Rápido", callback_data: "mode:rapido" }],
      [{ text: "⏸ Pausar", callback_data: "mode:pausado" }],
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
      [
        { text: CATEGORIES.horarios.label, callback_data: "menu:horarios" },
        { text: CATEGORIES.variedade.label, callback_data: "menu:variedade" },
      ],
      [
        { text: CATEGORIES.relatorio.label, callback_data: "menu:relatorio" },
        { text: CATEGORIES.selecao.label, callback_data: "menu:selecao" },
      ],
      [{ text: CATEGORIES.cupons.label, callback_data: "menu:cupons" }],
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
      [{ text: CATEGORIES.selecao.label, callback_data: "help:selecao" }],
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
  const response = await githubRequest(
    env, "/actions/variables?per_page=100", { method: "GET" }, fetchImpl,
  );
  if (!response.ok) throw new Error(`github_variables_read_${response.status}`);
  const variables = (await response.json()).variables || [];
  return Object.fromEntries(variables.map((item) => [String(item.name), String(item.value)]));
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

function categoryKeyboard(category, variables) {
  const rows = settingsForCategory(category).map(([key, setting]) => [{
    text: `${setting.label}: ${displayValue(key, effectiveValue(key, variables))}`.slice(0, 60),
    callback_data: `setting:${key}`,
  }]);
  rows.push([{ text: "⬅️ Configurações", callback_data: "menu:root" }]);
  return { inline_keyboard: rows };
}

function settingKeyboard(key, value) {
  const setting = SETTINGS[key];
  const rows = [];
  if (setting.type === "boolean") {
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
  if (value !== setting.default) {
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
  // Reservar o próximo horário antes do disparo impede duplicação caso o
  // Cloudflare repita um evento de cron enquanto o GitHub responde.
  await setVariable(env, NEXT_AUTOMATIC_DISPATCH_AT, scheduledTime + minutes * 60000, fetchImpl);
  await dispatchBot(env, fetchImpl);
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
  await sendMessage(env, chatId, `🤖 Bot de ofertas\n${modeText(mode)}${lastRun}`, fetchImpl);
}

async function chooseMode(env, chatId, mode, callbackId, fetchImpl) {
  const before = await getMode(env, fetchImpl);
  await setMode(env, mode, fetchImpl);
  await recordAudit(env, { key: "BOT_MODE", before, after: mode }, fetchImpl);
  await answerCallback(env, callbackId, `Modo ${MODES[mode].label} ativado`, fetchImpl);
  await sendMessage(
    env,
    chatId,
    `✅ Configuração atualizada no GitHub.\n${modeText(mode)}`,
    fetchImpl,
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
    "🕘 Histórico (/historico): mostra as alterações recentes feitas por este painel.",
    "⏸ Pausar (/pausar): interrompe somente as rodadas automáticas. Configurações, histórico e relatório continuam disponíveis.",
    "▶️ Retomar (/retomar): reativa no modo Econômico; depois você pode escolher outro ritmo.",
    "↩️ Restaurar padrões: volta as configurações operacionais aos valores seguros, sem apagar credenciais nem trocar o modo.",
    "",
    "Também é possível usar /definir NOME VALOR, mas os botões são mais seguros porque mostram a confirmação.",
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
  return [
    `${metadata.label} — como funciona`,
    metadata.description,
    "",
    ...explanations,
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
  if (callbackData === "menu:panel") {
    await answerCallback(env, callback.id, "Painel principal", fetchImpl);
    return sendMessage(env, chatId, panelText(), fetchImpl);
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
  const promptMatch = replyText.match(/^✏️ Configurar ([A-Z0-9_]+)/);
  if (promptMatch && SETTINGS[promptMatch[1]]) {
    return proposeSetting(env, chatId, promptMatch[1], update.message?.text, fetchImpl);
  }

  const { name, args } = parseCommand(update.message?.text);
  if (["ajuda", "help"].includes(name)) {
    return sendMessage(env, chatId, helpText(), fetchImpl, helpKeyboard());
  }
  if (["start", "painel"].includes(name)) {
    return sendMessage(env, chatId, panelText(), fetchImpl);
  }
  if (name === "status") return showStatus(env, chatId, fetchImpl);
  if (["config", "configuracoes", "configurações"].includes(name)) {
    return showConfigurationRoot(env, chatId, fetchImpl);
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
    if (!expectedSecret || !constantTimeEqual(receivedSecret, expectedSecret)) {
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
  if (!expectedSecret || !constantTimeEqual(receivedSecret, expectedSecret)) {
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

export async function runScheduledTasks(controller, env, fetchImpl = fetch) {
  await Promise.all([
    runScheduledReport(controller, env, fetchImpl),
    runScheduledAutomation(controller, env, fetchImpl),
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
