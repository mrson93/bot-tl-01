import assert from "node:assert/strict";
import test from "node:test";
import { apagarCupomDoRadar, botoesDoPost, codigosDoTexto, lojaDoTexto, mensagensDaPagina, radarAtivo, regraDoCupom, runRadarCupons } from "../src/radar.js";

const msg = (texto, iso) => `<div class="tgme_widget_message_text js-message_text" dir="auto">${texto}</div><div><time datetime="${iso}"></time></div>`;

test("radar: lê códigos, loja e regra no formato do canal", () => {
  assert.deepEqual(codigosDoTexto("🎟️ VALEHOJE R$300 OFF acima de R$2299 🎟️ CHEGOUOFF 10% OFF"), ["VALEHOJE", "CHEGOUOFF"]);
  assert.deepEqual(codigosDoTexto("CUPONS!! MERCADO LIVRE Usa logoooooo"), []);
  assert.deepEqual(codigosDoTexto("use o cupom BLACK20 acima de R$ 99"), ["BLACK20"]);
  assert.equal(lojaDoTexto("CUPOM MERCADO LIVRE").slug, "mercadolivre");
  assert.equal(lojaDoTexto("cupom na magalu"), null);
  assert.equal(regraDoCupom("🎟️ VALEHOJE R$300 OFF acima de R$2299 🎟️ CHEGOUOFF", "VALEHOJE"), "R$300 OFF acima de R$2299");
  const pagina = msg("Shopee: use o cupom <b>BLACK20</b>", "2026-11-27T15:00:00+00:00");
  assert.deepEqual(mensagensDaPagina(pagina), [{ texto: "Shopee: use o cupom BLACK20", momento: Date.parse("2026-11-27T15:00:00Z") / 1000 }]);
  assert.equal(radarAtivo(Date.parse("2026-11-27T13:00:00Z")), true);    // 10:00
  assert.equal(radarAtivo(Date.parse("2026-11-27T05:00:00Z")), false);   // 02:00
  assert.deepEqual(botoesDoPost({ codigo: "BLACK20", loja: "Shopee", slug: "shopee" }).inline_keyboard,
    [[{ text: "📋 Copiar código", copy_text: { text: "BLACK20" } }], [{ text: "🛒 Ativar na Shopee", url: "https://canaltabarato.com.br/loja/shopee" }]]);
});

function fakeDb() {
  const radar = new Map(), coupons = new Map(), sqls = [];
  const prepare = (sql) => ({
    args: [], bind(...a) { this.args = a; return this; },
    async run() {
      sqls.push(sql);
      if (sql.startsWith("INSERT OR IGNORE INTO radar_cupons")) { const [chave, loja, codigo, canal] = this.args; if (!radar.has(chave)) radar.set(chave, { chave, loja, codigo, canal, visto_em: this.args[5], status: "novo" }); }
      if (sql.startsWith("UPDATE radar_cupons SET status='publicado'")) Object.assign(radar.get(this.args[2]), { status: "publicado", mensagem_canal: this.args[0], cupom_id: this.args[1] });
      if (sql.startsWith("UPDATE radar_cupons SET status='encerrado'")) radar.get(this.args[0]).status = "encerrado";
      if (sql.startsWith("UPDATE radar_cupons SET status='apagado'")) radar.get(this.args[0]).status = "apagado";
      if (sql.includes("INSERT INTO coupons")) coupons.set(this.args[0], { id: this.args[0], code: this.args[2], expires_at: this.args[7] });
      if (sql.startsWith("UPDATE coupons SET expires_at")) coupons.get(this.args[2]).expires_at = this.args[1];
      if (sql.startsWith("DELETE FROM coupons")) coupons.delete(this.args[0]);
      return {};
    },
    async first() {
      if (sql.includes("FROM store_links")) return { destination: "https://s.shopee.com.br/afiliado" };
      if (sql.includes("FROM radar_cupons WHERE chave=?")) return radar.get(this.args[0]) || null;
      return null;
    },
    async all() {
      if (sql.includes("WHERE chave IN")) return { results: this.args.filter((c) => radar.has(c)).map((chave) => ({ chave })) };
      if (sql.includes("status='publicado'")) return { results: [...radar.values()].filter((r) => r.status === "publicado") };
      return { results: [] };
    },
  });
  return { radar, coupons, sqls, prepare };
}

