import assert from "node:assert/strict";
import test from "node:test";

import {
  handleMonitorCommand, isMonitorCommand, monitorDue, parseProductLink, resolveProductLink,
} from "../src/monitor.js";

test("reconhece ASIN e MLB pelo link", () => {
  assert.deepEqual(parseProductLink("https://www.amazon.com.br/Fone-JBL/dp/B0C1234567?tag=x"),
    { loja: "amazon", id_produto: "B0C1234567", tipo: null });
  assert.deepEqual(parseProductLink("https://www.mercadolivre.com.br/fone/p/MLB19876543#reco"),
    { loja: "mercadolivre", id_produto: "MLB19876543", tipo: "catalogo" });
  assert.deepEqual(parseProductLink("https://produto.mercadolivre.com.br/MLB-3456789012-fone-_JM"),
    { loja: "mercadolivre", id_produto: "MLB3456789012", tipo: "anuncio" });
  assert.deepEqual(parseProductLink("https://www.mercadolivre.com.br/fone/p/MLB1?wid=MLB222"),
    { loja: "mercadolivre", id_produto: "MLB222", tipo: "anuncio" });
  assert.equal(parseProductLink("https://exemplo.com/dp/B0C1234567"), null);
  assert.equal(parseProductLink("http://www.amazon.com.br/dp/B0C1234567"), null);
});

test("segue link curto só entre as lojas", async () => {
  const chamadas = [];
  const fetchImpl = async (url) => {
    chamadas.push(url);
    return new Response(null, { status: 301, headers: { Location: "https://www.amazon.com.br/dp/B0C7654321" } });
  };
  assert.deepEqual(await resolveProductLink("https://amzn.to/abc", fetchImpl),
    { loja: "amazon", id_produto: "B0C7654321", tipo: null });
  assert.equal(await resolveProductLink("https://encurtador.com/abc", fetchImpl), null);
  assert.equal(chamadas.length, 1);
});

test("só trata /historico como monitor quando vem com id", () => {
  assert.equal(isMonitorCommand("historico", ["3"]), true);
  assert.equal(isMonitorCommand("historico", []), false);
  assert.equal(isMonitorCommand("lista", []), true);
});

test("coleta no minuto 7 das horas pares", () => {
  assert.equal(monitorDue("08", "07", "2"), true);
  assert.equal(monitorDue("09", "07", "2"), false);
  assert.equal(monitorDue("08", "08", "2"), false);
  assert.equal(monitorDue("09", "07", "3"), true);
});

function fakeDb(respostas) {
  const consultas = [];
  return {
    consultas,
    prepare(sql) {
      const stmt = {
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() { consultas.push([sql, this.args]); return respostas.first(sql, this.args); },
        async all() { consultas.push([sql, this.args]); return { results: respostas.all(sql, this.args) }; },
        async run() { consultas.push([sql, this.args]); return {}; },
      };
      return stmt;
    },
  };
}

async function comando(name, rawText, db) {
  const respostas = [], disparos = [];
  await handleMonitorCommand({
    name, rawText, env: { MONITOR_DB: db },
    reply: async (texto) => respostas.push(texto),
    dispatch: async (id) => disparos.push(id),
    fetchImpl: async () => { throw new Error("sem rede"); },
  });
  return { respostas, disparos };
}

test("/add cadastra e pede a primeira leitura", async () => {
  const db = fakeDb({ first: () => ({ id: 4, nome: null }) });
  const { respostas, disparos } = await comando("add", "/add https://www.mercadolivre.com.br/x/p/MLB55", db);
  assert.match(db.consultas[0][0], /INSERT INTO monitor_produtos/);
  assert.deepEqual(db.consultas[0][1].slice(0, 3), ["mercadolivre", "MLB55", "catalogo"]);
  assert.deepEqual(disparos, ["monitor_precos"]);
  assert.match(respostas[0], /#4/);
});

test("/add da Amazon avisa que a API ainda não foi liberada", async () => {
  const db = fakeDb({ first: () => ({ id: 5, nome: null }) });
  const { respostas, disparos } = await comando("add", "/add https://www.amazon.com.br/dp/B0C1234567", db);
  assert.deepEqual(disparos, []);
  assert.match(respostas[0], /10 vendas em 30 dias/);
});

test("/add sem produto reconhecível não grava nada", async () => {
  const db = fakeDb({ first: () => null });
  const { respostas } = await comando("add", "/add https://exemplo.com/produto", db);
  assert.equal(db.consultas.length, 0);
  assert.match(respostas[0], /Não reconheci/);
});

test("/historico mostra mínimo, máximo e média", async () => {
  const db = fakeDb({
    first: (sql) => {
      if (sql.includes("FROM monitor_produtos")) return { id: 2, loja: "mercadolivre", id_produto: "MLB9", nome: "Fone", ativo: 1 };
      if (sql.includes("MIN(preco)")) return { minimo: 90, maximo: 130, media: 110.5, leituras: 40, desde: Math.floor(Date.now() / 1000) - 5 * 86400 };
      if (sql.includes("FROM monitor_leituras")) return { preco: 99.9, disponivel: 1, lido_em: Math.floor(Date.now() / 1000) };
      return null;
    },
  });
  const { respostas } = await comando("historico", "/historico 2", db);
  assert.match(respostas[0], /Mínimo: R\$ 90,00/);
  assert.match(respostas[0], /Máximo: R\$ 130,00/);
  assert.match(respostas[0], /Média: R\$ 110,50/);
});

test("/remover desativa e tira da fila", async () => {
  const db = fakeDb({ first: () => ({ id: 3, loja: "amazon", id_produto: "B0C1234567", nome: "Caixa" }) });
  const { respostas } = await comando("remover", "/remover 3", db);
  assert.match(db.consultas[0][0], /SET ativo=0/);
  assert.match(db.consultas[1][0], /DELETE FROM monitor_fila/);
  assert.match(respostas[0], /#3 saiu do monitor/);
});

test("/lista mostra o último preço", async () => {
  const db = fakeDb({
    all: () => [{ id: 1, loja: "mercadolivre", id_produto: "MLB1", nome: "Fone", ultimo: 79.9, disponivel: 1, na_fila: 1 }],
    first: () => ({ pessoas: 2, produtos: 3, alertas: 4 }),
  });
  const { respostas } = await comando("lista", "/lista", db);
  assert.match(respostas[0], /4 alerta\(s\) de 2 pessoa\(s\), em 3 produto\(s\)/);
  assert.match(respostas[0], /#1 Mercado Livre: Fone/);
  assert.match(respostas[0], /R\$ 79,90 · 🌙 na fila/);
});

test("reconhece links da Shopee no /add", () => {
  assert.deepEqual(parseProductLink("https://shopee.com.br/Fone-JBL-i.123.456?x=1"),
    { loja: "shopee", id_produto: "123_456", tipo: null });
  assert.equal(parseProductLink("https://shopee.com.br/opaanlp/1791562791/23894195354").id_produto, "1791562791_23894195354");
});
