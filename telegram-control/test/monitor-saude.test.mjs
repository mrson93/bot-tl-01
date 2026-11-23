import assert from "node:assert/strict";
import test from "node:test";

import { coletaAtrasada, estatisticas, intervaloDoMonitor, textoColetaAtrasada } from "../src/monitor.js";
import { runScheduledMonitor } from "../src/index.js";

const HORA = 3600;
function fakeDb(first) {
  const consultas = [];
  return {
    consultas,
    prepare(sql) {
      return {
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() { consultas.push([sql, this.args]); return first(sql, this.args); },
        async all() { consultas.push([sql, this.args]); return { results: [] }; },
      };
    },
  };
}

test("coleta de hora em hora só dentro da janela da Black Friday (dias de Brasília)", () => {
  const env = { MONITOR_INTERVALO_HORAS: "2", MONITOR_HORA_EM_HORA: "2026-11-24/2026-12-01" };
  assert.equal(intervaloDoMonitor(env, new Date("2026-11-23T12:00:00Z")), 2);
  assert.equal(intervaloDoMonitor(env, new Date("2026-11-24T03:30:00Z")), 1);   // 00:30 em Brasília
  assert.equal(intervaloDoMonitor(env, new Date("2026-11-24T02:30:00Z")), 2);   // ainda dia 23 em Brasília
  assert.equal(intervaloDoMonitor(env, new Date("2026-12-01T23:00:00Z")), 1);
  assert.equal(intervaloDoMonitor(env, new Date("2026-12-02T12:00:00Z")), 2);
  assert.equal(intervaloDoMonitor({ MONITOR_INTERVALO_HORAS: "2", MONITOR_HORA_EM_HORA: "lixo" }, new Date("2026-11-27T12:00:00Z")), 2);
});

test("coleta parada: avisa ao passar do limite e de novo a cada 12 h", async () => {
  const agora = 1_800_000_000;
  const com = (ultima, produtos = 3) => fakeDb(() => ({ ultima, produtos }));
  assert.equal(await coletaAtrasada(com(agora - 4 * HORA), agora, 2), null);           // limite: 5 h
  assert.deepEqual(await coletaAtrasada(com(agora - 5 * HORA - 60), agora, 2), { horas: 5, ultima: agora - 5 * HORA - 60 });
  assert.equal(await coletaAtrasada(com(agora - 6 * HORA - 60), agora, 2), null);      // já avisou
  assert.ok(await coletaAtrasada(com(agora - 17 * HORA - 60), agora, 2));               // 12 h depois
  assert.ok(await coletaAtrasada(com(agora - 3 * HORA - 60), agora, 1));                // hora em hora: limite 3 h
  assert.equal(await coletaAtrasada(com(agora - 50 * HORA, 0), agora, 2), null);       // nada para ler
  assert.match(textoColetaAtrasada({ horas: 5, ultima: agora }), /parada há 5 h/);
});

test("minuto 37 checa a saúde e manda para o admin; modo pausado não avisa", async () => {
  const agora = Date.parse("2026-11-27T13:37:00Z");
  const enviados = [];
  const fetchFor = (modo) => async (url, init) => {
    const u = String(url);
    if (u.includes("/actions/variables")) return Response.json({ total_count: 1, variables: [{ name: "BOT_MODE", value: modo }] });
    if (u.includes("api.telegram.org")) { enviados.push(JSON.parse(init.body)); return Response.json({ ok: true }); }
    throw new Error(`inesperado ${u}`);
  };
  const env = () => ({
    MONITOR_DB: fakeDb(() => ({ ultima: agora / 1000 - 5 * HORA - 60, produtos: 2 })),
    TELEGRAM_ADMIN_ID: "999", TELEGRAM_BOT_TOKEN: "t", GITHUB_TOKEN: "g", GITHUB_OWNER: "o", GITHUB_REPO: "r",
    MONITOR_INTERVALO_HORAS: "2",
  });
  assert.equal(await runScheduledMonitor({ scheduledTime: agora }, env(), fetchFor("economico")), false);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].chat_id, "999");
  assert.match(enviados[0].text, /coleta de preços está parada/);
  await runScheduledMonitor({ scheduledTime: agora }, env(), fetchFor("pausado"));
  assert.equal(enviados.length, 1);
});

test("/estatisticas mostra os cliques dos avisos e do cartão", async () => {
  const db = fakeDb((sql) => {
    if (sql.includes("FROM alerta_avisos")) return { dia: 1, semana: 10, mes: 40 };
    if (sql.includes("alerta_cliques_diarios")) return { avisos7: 4, cartao7: 2, avisos30: 10, cartao30: 5 };
    return { total: 0 };
  });
  const texto = await estatisticas(db, 1_800_000_000);
  assert.match(texto, /Nos avisos: 7 dias 4 \(40% dos avisos\) · 30 dias 10 \(25% dos avisos\)/);
  assert.match(texto, /No cartão e no mini app: 7 dias 2 · 30 dias 5/);
  // Antes da migração (tabela não existe): o painel continua respondendo.
  const semTabela = fakeDb((sql) => {
    if (sql.includes("alerta_cliques_diarios")) throw new Error("no such table");
    return { total: 0 };
  });
  assert.doesNotMatch(await estatisticas(semTabela, 1_800_000_000), /Cliques para a loja/);
});

