import assert from "node:assert/strict";
import test from "node:test";

import worker, {
  authorizedUpdate, helpActionsText, helpCategoryText, helpModesText, helpText,
  parseCommand, runScheduledAutomation, runScheduledReport, selectFetch,
} from "../src/index.js";
import { CATEGORIES, SETTINGS, settingsForCategory, validateSetting } from "../src/settings.js";


const env = {
  TELEGRAM_BOT_TOKEN: "telegram-secret",
  TELEGRAM_ADMIN_ID: "123",
  TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
  SCHEDULER_SHARED_SECRET: "scheduler-secret",
  GITHUB_TOKEN: "github-secret",
  GITHUB_OWNER: "owner",
  GITHUB_REPO: "repo",
  GITHUB_DEFAULT_BRANCH: "main",
};

function update(text = "/status", user = 123) {
  return {
    update_id: 1,
    message: {
      text,
      from: { id: user },
      chat: { id: user, type: "private" },
    },
  };
}

function request(body, secret = "webhook-secret") {
  return new Request("https://controller.example/telegram", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": secret,
    },
    body: JSON.stringify(body),
  });
}

function callback(data, user = 123) {
  return {
    update_id: 2,
    callback_query: {
      id: "callback-id",
      data,
      from: { id: user },
      message: { chat: { id: user, type: "private" } },
    },
  };
}

test("interpreta comando sem aceitar o nome mencionado do bot", () => {
  assert.deepEqual(parseCommand("/ritmo@bot_teste NORMAL"), {
    name: "ritmo",
    args: ["normal"],
  });
});

test("usa fetch real quando o cloudflare fornece contexto de execucao", () => {
  const fakeFetch = async () => new Response();
  assert.equal(selectFetch(fakeFetch), fakeFetch);
  assert.equal(selectFetch({ waitUntil() {} }), globalThis.fetch);
});

test("exige a conversa privada exclusiva do administrador", () => {
  assert.equal(authorizedUpdate(update(), env), true);
  assert.equal(authorizedUpdate(update("/status", 999), env), false);
  const callback = {
    callback_query: {
      from: { id: 999 },
      message: { chat: { id: 123, type: "private" } },
    },
  };
  assert.equal(authorizedUpdate(callback, env), false);
  callback.callback_query.from.id = 123;
  assert.equal(authorizedUpdate(callback, env), true);
  const group = update();
  group.message.chat.type = "group";
  assert.equal(authorizedUpdate(group, env), false);
});

test("rejeita webhook sem segredo sem chamar servicos externos", async () => {
  let calls = 0;
  const response = await worker.fetch(request(update(), "errado"), env, async () => {
    calls += 1;
    return new Response();
  });
  assert.equal(response.status, 404);
  assert.equal(calls, 0);
});

test("rota interna exige segredo e executa as tarefas pelo horario recebido", async () => {
  let calls = 0;
  const fakeFetch = async (url, options = {}) => {
    calls += 1;
    if (String(url).includes("/actions/variables?")) {
      return Response.json({ variables: [{ name: "BOT_MODE", value: "pausado" }] });
    }
    return new Response(null, { status: options.method === "POST" ? 204 : 200 });
  };
  const baseRequest = (secret) => new Request("https://controller.example/internal/scheduled", {
    method: "POST",
    headers: {
      "X-Internal-Scheduler-Secret": secret,
      "X-Scheduled-Time": String(Date.parse("2026-09-06T14:00:00Z")),
    },
  });

  assert.equal((await worker.fetch(baseRequest("errado"), env, fakeFetch)).status, 404);
  assert.equal(calls, 0);
  assert.equal((await worker.fetch(baseRequest("scheduler-secret"), env, fakeFetch)).status, 200);
  assert.equal(calls, 2);
});

