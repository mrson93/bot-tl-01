import unittest
from datetime import datetime, timedelta
from unittest import mock

import config
import monitor_precos as mp

# Meio-dia em Brasília, para os testes não dependerem do relógio.
AGORA = int(datetime(2026, 11, 20, 12, 0, tzinfo=mp.FUSO).timestamp())
HOJE = datetime.fromtimestamp(AGORA, mp.FUSO).date()


def serie(precos):
    """precos[0] é o dia mais antigo; o último é ontem."""
    total = len(precos)
    return [((HOJE - timedelta(days=total - i)).isoformat(), p) for i, p in enumerate(precos)]


def avaliar(historico, preco, dias_historico=30, ultimo_post=None, disponivel=True):
    return mp.avaliar(historico, preco, disponivel, AGORA - dias_historico * 86400,
                      ultimo_post, AGORA)


class RegraOfertaTest(unittest.TestCase):
    def test_fora_de_estoque_nao_posta(self):
        r = avaliar(serie([100] * 30), 50, disponivel=False)
        self.assertFalse(r["postar"])
        self.assertIn("estoque", r["motivo"])

    def test_antes_de_7_dias_so_coleta(self):
        r = avaliar(serie([100] * 6), 50, dias_historico=6)
        self.assertFalse(r["postar"])
        self.assertIn("só coletando", r["motivo"])

    def test_menor_preco_do_periodo_posta(self):
        r = avaliar(serie([100] * 25 + [96] * 5), 95)
        self.assertTrue(r["postar"])
        self.assertEqual(r["motivo"], "menor_preco")

    def test_quinze_por_cento_abaixo_da_media_posta_mesmo_sem_ser_o_menor(self):
        r = avaliar(serie([80] + [100] * 29), 84)
        self.assertTrue(r["postar"])
        self.assertEqual(r["motivo"], "abaixo_media")

    def test_preco_comum_nao_posta(self):
        r = avaliar(serie([100] * 25 + [90] * 5), 95)
        self.assertFalse(r["postar"])
        self.assertIn("preço comum", r["motivo"])

    def test_preco_que_nunca_muda_nao_posta(self):
        r = avaliar(serie([100] * 30), 100)
        self.assertFalse(r["postar"])

    def test_pico_recente_nao_infla_a_media(self):
        # Subiu para 150 nos últimos dias e "caiu" para 99: é só a volta ao normal.
        r = avaliar(serie([100] * 24 + [150] * 6), 99)
        self.assertTrue(r["pico_ignorado"])
        self.assertAlmostEqual(r["media"], 100)
        self.assertFalse(r["postar"])

    def test_nao_reposta_em_72h_sem_nova_queda_de_5_por_cento(self):
        historico = serie([100] * 30)
        ultimo = {"preco": 80, "postado_em": AGORA - 10 * 3600}
        self.assertFalse(avaliar(historico, 79, ultimo_post=ultimo)["postar"])
        self.assertTrue(avaliar(historico, 76, ultimo_post=ultimo)["postar"])
        antigo = {"preco": 80, "postado_em": AGORA - 80 * 3600}
        self.assertTrue(avaliar(historico, 80, ultimo_post=antigo)["postar"])

    def test_percentuais_vem_da_configuracao(self):
        with mock.patch.object(config, "MONITOR_QUEDA_MEDIA_PERCENT", 30):
            r = avaliar(serie([80] + [100] * 29), 84)
        self.assertFalse(r["postar"])

    def test_silencio_da_madrugada(self):
        self.assertTrue(mp.em_silencio(23))
        self.assertTrue(mp.em_silencio(3))
        self.assertFalse(mp.em_silencio(7))
        self.assertFalse(mp.em_silencio(22))