import { handleMonitorCommand, parseCupom } from "../src/monitor.js";

test("/cupom: valida loja, código, data e link de afiliado", () => {
  const agora = Math.floor(Date.UTC(2026, 10, 22, 15) / 1000);
  const ok = parseCupom("Shopee | black20 | R$ 20 off acima de R$ 100 | 30/11 | https://shopee.com.br/m/black", agora, () => 123456);
  assert.equal(ok.loja, "Shopee");
  assert.equal(ok.codigo, "BLACK20");
  assert.equal(ok.expira, Math.floor(Date.UTC(2026, 11, 1, 2, 59, 59) / 1000));   // 30/11 23:59:59 em Brasília
  assert.match(ok.id, /^painel_[a-z0-9]{6}$/);
  const voucher = parseCupom("Mercado Livre | - | Frete grátis no app | 30/11/2026 | https://meli.la/abc", agora);
  assert.equal(voucher.codigo, "");
  assert.match(parseCupom("Mercado Livre | X1 | algo bom | 30/11 | https://www.mercadolivre.com.br/x", agora).erro, /meli\.la/);
  assert.match(parseCupom("Amazon | X1 | algo bom | 30/11 | http://amzn.to/x", agora).erro, /amzn\.to/);
  assert.match(parseCupom("Magalu | X1 | algo bom | 30/11 | https://x.com", agora).erro, /Loja desconhecida/);
  assert.match(parseCupom("Shopee | X1 | algo bom | 20/11 | https://shopee.com.br/x", agora).erro, /já passou/);
  assert.match(parseCupom("Shopee | X1 | algo bom | 31/02 | https://shopee.com.br/x", agora).erro, /não existe/);
  assert.match(parseCupom("Shopee | X1 | algo bom", agora).erro, /5, separados/);
  assert.match(parseCupom("Shopee | <b> | algo bom | 30/11 | https://shopee.com.br/x", agora).erro, /Código inválido/);
});

test("/cupom grava no banco; /cupons lista; /cupom_apagar tira", async () => {
  const consultas = [];
  const db = { prepare(sql) { return { args: [], bind(...a) { this.args = a; return this; },
    async run() { consultas.push([sql, this.args]); return { meta: { changes: 1 } }; },
    async all() { consultas.push([sql, this.args]); return { results: [{ id: "painel_abc123", source: "Shopee", code: "BLACK20", condition: "R$ 20 off", expires_at: 1_900_000_000 }] }; },
    async first() { return null; } }; } };
  const respostas = [];
  const rodar = (name, rawText) => handleMonitorCommand({ name, rawText, env: { MONITOR_DB: db }, reply: async (t) => respostas.push(t), dispatch: async () => {} });
  await rodar("cupom", "/cupom Shopee | BLACK20 | R$ 20 off acima de R$ 100 | 30/12 | https://s.shopee.com.br/abc");
  const insert = consultas.find(([sql]) => sql.includes("INSERT INTO coupons"));
  assert.deepEqual(insert[1].slice(1, 7), ["Shopee", "BLACK20", "R$ 20 off acima de R$ 100", "code", "R$ 20 off acima de R$ 100", "https://s.shopee.com.br/abc"]);
  assert.match(respostas[0], /✅ Cupom [a-z0-9]{6} no site/);
  await rodar("cupom", "/cupom Shopee | só isso");
  assert.match(respostas[1], /Formato:/);
  await rodar("cupons", "/cupons");
  assert.match(respostas[2], /abc123 · Shopee · BLACK20 · R\$ 20 off/);
  await rodar("cupom_apagar", "/cupom_apagar abc123");
  assert.deepEqual(consultas.at(-1)[1], ["abc123", "painel_abc123"]);
  assert.match(respostas[3], /tirado do site/);
});

import { SITE_PRECOS_URL, runDailyPrices } from "../src/index.js";

test("histórico diário: chama o site a cada 15 min com o segredo, e nada sem segredo", async () => {
  const chamadas = [];
  const fetchImpl = async (url, init) => { chamadas.push([url, init]); return new Response("{}", { status: 200 }); };
  const em = (min) => ({ scheduledTime: Date.UTC(2026, 10, 22, 14, min) });
  assert.equal(await runDailyPrices(em(3), { PRECOS_DIARIOS_TOKEN: "x" }, fetchImpl), true);
  assert.equal(await runDailyPrices(em(4), { PRECOS_DIARIOS_TOKEN: "x" }, fetchImpl), false);
  assert.equal(await runDailyPrices(em(48), {}, fetchImpl), false);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0][0], SITE_PRECOS_URL);
  assert.equal(chamadas[0][1].headers.Authorization, "Bearer x");
});

test("/estatisticas lista os cliques nos blocos da página inicial", async () => {
  const db = {
    prepare(sql) {
      return { bind() { return this; },
        async first() { return sql.includes("FROM alerta_avisos") ? { dia: 0, semana: 0, mes: 0 } : { total: 0 }; },
        async all() { return { results: sql.includes("home_clicks_daily") ? [{ block: "busca", total: 12 }, { block: "caiu-agora", total: 5 }] : [] }; } };
    },
  };
  const texto = await estatisticas(db, 1_800_000_000);
  assert.match(texto, /🏠 Cliques na página inicial \(7 dias\):\n   Busca do topo: 12\n   Caiu agora: 5/);
});
