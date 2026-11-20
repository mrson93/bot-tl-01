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