class LegendaTest(unittest.TestCase):
    def test_formato_do_post(self):
        r = avaliar(serie([100] * 90), 80, dias_historico=95)
        texto = mp.montar_legenda("Fone <Bluetooth>", "mercadolivre", r, "https://meli.la/abc")
        linhas = texto.split("\n")
        self.assertEqual(linhas[0], "<b>🔥 MENOR PREÇO EM 90 DIAS</b>")
        self.assertIn("Fone &lt;Bluetooth&gt;", linhas[1])
        self.assertIn("R$ 80,00", linhas[2])
        self.assertIn("(média 30 dias: R$ 100,00)", linhas[2])
        self.assertEqual(linhas[3], "📉 20% abaixo da média")
        self.assertEqual(linhas[4], "🛒 Mercado Livre")
        self.assertEqual(linhas[5], "👉 https://meli.la/abc")
        self.assertEqual(linhas[6], "⚠️ Preço pode mudar a qualquer momento.")

    def test_com_pouco_historico_nao_anuncia_90_dias(self):
        r = avaliar(serie([100] * 10), 80, dias_historico=10)
        self.assertIn("EM 10 DIAS", mp.montar_legenda("X", "amazon", r, "https://amzn.to/x"))


class ExecutarTest(unittest.TestCase):
    def setUp(self):
        self.gravados = []
        patches = [
            mock.patch.object(config, "MONITOR_ATIVO", True),
            mock.patch.object(config, "MONITOR_LIMITE_DIARIO", 8),
            mock.patch.object(mp.site_publisher, "esta_configurado", return_value=True),
            mock.patch.object(mp, "gravar", side_effect=self.gravados.append),
            mock.patch.object(mp.shortlinks, "esta_configurado", return_value=False),
            mock.patch.object(mp, "_enviar"),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.enviar = mp._enviar

    def dados(self, **extra):
        base = {
            "produtos": [{"id": 1, "loja": "mercadolivre", "id_produto": "MLB1", "tipo": "catalogo",
                          "nome": "Produto", "link_afiliado": "https://www.mercadolivre.com.br/p/MLB1?matt_tool=1"}],
            "historico": {"1": serie([100] * 30)},
            "primeira_leitura": {"1": AGORA - 30 * 86400},
            "ultimo_post": {}, "posts_hoje": 0, "fila": [],
        }
        base.update(extra)
        return base

    def rodar(self, dados, preco, agora=AGORA):
        leitura = {"preco": preco, "preco_antigo": None, "disponivel": True, "nome": "Produto"}
        with mock.patch.object(mp, "carregar", return_value=dados), \
             mock.patch.object(mp, "coletar", return_value=({1: leitura}, 0)):
            return mp.executar(agora)

    def test_posta_oferta_e_registra_o_post(self):
        self.assertTrue(self.rodar(self.dados(), 80))
        self.enviar.assert_called_once()
        self.assertEqual(self.gravados[0]["leituras"][0]["preco"], 80)
        self.assertEqual(self.gravados[-1]["post"]["produto_id"], 1)

    def test_madrugada_vai_para_a_fila(self):
        madrugada = int(datetime(2026, 11, 20, 2, 0, tzinfo=mp.FUSO).timestamp())
        self.rodar(self.dados(), 80, agora=madrugada)
        self.enviar.assert_not_called()
        self.assertEqual(self.gravados[-1]["fila_add"], [{"produto_id": 1, "preco": 80.0}])

    def test_limite_diario(self):
        self.rodar(self.dados(posts_hoje=8), 80)
        self.enviar.assert_not_called()

    def test_fila_sai_quando_o_preco_volta(self):
        self.rodar(self.dados(fila=[{"produto_id": 1, "preco": 80, "entrou_em": AGORA - 3600}]), 100)
        self.enviar.assert_not_called()
        self.assertEqual(self.gravados[-1], {"fila_remover": [1]})


class AlertasPublicosTest(unittest.TestCase):
    leitura = {1: {"preco": 90.0, "disponivel": True}}

    def test_preco_pedido_dispara_quando_chega(self):
        alertas = [{"id": 7, "produto_id": 1, "preco_alvo": 95}, {"id": 8, "produto_id": 1, "preco_alvo": 80}]
        disparos = mp.decidir_avisos(alertas, self.leitura, {}, AGORA)
        self.assertEqual([(a["id"], m) for a, m in disparos], [(7, "alvo")])

    def test_sem_estoque_nao_avisa(self):
        alertas = [{"id": 7, "produto_id": 1, "preco_alvo": 95}]
        self.assertEqual(mp.decidir_avisos(alertas, {1: {"preco": 90, "disponivel": False}}, {}, AGORA), [])

    def test_sem_preco_segue_a_regra_e_o_intervalo(self):
        avaliacoes = {1: {"postar": True, "motivo": "menor_preco"}}
        novo = [{"id": 1, "produto_id": 1, "preco_alvo": None}]
        self.assertEqual(len(mp.decidir_avisos(novo, self.leitura, avaliacoes, AGORA)), 1)
        recente = [{"id": 1, "produto_id": 1, "ultimo_aviso_em": AGORA - 3600, "ultimo_aviso_preco": 92}]
        self.assertEqual(mp.decidir_avisos(recente, self.leitura, avaliacoes, AGORA), [])
        caiu = [{"id": 1, "produto_id": 1, "ultimo_aviso_em": AGORA - 3600, "ultimo_aviso_preco": 100}]
        self.assertEqual(len(mp.decidir_avisos(caiu, self.leitura, avaliacoes, AGORA)), 1)
        self.assertEqual(mp.decidir_avisos(novo, self.leitura, {1: {"postar": False}}, AGORA), [])


class NovosAvisosTest(unittest.TestCase):
    def test_estoque_queda_e_ordem(self):
        leitura = {1: {"preco": 80.0, "disponivel": True}}
        voltou = [{"id": 1, "produto_id": 1, "avisar_estoque": 1, "preco_alvo": 90}]
        self.assertEqual(mp.decidir_avisos(voltou, leitura, {}, AGORA, estoque_anterior={"1": 0})[0][1], "estoque")
        self.assertEqual(mp.decidir_avisos(voltou, leitura, {}, AGORA, estoque_anterior={"1": 1})[0][1], "alvo")
        queda = [{"id": 2, "produto_id": 1, "queda_percent": 20, "preco_base": 100}]
        self.assertEqual(mp.decidir_avisos(queda, leitura, {}, AGORA)[0][1], "queda")
        pouca = [{"id": 2, "produto_id": 1, "queda_percent": 30, "preco_base": 100}]
        self.assertEqual(mp.decidir_avisos(pouca, leitura, {}, AGORA), [])
        desligado = [{"id": 3, "produto_id": 1, "avisar_menor": 0}]
        self.assertEqual(mp.decidir_avisos(desligado, leitura, {1: {"postar": True, "motivo": "menor_preco"}}, AGORA), [])

    def test_sem_estoque_nao_avisa_valor(self):
        alerta = [{"id": 1, "produto_id": 1, "preco_alvo": 100}]
        self.assertEqual(mp.decidir_avisos(alerta, {1: {"preco": 80, "disponivel": False}}, {}, AGORA), [])


class ProdutoDoPublicoTest(ExecutarTest):
    def test_produto_do_publico_nao_vai_para_o_canal_mas_avisa(self):
        dados = self.dados(alertas=[{"id": 9, "produto_id": 1, "preco_alvo": 85}])
        dados["produtos"][0]["no_canal"] = 0
        with mock.patch.object(mp, "_link_rastreado", return_value="https://go.canaltabarato.com.br/a"):
            self.rodar(dados, 80)
        self.enviar.assert_not_called()
        aviso = next(g for g in self.gravados if "avisos" in g)["avisos"][0]
        self.assertEqual((aviso["alerta_id"], aviso["motivo"], aviso["preco"]), (9, "alvo", 80.0))


class TesteNoChatTest(unittest.TestCase):
    def test_previa_vai_so_para_o_admin(self):
        with mock.patch.object(config, "TELEGRAM_ADMIN_ID", "123"), \
             mock.patch.object(config, "TELEGRAM_BOT_TOKEN", "t"), \
             mock.patch.object(mp, "_enviar") as enviar:
            self.assertTrue(mp.executar_teste(AGORA))
        chat, texto = enviar.call_args.args[:2]
        self.assertEqual(chat, "123")
        self.assertIn("MODO TESTE", texto)
        self.assertIn("MENOR PREÇO EM 30 DIAS", texto)
        self.assertIn("Pico ignorado na média: sim", texto)


if __name__ == "__main__":
    unittest.main()


class QuedasDoDiaTest(unittest.TestCase):
    NOITE = int(datetime(2026, 11, 20, 20, 7, tzinfo=mp.FUSO).timestamp())
    QUEDAS = [{"nome": f"Produto <{i}>", "loja": "shopee", "link": f"https://s.shopee.com.br/x{i}",
               "agora": 80 - i, "antes": 100, "queda": 20 + i,
               "termometro": {"nivel": "baixo", "emoji": "🟢"}} for i in range(4)]

    def setUp(self):
        self.estado = {}
        self.posts = []
        resposta = mock.Mock(status_code=200)
        resposta.json.return_value = {"quedas": self.QUEDAS}
        patches = [
            mock.patch.object(config, "MONITOR_QUEDAS_ATIVO", True),
            mock.patch.object(config, "MONITOR_QUEDAS_HORA", 20),
            mock.patch.object(config, "MONITOR_QUEDAS_MINIMO", 3),
            mock.patch.object(mp.store, "_estado", side_effect=self.estado.get),
            mock.patch.object(mp.store, "_definir_estado", side_effect=self.estado.__setitem__),
            mock.patch.object(mp.site_publisher, "_api_path", side_effect=lambda c: f"https://site{c}"),
            mock.patch.object(mp.requests, "get", return_value=resposta),
            mock.patch.object(mp.requests, "post", side_effect=self._post),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.resposta = resposta

    def _post(self, url, json=None, timeout=None):
        self.posts.append(json)
        ok = mock.Mock()
        ok.json.return_value = {"ok": True}
        return ok

    def test_posta_uma_vez_por_dia_depois_das_20h(self):
        self.assertFalse(mp.postar_quedas_do_dia(AGORA))  # meio-dia: ainda não
        self.assertTrue(mp.postar_quedas_do_dia(self.NOITE))
        self.assertFalse(mp.postar_quedas_do_dia(self.NOITE + 7200))  # mesma noite
        self.assertEqual(len(self.posts), 1)
        texto = self.posts[0]["text"]
        self.assertIn("Maiores quedas de hoje", texto)
        self.assertIn('<a href="https://s.shopee.com.br/x0">Produto &lt;0&gt;</a>', texto)
        self.assertIn("−20% · 🟢 · Shopee", texto)
        self.assertEqual(self.posts[0]["reply_markup"]["inline_keyboard"][0][0]["url"],
                         f"{config.SITE_PUBLICO_URL.rstrip('/')}/quedas-de-hoje")
        self.assertEqual(mp.requests.get.call_args.kwargs["params"], {"limite": 5})

    def test_poucas_quedas_nao_posta_e_nao_insiste(self):
        self.resposta.json.return_value = {"quedas": self.QUEDAS[:2]}
        self.assertFalse(mp.postar_quedas_do_dia(self.NOITE))
        self.assertFalse(mp.postar_quedas_do_dia(self.NOITE + 7200))
        self.assertEqual(self.posts, [])
        self.assertEqual(mp.requests.get.call_count, 1)

    def test_madrugada_e_desligado_nao_postam(self):
        tarde_da_noite = int(datetime(2026, 11, 20, 23, 7, tzinfo=mp.FUSO).timestamp())
        self.assertFalse(mp.postar_quedas_do_dia(tarde_da_noite))
        with mock.patch.object(config, "MONITOR_QUEDAS_ATIVO", False):
            self.assertFalse(mp.postar_quedas_do_dia(self.NOITE))
        self.assertEqual(self.posts, [])


class LinkDoCartaoECliquesTest(unittest.TestCase):
    PRODUTO = {"id": 9, "loja": "mercadolivre", "id_produto": "MLB9", "nome": "X",
               "link_afiliado": "https://meli.la/abc", "com_alerta": 1}

    def setUp(self):
        for p in (mock.patch.object(config, "SHORTLINK_BASE_URL", "https://go.canaltabarato.com.br"),
                  mock.patch.object(mp.shortlinks, "esta_configurado", return_value=True)):
            p.start()
            self.addCleanup(p.stop)

    def test_cria_link_rastreado_do_cartao_para_produto_com_alerta(self):
        with mock.patch.object(mp.shortlinks, "criar", return_value="https://go.canaltabarato.com.br/abcd1234") as criar:
            dados = mp._atualizacoes([self.PRODUTO], {9: {"nome": "X"}})
        self.assertEqual(dados, [{"id": 9, "link_cartao": "https://go.canaltabarato.com.br/abcd1234"}])
        self.assertEqual(criar.call_args.args[2], "alerta_cartao")

    def test_nao_recria_nem_usa_link_direto(self):
        with mock.patch.object(mp.shortlinks, "criar") as criar:
            self.assertEqual(mp._atualizacoes([{**self.PRODUTO, "link_cartao": "https://go.canaltabarato.com.br/x"}], {9: {"nome": "X"}}), [])
            self.assertEqual(mp._atualizacoes([{**self.PRODUTO, "com_alerta": 0}], {9: {"nome": "X"}}), [])
        criar.assert_not_called()
        # Redirecionador fora do ar: _link_rastreado cai no link direto, que não serve para o cartão.
        with mock.patch.object(mp.shortlinks, "criar", side_effect=RuntimeError("fora")):
            self.assertEqual(mp._atualizacoes([self.PRODUTO], {9: {"nome": "X"}}), [])

    def test_cliques_de_hoje_por_canal_do_bot(self):
        with mock.patch.object(mp.shortlinks, "resumo_cliques",
                               return_value={"por_canal": {"alerta": 7, "telegram": 50}}) as resumo:
            self.assertEqual(mp._cliques_de_hoje(AGORA), {"dia": "2026-11-20", "alerta": 7, "alerta_cartao": 0})
        inicio, fim = resumo.call_args.args
        self.assertEqual((inicio.hour, inicio.minute), (0, 0))
        with mock.patch.object(mp.shortlinks, "resumo_cliques", side_effect=RuntimeError("fora")):
            self.assertIsNone(mp._cliques_de_hoje(AGORA))


class MotivoDaRecusaMercadoLivreTest(unittest.TestCase):
    def test_403_leva_o_motivo_curto_no_erro_e_no_diagnostico(self):
        import requests
        import mercadolivre_api as ml
        resposta = requests.Response()
        resposta.status_code = 403
        resposta.url = "https://api.mercadolibre.com/items/MLB1"
        resposta._content = b'{"message":"forbidden","error":"forbidden","status":403,"cause":[],"blocked_by":"PolicyAgent","code":"PA_UNAUTHORIZED_RESULT_FROM_POLICIES"}'
        ml.diagnostico.clear()
        with mock.patch.object(ml, "_access_token", return_value="tok"), \
             mock.patch.object(ml.requests, "get", return_value=resposta):
            with self.assertRaises(requests.HTTPError) as caso:
                ml._get("/items/MLB1")
        self.assertIn("code=PA_UNAUTHORIZED_RESULT_FROM_POLICIES", str(caso.exception))
        self.assertIn("blocked_by=PolicyAgent", str(caso.exception))
        self.assertEqual(caso.exception.response.status_code, 403)
        self.assertIn("motivo_http_403: [code=PA_UNAUTHORIZED", ml.resumo_diagnostico())
        self.assertNotIn("tok", ml.resumo_diagnostico())