test("ignora silenciosamente usuario nao autorizado", async () => {
  let calls = 0;
  const response = await worker.fetch(request(update("/status", 999)), env, async () => {
    calls += 1;
    return new Response();
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 0);
});

test("ignora clique de outro usuario mesmo se a mensagem indicar o chat administrador", async () => {
  let calls = 0;
  const callback = {
    callback_query: {
      id: "callback-id",
      data: "mode:rapido",
      from: { id: 999 },
      message: { chat: { id: 123, type: "private" } },
    },
  };
  const response = await worker.fetch(request(callback), env, async () => {
    calls += 1;
    return new Response();
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 0);
});

test("modo normal altera apenas a variavel permitida e confirma no telegram", async () => {
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/actions/variables/BOT_MODE") && options.method === "GET") {
      return Response.json({ value: "economico" });
    }
    if (String(url).includes("/actions/variables/BOT_MODE")) {
      return new Response(null, { status: 204 });
    }
    if (String(url).includes("/actions/variables?")) return Response.json({ variables: [] });
    if (String(url).includes("api.github.com") && options.method === "PATCH") {
      return new Response(null, { status: 204 });
    }
    if (String(url).includes("api.telegram.org")) {
      return Response.json({ ok: true });
    }
    return new Response(null, { status: 500 });
  };
  const response = await worker.fetch(request(update("/ritmo normal")), env, fakeFetch);
  assert.equal(response.status, 200);
  const github = calls.find((call) => call.options.method === "PATCH" && call.url.includes("BOT_MODE"));
  assert.equal(github.options.method, "PATCH");
  assert.deepEqual(JSON.parse(github.options.body), { name: "BOT_MODE", value: "normal" });
  assert.equal(github.options.headers["User-Agent"], "deal-signal-control");
  assert.equal(github.options.headers.Authorization, "Bearer github-secret");
  const telegram = calls.find((call) => call.url.includes("api.telegram.org"));
  assert.equal(JSON.parse(telegram.options.body).chat_id, 123);
  assert.equal(JSON.stringify(calls).includes("webhook-secret"), false);
});

test("modo rapido usa a opcao fechada e informa o novo ritmo", async () => {
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/actions/variables/BOT_MODE") && options.method === "GET") {
      return Response.json({ value: "normal" });
    }
    if (String(url).includes("/actions/variables/BOT_MODE")) {
      return new Response(null, { status: 204 });
    }
    if (String(url).includes("/actions/variables?")) return Response.json({ variables: [] });
    return Response.json({ ok: true });
  };
  const response = await worker.fetch(request(update("/ritmo rapido")), env, fakeFetch);
  assert.equal(response.status, 200);
  const github = calls.find((call) => call.options.method === "PATCH" && call.url.includes("BOT_MODE"));
  assert.deepEqual(JSON.parse(github.options.body), { name: "BOT_MODE", value: "rapido" });
  const telegram = calls.find((call) => call.url.includes("api.telegram.org"));
  const message = JSON.parse(telegram.options.body).text;
  assert.match(message, /Rápido: 8–11 min no pico e 16–22 min fora dele/);
  assert.match(message, /82 Actions\/dia/);
});

test("relatorio dispara somente o workflow existente", async () => {
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/dispatches")) return new Response(null, { status: 204 });
    return Response.json({ ok: true });
  };
  const response = await worker.fetch(request(update("/relatorio")), env, fakeFetch);
  assert.equal(response.status, 200);
  const dispatch = calls.find((call) => call.url.includes("/dispatches"));
  assert.deepEqual(JSON.parse(dispatch.options.body), {
    ref: "main",
    inputs: { somente_relatorio: "true" },
  });
});

test("execucao manual pede confirmacao e dispara somente a rodada autorizada", async () => {
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/dispatches")) return new Response(null, { status: 204 });
    return Response.json({ ok: true });
  };
  await worker.fetch(request(callback("action:executar:ask")), env, fakeFetch);
  const confirmation = calls.find((call) => call.url.includes("api.telegram.org") &&
    JSON.parse(call.options.body).text.includes("Executar uma rodada agora"));
  assert.ok(confirmation);
  assert.equal(calls.some((call) => call.url.includes("/dispatches")), false);

  calls.length = 0;
  await worker.fetch(request(callback("action:executar:confirm")), env, fakeFetch);
  const dispatch = calls.find((call) => call.url.includes("/dispatches"));
  assert.deepEqual(JSON.parse(dispatch.options.body), {
    ref: "main",
    inputs: { executar_bot: "true" },
  });
});

