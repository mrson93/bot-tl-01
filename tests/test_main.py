import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import main


class MainTest(unittest.TestCase):
    def test_extrai_apenas_cupom_com_resgate_oficial(self):
        fonte = object()
        ofertas = [
            {"fonte": "AliExpress", "cupom": "APP20", "cupomResgate": True,
             "cupomCondicao": "20 off", "productUrl": "https://oferta.test/cupom",
             "cupomExpiraEm": "2000000000000", "_fonte_obj": fonte},
            {"fonte": "Shopee", "cupom": "NAO_CONFIRMADO", "cupomResgate": False,
             "productUrl": "https://oferta.test", "_fonte_obj": fonte},
        ]
        cupons = main.cupons_oficiais(ofertas)
        self.assertEqual(1, len(cupons))
        self.assertEqual("APP20", cupons[0]["codigo"])
        self.assertEqual(2_000_000_000, cupons[0]["expira_em"])

    def test_desconto_maior_vence_variedade_quando_ambas_sao_inéditas(self):
        alta = {"oferta_id": "alta", "fonte": "Shopee", "price": 50,
                "priceDiscountRate": 70, "categoria": "cozinha", "_motivo": "inedita"}
        baixa = {"oferta_id": "baixa", "fonte": "Shopee", "price": 50,
                 "priceDiscountRate": 30, "categoria": "eletronicos", "_motivo": "inedita"}
        with patch.object(main.store, "ofertas_recentes", return_value=[]), \
             patch.object(main.store, "multiplicadores_desempenho", return_value={}):
            ordenadas = main._ordenar_candidatos([baixa, alta])
        self.assertEqual("alta", ordenadas[0]["oferta_id"])

    def test_falha_de_publicacao_nao_grava_token_no_historico(self):
        class Fonte:
            NOME = "Shopee"

            @staticmethod
            def gerar_link(*args):
                return "https://oferta.test"

        class Canal:
            NOME = "Telegram"
            TRACKING_ID = ""

            @staticmethod
            def postar(*args):
                raise RuntimeError(
                    "falhou em https://api.telegram.org/bot123456:ABC-def/sendPhoto"
                )

        oferta = {"oferta_id": "x", "productUrl": "https://produto.test", "price": 50}
        with patch.object(main, "canais_ativos", return_value=[Canal]), \
             patch.object(main.store, "canal_pendente", return_value=True), \
             patch.object(main.shortlinks, "esta_configurado", return_value=False), \
             patch.object(main.store, "registrar_entrega") as registrar:
            self.assertEqual(0, main.publicar(Fonte, oferta))
        erro = registrar.call_args.args[5]
        self.assertNotIn("123456:ABC-def", erro)
        self.assertIn("[SEGREDO]", erro)

    def test_falha_do_link_proprio_usa_afiliado_oficial(self):
        class Fonte:
            NOME = "Shopee"

            @staticmethod
            def gerar_link(*args):
                return "https://shope.ee/oficial"

        class Canal:
            NOME = "Telegram"
            TRACKING_ID = "telegram"

            @staticmethod
            def postar(*args):
                return None

        oferta = {"oferta_id": "x", "productUrl": "https://produto.test",
                  "price": 50}
        with patch.object(main, "canais_ativos", return_value=[Canal]), \
             patch.object(main.store, "canal_pendente", return_value=True), \
             patch.object(main.store, "registrar_entrega"), \
             patch.object(main.shortlinks, "esta_configurado", return_value=True), \
             patch.object(main.shortlinks, "criar", side_effect=RuntimeError("fora")), \
             patch.object(Canal, "postar") as postar:
            self.assertEqual(1, main.publicar(Fonte, oferta))
        self.assertEqual("https://shope.ee/oficial", postar.call_args.args[1])

    def test_bom_dia_e_enviado_so_uma_vez(self):
        agora = datetime(2026, 8, 19, 5, 0)
        enviados = set()
        with patch.object(main.telegram_poster, "esta_configurada", return_value=True), \
             patch.object(main.bluesky, "esta_configurada", return_value=True), \
             patch.object(main.store, "bom_dia_enviado", side_effect=lambda data, canal: canal in enviados), \
             patch.object(main.store, "marcar_bom_dia_enviado", side_effect=lambda data, canal: enviados.add(canal)), \
             patch.object(main.telegram_poster, "postar_bom_dia") as postar_telegram, \
             patch.object(main.bluesky, "postar_bom_dia") as postar_bluesky:
            self.assertTrue(main.enviar_bom_dia_se_preciso(agora))
            self.assertFalse(main.enviar_bom_dia_se_preciso(agora))
            postar_telegram.assert_called_once()
            postar_bluesky.assert_called_once()

    def test_bom_dia_conta_como_publicado_se_registro_local_falhar(self):
        with patch.object(main.telegram_poster, "esta_configurada", return_value=True), \
             patch.object(main.bluesky, "esta_configurada", return_value=False), \
             patch.object(main.store, "bom_dia_enviado", return_value=False), \
             patch.object(main.telegram_poster, "postar_bom_dia"), \
             patch.object(main.store, "marcar_bom_dia_enviado",
                          side_effect=RuntimeError("falhou")):
            self.assertTrue(
                main.enviar_bom_dia_se_preciso(datetime(2026, 8, 19, 6, 10))
            )

    def test_falha_em_um_canal_nao_impede_o_outro(self):
        agora = datetime(2026, 8, 19, 6, 10)
        marcados = []
        with patch.object(main.telegram_poster, "esta_configurada", return_value=True), \
             patch.object(main.bluesky, "esta_configurada", return_value=True), \
             patch.object(main.store, "bom_dia_enviado", return_value=False), \
             patch.object(main.store, "marcar_bom_dia_enviado", side_effect=lambda data, canal: marcados.append(canal)), \
             patch.object(main.telegram_poster, "postar_bom_dia", side_effect=RuntimeError("falhou")), \
             patch.object(main.bluesky, "postar_bom_dia") as postar_bluesky:
            self.assertTrue(main.enviar_bom_dia_se_preciso(agora))
            postar_bluesky.assert_called_once()
            self.assertEqual(["Bluesky"], marcados)

    def test_bom_dia_nao_e_enviado_depois_do_meio_dia(self):
        with patch.object(main.telegram_poster, "postar_bom_dia") as postar, \
             patch.object(main.bluesky, "postar_bom_dia") as postar_bluesky:
            self.assertFalse(main.enviar_bom_dia_se_preciso(datetime(2026, 8, 19, 14)))
            postar.assert_not_called()
            postar_bluesky.assert_not_called()

    def test_bom_dia_usa_brasilia_e_nao_e_enviado_antes_das_5(self):
        quatro_e_cinquenta_e_nove_em_brasilia = datetime(
            2026, 8, 19, 7, 59, tzinfo=timezone.utc
        )
        with patch.object(main.telegram_poster, "postar_bom_dia") as postar, \
             patch.object(main.bluesky, "postar_bom_dia") as postar_bluesky:
            self.assertFalse(
                main.enviar_bom_dia_se_preciso(quatro_e_cinquenta_e_nove_em_brasilia)
            )
            postar.assert_not_called()
            postar_bluesky.assert_not_called()

    def test_primeira_oferta_espera_cinco_minutos_apos_bom_dia(self):
        eventos = []
        with patch.object(main.sys, "argv", ["main.py", "--once"]), \
             patch.object(main, "checar", return_value=True), \
             patch.object(main, "dentro_do_horario", return_value=True), \
             patch.object(main.store, "proximo_post", return_value=None), \
             patch.object(main.time, "time", return_value=1_000), \
             patch.object(main, "enviar_bom_dia_se_preciso",
                          side_effect=lambda: eventos.append("bom_dia") or True), \
             patch.object(main.time, "sleep",
                          side_effect=lambda segundos: eventos.append(("espera", segundos))), \
             patch.object(main.relatorio, "enviar_se_devido",
                          side_effect=lambda: eventos.append("relatorio")), \
             patch.object(main, "rodar_uma_vez",
                          side_effect=lambda: eventos.append("oferta") or 1), \
             patch.object(main, "agendar_proxima",
                          side_effect=lambda **kwargs: eventos.append("agendamento")):
            main.main()

        self.assertEqual([
            "bom_dia", ("espera", 300), "oferta", "agendamento", "relatorio"
        ], eventos)

    def test_relatorio_roda_mesmo_quando_proxima_oferta_ainda_nao_venceu(self):
        with patch.object(main.sys, "argv", ["main.py", "--once"]), \
             patch.object(main, "checar", return_value=True), \
             patch.object(main, "dentro_do_horario", return_value=True), \
             patch.object(main.store, "proximo_post", return_value=2_000), \
             patch.object(main.time, "time", return_value=1_000), \
             patch.object(main, "enviar_relatorio_seguro") as enviar, \
             patch.object(main, "rodar_uma_vez") as rodar:
            main.main()

        enviar.assert_called_once_with()
        rodar.assert_not_called()

    def test_comando_relatorio_forca_envio_sem_buscar_ofertas(self):
        with patch.object(main.sys, "argv", ["main.py", "--relatorio"]), \
             patch.object(main, "enviar_relatorio_seguro", return_value=True) as enviar, \
             patch.object(main, "checar") as checar, \
             patch.object(main, "rodar_uma_vez") as rodar:
            main.main()

        enviar.assert_called_once_with(forcar=True)
        checar.assert_not_called()
        rodar.assert_not_called()

    def test_intervalo_do_pico_fica_em_15_minutos(self):
        with patch.object(main.config, "MIN_MINUTOS_ENTRE_POSTS", 15), \
             patch.object(main.config, "MAX_MINUTOS_ENTRE_POSTS", 15), \
             patch.object(main.config, "HORAS_PICO", [12]), \
             patch.object(main.random, "randint", return_value=15) as sorteio:
            self.assertEqual(15, main.minutos_para_proximo(datetime(2026, 8, 17, 12)))
            sorteio.assert_called_once_with(15, 15)

    def test_intervalo_fora_do_pico_fica_em_30_minutos(self):
        with patch.object(main.config, "MIN_MINUTOS_FORA_PICO", 30), \
             patch.object(main.config, "MAX_MINUTOS_FORA_PICO", 30), \
             patch.object(main.config, "HORAS_PICO", [12]), \
             patch.object(main.random, "randint", return_value=30) as sorteio:
            self.assertEqual(30, main.minutos_para_proximo(datetime(2026, 8, 17, 15)))
            sorteio.assert_called_once_with(30, 30)

    def test_pontuacao_usa_historico_com_bonus_limitado(self):
        oferta = {"fonte": "Shopee", "oferta_id": "x", "categoria": "cozinha",
                  "priceDiscountRate": 50, "comissao": 0.1}
        with patch.object(main.store, "multiplicador_desempenho", return_value=1.2), \
             patch.object(main.config, "peso_loja", return_value=1):
            self.assertEqual(66, main.pontuacao(oferta))

    def test_pontuacao_respeita_preferencia_moderada_da_loja(self):
        oferta = {"fonte": "Shopee", "oferta_id": "x", "categoria": "cozinha",
                  "priceDiscountRate": 50, "comissao": 0}
        with patch.object(main.store, "multiplicador_desempenho", return_value=1), \
             patch.object(main.config, "peso_loja", return_value=1.2):
            self.assertEqual(60, main.pontuacao(oferta))

    def test_fonte_desativada_nao_entra_na_consulta(self):
        with patch.object(main.shopee, "esta_configurada", return_value=True), \
             patch.object(main.aliexpress, "esta_configurada", return_value=True), \
             patch.object(main.amazon, "esta_configurada", return_value=False), \
             patch.object(main.config, "loja_ativa",
                          side_effect=lambda nome: nome != "Shopee"):
            self.assertEqual(["AliExpress"], [fonte.NOME for fonte in main.fontes_ativas()])

    def test_relatorio_automatico_pode_ficar_somente_no_controlador(self):
        with patch.object(main.config, "RELATORIO_AUTOMATICO_NA_EXECUCAO", False), \
             patch.object(main.relatorio, "enviar_se_devido") as enviar:
            self.assertFalse(main.enviar_relatorio_seguro())
            enviar.assert_not_called()

    def test_rodada_compara_todas_as_lojas_e_publica_a_melhor(self):
        class Fonte:
            def __init__(self, nome):
                self.NOME = nome

        shopee = Fonte("Shopee")
        ali = Fonte("AliExpress")

        def candidatos(fonte):
            desconto = 40 if fonte.NOME == "Shopee" else 70
            return [{"_fonte_obj": fonte, "_motivo": "inedita",
                     "fonte": fonte.NOME, "oferta_id": fonte.NOME,
                     "productName": fonte.NOME, "price": 50,
                     "priceDiscountRate": desconto, "comissao": 0,
                     "categoria": "outros"}]

        with patch.object(main, "fontes_ativas", return_value=[shopee, ali]), \
             patch.object(main, "buscar_candidatos", side_effect=candidatos), \
             patch.object(main.store, "multiplicadores_desempenho", return_value={}), \
             patch.object(main.store, "ofertas_recentes", return_value=[]), \
             patch.object(main, "publicar", return_value=1) as publicar, \
             patch.object(main.store, "marcar_postada"), \
             patch.object(main.config, "MAX_POSTS_PER_RUN", 1), \
             patch.object(main.config, "peso_loja", return_value=1):
            self.assertEqual(1, main.rodar_uma_vez())

        self.assertEqual("AliExpress", publicar.call_args.args[0].NOME)

    def test_rodada_espera_intervalo_configurado_entre_posts(self):
        fonte = type("Fonte", (), {"NOME": "Shopee"})()
        fila = [
            {"_fonte_obj": fonte, "oferta_id": "a", "productName": "Oferta A"},
            {"_fonte_obj": fonte, "oferta_id": "b", "productName": "Oferta B"},
        ]
        with patch.object(main, "publicar", return_value=1), \
             patch.object(main.store, "marcar_postada"), \
             patch.object(main.config, "DELAY_BETWEEN_POSTS_SECONDS", 180), \
             patch.object(main.time, "sleep") as esperar:
            self.assertEqual(2, main._publicar_fila(fila, 2))

        esperar.assert_called_once_with(180)

    def test_rodada_prioriza_categoria_diferente_apos_primeira_oferta(self):
        fonte = type("Fonte", (), {"NOME": "Shopee"})()
        fila = [
            {"_fonte_obj": fonte, "oferta_id": "kit-a",
             "productName": "Kit organizador de maquiagem 10 peças",
             "categoria": "casa"},
            {"_fonte_obj": fonte, "oferta_id": "kit-b",
             "productName": "Kit organizador para maquiagem 8 peças",
             "categoria": "casa"},
            {"_fonte_obj": fonte, "oferta_id": "garrafa",
             "productName": "Garrafa térmica inox 1 litro",
             "categoria": "casa"},
            {"_fonte_obj": fonte, "oferta_id": "fone",
             "productName": "Fone Bluetooth sem fio",
             "categoria": "eletronicos"},
        ]
        with patch.object(main, "publicar", return_value=1) as publicar, \
             patch.object(main.store, "marcar_postada"), \
             patch.object(main.config, "DELAY_BETWEEN_POSTS_SECONDS", 0), \
             patch.object(main.time, "sleep"):
            self.assertEqual(2, main._publicar_fila(fila, 2))

        self.assertEqual(
            ["kit-a", "fone"],
            [call.args[1]["oferta_id"] for call in publicar.call_args_list],
        )

    def test_limite_de_posts_fora_do_pico_pode_ser_menor(self):
        with patch.object(main.config, "HORAS_PICO", [12, 13]), \
             patch.object(main.config, "MAX_POSTS_PER_RUN", 2), \
             patch.object(main.config, "MAX_POSTS_PER_RUN_FORA_PICO", 1):
            self.assertEqual(2, main.config.limite_posts_por_rodada(12))
            self.assertEqual(1, main.config.limite_posts_por_rodada(10))

    def test_desconto_vence_variedade_quando_prioridade_e_igual(self):
        fonte = type("Fonte", (), {"NOME": "Shopee"})()
        candidatos = [
            {"_fonte_obj": fonte, "_motivo": "inedita", "fonte": "Shopee",
             "oferta_id": "fone2", "productName": "Fone Bluetooth Lenovo LP40",
             "priceDiscountRate": 80, "comissao": 0, "categoria": "eletronicos"},
            {"_fonte_obj": fonte, "_motivo": "inedita", "fonte": "Shopee",
             "oferta_id": "panela", "productName": "Panela antiaderente 24 cm",
             "priceDiscountRate": 40, "comissao": 0, "categoria": "cozinha"},
        ]
        with patch.object(main.store, "multiplicadores_desempenho", return_value={}), \
             patch.object(main.store, "ofertas_recentes", return_value=[{
                 "titulo": "Fone Bluetooth Lenovo LP40 original",
                 "categoria": "eletronicos",
             }]):
            fila = main._ordenar_candidatos(candidatos)
        self.assertEqual("fone2", fila[0]["oferta_id"])


if __name__ == "__main__":
    unittest.main()