function fakeFetch(paginas) {
  const telegram = [];
  let i = 0;
  const impl = async (url, init) => {
    const u = String(url);
    if (u.startsWith("https://t.me/s/")) return new Response(paginas[Math.min(i++, paginas.length - 1)]);
    if (u.includes("api.telegram.org")) { const metodo = u.split("/").pop(); telegram.push([metodo, JSON.parse(init.body)]); return Response.json({ ok: true, result: { message_id: 40 + telegram.length } }); }
    throw new Error(`inesperado ${u}`);
  };
  return { impl, telegram };
}

test("radar: publica sozinho os códigos novos de Shopee, Amazon e Mercado Livre, sem repetir", async () => {
  const db = fakeDb();
  const env = { MONITOR_DB: db, TELEGRAM_BOT_TOKEN: "t", TELEGRAM_ADMIN_ID: "999", RADAR_CUPONS_CANAIS: "sddescontos" };
  const pagina = msg("🚨 CUPOM SHOPEE: 🎟️ BLACK20 R$20 OFF acima de R$99", "2026-11-27T15:58:00+00:00")
    + msg("Magalu cupom: MAGA99", "2026-11-27T15:59:00+00:00")
    + msg("Cupom Shopee antigo: VELHO10", "2026-11-27T05:00:00+00:00");
  const { impl, telegram } = fakeFetch([pagina]);
  const quando = { scheduledTime: Date.parse("2026-11-27T16:00:00Z") };   // 13:00, minuto par
  assert.deepEqual(await runRadarCupons(quando, env, impl), { publicados: 1, encerrados: 0 });
  assert.deepEqual(await runRadarCupons({ scheduledTime: Date.parse("2026-11-27T16:02:00Z") }, env, impl), { publicados: 0, encerrados: 0 });
  assert.equal(await runRadarCupons({ scheduledTime: Date.parse("2026-11-27T16:01:00Z") }, env, impl), null);   // minuto ímpar
  const [post, aviso] = telegram;
  assert.equal(post[0], "sendMessage");
  assert.equal(post[1].chat_id, "@CanalTaBaratoCupons");
  assert.match(post[1].text, /<code>BLACK20<\/code>/);
  assert.match(post[1].text, /R\$20 OFF acima de R\$99/);
  assert.equal(aviso[1].chat_id, "999");
  assert.equal(aviso[1].reply_markup.inline_keyboard[0][0].callback_data, "rc:del:shopee:BLACK20");
  assert.equal(db.coupons.get("radar_shopee_BLACK20").code, "BLACK20");
});

test("radar: quando o canal diz que esgotou, o post vira encerrado; o botão Apagar tira tudo", async () => {
  const db = fakeDb();
  const env = { MONITOR_DB: db, TELEGRAM_BOT_TOKEN: "t", TELEGRAM_ADMIN_ID: "999" };
  const p1 = msg("CUPOM SHOPEE 🎟️ BLACK20 R$20 OFF", "2026-11-27T15:58:00+00:00");
  const p2 = p1 + msg("BLACK20 ESGOTOU 😭", "2026-11-27T16:03:00+00:00");
  const { impl, telegram } = fakeFetch([p1, p2]);
  await runRadarCupons({ scheduledTime: Date.parse("2026-11-27T16:00:00Z") }, env, impl);
  const r = await runRadarCupons({ scheduledTime: Date.parse("2026-11-27T16:04:00Z") }, env, impl);
  assert.equal(r.encerrados, 1);
  const edicao = telegram.find(([m]) => m === "editMessageText");
  assert.match(edicao[1].text, /CUPOM ENCERRADO · SHOPEE/);
  assert.deepEqual(edicao[1].reply_markup.inline_keyboard, []);
  assert.equal(db.radar.get("shopee:BLACK20").status, "encerrado");
  assert.ok(db.coupons.get("radar_shopee_BLACK20").expires_at <= Date.parse("2026-11-27T16:04:00Z") / 1000);
  assert.equal(await apagarCupomDoRadar(env, "shopee:BLACK20", impl), true);
  assert.ok(telegram.some(([m]) => m === "deleteMessage"));
  assert.equal(db.coupons.has("radar_shopee_BLACK20"), false);
  assert.equal(await apagarCupomDoRadar(env, "x:y", impl), false);
});