test("campanha Shopee VIP possui execucao individual com confirmacao", async () => {
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/actions/variables?")) {
      return Response.json({ variables: [{ name: "SHOPEE_VIP_ATIVO", value: "true" }] });
    }
    if (String(url).includes("/dispatches")) return new Response(null, { status: 204 });
    return Response.json({ ok: true });
  };

  await worker.fetch(request(callback("menu:campanhas")), env, fakeFetch);
  const menu = calls.find((call) => call.url.includes("api.telegram.org") &&
    JSON.parse(call.options.body).reply_markup?.inline_keyboard?.flat().some(
      (button) => button.callback_data === "campaign:shopee_vip:ask"));
  assert.ok(menu);

  calls.length = 0;
  await worker.fetch(request(callback("campaign:shopee_vip:ask")), env, fakeFetch);
  assert.equal(calls.some((call) => call.url.includes("/dispatches")), false);
  const confirmation = calls.find((call) => call.url.includes("api.telegram.org") &&
    JSON.parse(call.options.body).reply_markup?.inline_keyboard?.flat().some(
      (button) => button.callback_data === "campaign:shopee_vip:confirm"));
  assert.ok(confirmation);

  calls.length = 0;
  await worker.fetch(request(callback("campaign:shopee_vip:confirm")), env, fakeFetch);
  const dispatch = calls.find((call) => call.url.includes("/dispatches"));
  assert.deepEqual(JSON.parse(dispatch.options.body), {
    ref: "main",
    inputs: { campanha: "shopee_vip" },
  });
});

test("campanha desativada nao pode ser executada manualmente", async () => {
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/actions/variables?")) {
      return Response.json({ variables: [{ name: "SHOPEE_VIP_ATIVO", value: "false" }] });
    }
    return Response.json({ ok: true });
  };
  await worker.fetch(request(callback("campaign:shopee_vip:confirm")), env, fakeFetch);
  assert.equal(calls.some((call) => call.url.includes("/dispatches")), false);
  const warning = calls.find((call) => call.url.includes("api.telegram.org") &&
    JSON.parse(call.options.body).text?.includes("está desativada"));
  assert.ok(warning);
});

test("todas as configuracoes expostas possuem padrao e validacao", () => {
  assert.ok(Object.keys(SETTINGS).length >= 20);
  for (const [key, setting] of Object.entries(SETTINGS)) {
    assert.ok(setting.category);
    assert.ok(setting.label);
    assert.equal(validateSetting(key, setting.default).ok, true, key);
  }
  assert.equal(validateSetting("MIN_RATING", "5.1").ok, false);
  assert.equal(validateSetting("HORAS_PICO", "1,12,18").ok, false);
  assert.equal(validateSetting("RELATORIO_MINUTO", "17").ok, false);
  assert.deepEqual(validateSetting("SHOPEE_VIP_DIAS", "0,2,5"), { ok: true, value: "0,2,5" });
  assert.equal(validateSetting("SHOPEE_VIP_DIAS", "0,7").ok, false);
  assert.deepEqual(validateSetting("FACEBOOK_MAX_POSTS_DIA", "4"), { ok: true, value: "4" });
  assert.deepEqual(validateSetting("FACEBOOK_MAX_POSTS_DIA", "0"), { ok: true, value: "0" });
  assert.equal(validateSetting("FACEBOOK_MAX_POSTS_DIA", "1000001").ok, false);
});

test("ajuda explica comandos modos e todas as configuracoes", () => {
  assert.match(helpText(), /efeito prático/);
  assert.match(helpActionsText(), /Executar agora/);
  assert.match(helpActionsText(), /continua respeitando horário, filtros, repetição e limite diário/);
  assert.match(helpModesText(), /não garante publicação/);
  for (const category of Object.keys(CATEGORIES)) {
    const text = helpCategoryText(category);
    for (const [, setting] of settingsForCategory(category)) {
      assert.ok(text.includes(setting.label));
      assert.ok(text.includes(setting.hint));
    }
    assert.ok(text.length < 4096, category);
  }
});

test("comando ajuda abre indice interativo com todas as categorias", async () => {
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return Response.json({ ok: true });
  };
  await worker.fetch(request(update("/ajuda")), env, fakeFetch);
  const telegram = calls.find((call) => call.url.includes("api.telegram.org"));
  const body = JSON.parse(telegram.options.body);
  assert.match(body.text, /Ajuda do bot/);
  for (const category of Object.keys(CATEGORIES)) {
    assert.match(JSON.stringify(body.reply_markup), new RegExp(`help:${category}`));
  }
});

test("painel de configuracoes mostra valores efetivos sem expor segredos", async () => {
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/actions/variables?")) {
      return Response.json({ variables: [{ name: "MIN_RATING", value: "4.3" }] });
    }
    return Response.json({ ok: true });
  };
  const response = await worker.fetch(request(update("/config")), env, fakeFetch);
  assert.equal(response.status, 200);
  const telegram = calls.find((call) => call.url.includes("api.telegram.org"));
  const body = JSON.parse(telegram.options.body);
  assert.match(body.text, /Configurações do bot/);
  assert.match(JSON.stringify(body.reply_markup), /menu:lojas/);
  assert.equal(body.text.includes("github-secret"), false);
});

test("resposta numerica apenas prepara confirmacao antes de alterar", async () => {
  const calls = [];
  const message = update("4,5");
  message.message.reply_to_message = { text: "✏️ Configurar MIN_RATING\n\nNota mínima" };
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/actions/variables?")) return Response.json({ variables: [] });
    return Response.json({ ok: true });
  };
  await worker.fetch(request(message), env, fakeFetch);
  assert.equal(calls.some((call) => call.options.method === "PATCH"), false);
  const telegram = calls.find((call) => call.url.includes("api.telegram.org"));
  const body = JSON.parse(telegram.options.body);
  assert.match(body.text, /De: 4/);
  assert.match(body.text, /Para: 4,5/);
  assert.match(JSON.stringify(body.reply_markup), /apply:MIN_RATING:4.5/);
});

test("confirmacao altera somente variavel permitida e registra historico", async () => {
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/actions/variables?")) return Response.json({ variables: [] });
    if (String(url).includes("api.github.com")) return new Response(null, { status: 204 });
    return Response.json({ ok: true });
  };
  await worker.fetch(request(callback("apply:MIN_RATING:4.5")), env, fakeFetch);
  const patches = calls.filter((call) => call.options.method === "PATCH");
  assert.deepEqual(JSON.parse(patches[0].options.body), { name: "MIN_RATING", value: "4.5" });
  assert.equal(JSON.parse(patches[1].options.body).name, "BOT_CONFIG_AUDIT");
  assert.equal(JSON.stringify(calls).includes("TELEGRAM_BOT_TOKEN"), false);
});

test("nao permite desativar todas as lojas", async () => {
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/actions/variables?")) {
      return Response.json({ variables: [
        { name: "SHOPEE_ATIVA", value: "true" },
        { name: "ALIEXPRESS_ATIVA", value: "false" },
        { name: "AMAZON_ATIVA", value: "false" },
      ] });
    }
    return Response.json({ ok: true });
  };
  await worker.fetch(request(callback("propose:SHOPEE_ATIVA:false")), env, fakeFetch);
  assert.equal(calls.some((call) => call.options.method === "PATCH"), false);
  const message = calls.filter((call) => call.url.includes("api.telegram.org")).at(-1);
  assert.match(JSON.parse(message.options.body).text, /Pelo menos uma loja/);
});

test("agendador privado dispara relatorio apenas no horario configurado", async () => {
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/actions/variables?")) {
      return Response.json({ variables: [
        { name: "RELATORIO_HORA", value: "11" },
        { name: "RELATORIO_MINUTO", value: "30" },
      ] });
    }
    return new Response(null, { status: 204 });
  };
  const matching = Date.parse("2026-08-25T14:30:00Z");
  assert.equal(await runScheduledReport({ scheduledTime: matching }, env, fakeFetch), true);
  assert.equal(calls.some((call) => call.url.includes("/dispatches")), true);
  calls.length = 0;
  assert.equal(await runScheduledReport({ scheduledTime: matching + 15 * 60000 }, env, fakeFetch), false);
  assert.equal(calls.some((call) => call.url.includes("/dispatches")), false);
});

test("agendador automatico espera o horario sorteado e entao dispara uma rodada", async () => {
  const calls = [];
  let nextAt = null;
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/actions/variables?")) {
      const variables = [
        { name: "BOT_MODE", value: "rapido" },
        { name: "HORA_INICIO", value: "6" },
        { name: "HORA_FIM", value: "0" },
        { name: "HORAS_PICO", value: "12" },
      ];
      if (nextAt) variables.push({ name: "NEXT_AUTOMATIC_DISPATCH_AT", value: String(nextAt) });
      return Response.json({ variables });
    }
    if (String(url).includes("NEXT_AUTOMATIC_DISPATCH_AT")) {
      nextAt = JSON.parse(options.body).value;
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 204 });
  };
  const now = Date.parse("2026-08-25T15:00:00Z");
  assert.equal(await runScheduledAutomation({ scheduledTime: now }, env, fakeFetch), false);
  assert.ok(Number(nextAt) >= now + 8 * 60000);
  assert.ok(Number(nextAt) <= now + 11 * 60000);
  calls.length = 0;
  assert.equal(await runScheduledAutomation({ scheduledTime: Number(nextAt) }, env, fakeFetch), true);
  assert.equal(calls.filter((call) => call.url.includes("/dispatches")).length, 1);
});
