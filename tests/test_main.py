import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import main


class MainTest(unittest.TestCase):
    def test_lista_curada_nao_repete_mas_retoma_canal_pendente(self):
        import tempfile
        from pathlib import Path
        class Fonte:
            NOME = "Mercado Livre"
            @staticmethod
            def buscar_ofertas():
                return [{"oferta_id": "mercadolivre_MLB1", "fonte": "Mercado Livre",
                         "productName": "Produto útil", "price": 100,
                         "priceDiscountRate": 40, "curadoriaManual": True}]
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(main.store, "_DB", Path(tmp) / "estado.db"), \
             patch.object(main, "canais_ativos", return_value=[
                 unittest.mock.Mock(NOME="Telegram")]), \
             patch.object(main.site_publisher, "esta_configurado", return_value=False), \
             patch.object(main.monitor, "avisar_estoque_lista"):
            main.store.marcar_postada("mercadolivre_MLB1", 100, 40, "Mercado Livre")
            main.store.registrar_entrega("mercadolivre_MLB1", "Telegram", True, 100, "Mercado Livre")
            self.assertEqual([], main.buscar_candidatos(Fonte))
            with patch.object(main, "canais_ativos", return_value=[
                    unittest.mock.Mock(NOME="Telegram"), unittest.mock.Mock(NOME="Facebook")]):
                self.assertEqual(1, len(main.buscar_candidatos(Fonte)))

    def test_cota_da_tarde_pausa_rodada_sem_bloquear_outros_turnos(self):
        with patch.object(main.turnos, "janela", return_value=("tarde", 100, 200)), \
             patch.object(main.store, "posts_entre", return_value=20), \
             patch.object(main, "fontes_ativas") as fontes, \
             patch.object(main, "sincronizar_shopee_vip_site"), \
             patch.object(main.observabilidade, "evento"):
            self.assertEqual(0, main.rodar_uma_vez())
            fontes.assert_not_called()

    def test_lista_curada_prioriza_desconto_e_prazo_oficial(self):
        fonte = type("Fonte", (), {"NOME": "Mercado Livre"})()
        candidatos = [
            {"_fonte_obj": fonte, "_motivo": "inedita", "fonte": "Mercado Livre",
             "oferta_id": "normal", "productName": "Café premium", "price": 80,
             "priceDiscountRate": 80, "categoria": "alimentos"},
            {"_fonte_obj": fonte, "_motivo": "inedita", "fonte": "Mercado Livre",
             "oferta_id": "urgente", "productName": "Fone bluetooth", "price": 90,
             "priceDiscountRate": 40, "categoria": "eletronicos",
             "expira_em": datetime.now(timezone.utc).timestamp() + 3600},
        ]
        with patch.object(main.store, "ofertas_recentes", return_value=[]), \
             patch.object(main.store, "ofertas_desde", return_value=[]), \
             patch.object(main.store, "posts_por_loja_hoje", return_value={}), \
             patch.object(main.store, "multiplicadores_desempenho", return_value={}):
            self.assertEqual("urgente", main._ordenar_candidatos(candidatos)[0]["oferta_id"])
            del candidatos[1]["expira_em"]
            self.assertEqual("normal", main._ordenar_candidatos(candidatos)[0]["oferta_id"])

    def test_sucesso_parcial_nao_envia_notificacao_privada_e_site_nao_duplica(self):
        import tempfile
        from pathlib import Path
        fonte = unittest.mock.Mock(NOME="Shopee")
        fonte.gerar_link.return_value = "https://oferta.test/link"
        telegram = unittest.mock.Mock(NOME="Telegram", TRACKING_ID="telegram")
        facebook = unittest.mock.Mock(NOME="Facebook", TRACKING_ID="facebook")
        facebook.postar.side_effect = RuntimeError("limite")
        oferta = {"oferta_id": "produto-1", "productName": "Produto 1",
                  "productUrl": "https://oferta.test/item", "price": 50}
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(main.store, "_DB", Path(tmp) / "estado.db"), \
             patch.object(main, "canais_ativos", return_value=[telegram, facebook]), \
             patch.object(main.site_publisher, "esta_configurado", return_value=True), \
             patch.object(main.site_publisher, "publicar") as site, \
             patch.object(main.shortlinks, "esta_configurado", return_value=False), \
             patch.object(main.monitor, "_enviar_privado") as enviar_privado, \
             patch.object(main.observabilidade, "evento"):
            self.assertEqual(1, main.publicar(fonte, oferta))
            enviar_privado.assert_not_called()
            self.assertEqual(0, main.publicar(fonte, oferta))
            enviar_privado.assert_not_called()
            site.assert_called_once()
            telegram.postar.assert_called_once()
            self.assertEqual(2, facebook.postar.call_count)

    def test_falha_em_todos_os_destinos_envia_um_unico_alerta_privado(self):
        import tempfile
        from pathlib import Path
        fonte = unittest.mock.Mock(NOME="Shopee")
        fonte.gerar_link.return_value = "https://oferta.test/link"
        telegram = unittest.mock.Mock(NOME="Telegram", TRACKING_ID="telegram")
        facebook = unittest.mock.Mock(NOME="Facebook", TRACKING_ID="facebook")
        telegram.postar.side_effect = RuntimeError("indisponível")
        facebook.postar.side_effect = RuntimeError("indisponível")
        oferta = {"oferta_id": "produto-falhou", "productName": "Produto falhou",
                  "productUrl": "https://oferta.test/item", "price": 50}
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(main.store, "_DB", Path(tmp) / "estado.db"), \
             patch.object(main, "canais_ativos", return_value=[telegram, facebook]), \
             patch.object(main.site_publisher, "esta_configurado", return_value=False), \
             patch.object(main.shortlinks, "esta_configurado", return_value=False), \
             patch.object(main.monitor, "_enviar_privado", return_value=True) as enviar, \
             patch.object(main.observabilidade, "evento"):
            self.assertEqual(0, main.publicar(fonte, oferta))
        enviar.assert_called_once()
        self.assertIn("falhou em todos os destinos", enviar.call_args.args[0])

    def test_revalida_preco_imediatamente_antes_de_publicar(self):
        class Fonte:
            NOME = "Mercado Livre"
            VALIDA_ANTES_PUBLICAR = True

            @staticmethod
            def revalidar_oferta(oferta):
                return {**oferta, "price": 79.90, "productName": "Preço atualizado"}

            @staticmethod
            def gerar_link(*args):
                return "https://www.mercadolivre.com.br/produto"

        canal = unittest.mock.Mock(NOME="Telegram", TRACKING_ID="telegram")
        oferta = {"oferta_id": "mercadolivre_MLB1", "price": 99.90,
                  "productName": "Preço anterior", "productUrl": "https://produto.test",
                  "curadoriaManual": True}
        with patch.object(main, "canais_ativos", return_value=[canal]), \
             patch.object(main.store, "canal_pendente", return_value=True), \
             patch.object(main.store, "registrar_entrega") as registrar, \
             patch.object(main.shortlinks, "esta_configurado", return_value=False), \
             patch.object(main.site_publisher, "esta_configurado", return_value=False), \
             patch.object(main.observabilidade, "evento"):
            self.assertEqual(1, main.publicar(Fonte, oferta))

        self.assertEqual(79.90, canal.postar.call_args.args[0]["price"])
        self.assertEqual(79.90, registrar.call_args.args[3])

    def test_nao_publica_oferta_que_nao_esta_mais_vigente(self):
        class Fonte:
            NOME = "Mercado Livre"
            VALIDA_ANTES_PUBLICAR = True

            @staticmethod
            def revalidar_oferta(oferta):
                return None

        oferta = {"oferta_id": "mercadolivre_MLB1", "price": 99.90}
        with patch.object(main, "canais_ativos") as canais, \
             patch.object(main.observabilidade, "evento"):
            self.assertEqual(0, main.publicar(Fonte, oferta))
        canais.assert_not_called()

    def test_teste_real_do_facebook_nao_publica_em_outros_canais(self):
        from unittest.mock import Mock
        fonte = Mock(NOME="Shopee")
        fonte.gerar_link.return_value = "https://shopee.com.br/afiliado"
        oferta = {
            "oferta_id": "teste_buffer", "fonte": "Shopee", "price": 50,
            "productUrl": "https://shopee.com.br/item",
        }
        with patch.object(main.facebook, "esta_configurada", return_value=True), \
             patch.object(main, "FONTES", [fonte]), \
             patch.object(main, "fontes_ativas", return_value=[fonte]), \
             patch.object(main, "buscar_candidatos", return_value=[oferta]), \
             patch.object(main, "_ordenar_candidatos", return_value=[oferta]), \
             patch.object(main.store, "canal_pendente", return_value=True), \
             patch.object(main.store, "registrar_entrega") as registrar, \
             patch.object(main.shortlinks, "esta_configurado", return_value=False), \
             patch.object(main.facebook, "postar") as postar, \
             patch.object(main.observabilidade, "evento"):
            self.assertEqual(1, main.publicar_teste_facebook_real())
        postar.assert_called_once_with(oferta, "https://shopee.com.br/afiliado")
        registrar.assert_called_once_with(
            "teste_buffer", "Facebook", True, 50.0, "Shopee"
        )

    def test_repescagem_publica_novamente_em_canais_com_entrega_antiga(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import Mock
        fonte = Mock(NOME="Shopee")
        fonte.gerar_link.return_value = "https://shopee.com.br/item"
        canal = Mock(NOME="Telegram", TRACKING_ID="telegram")
        oferta = {"oferta_id": "regressao", "price": 50,
                  "productUrl": "https://shopee.com.br/item", "_motivo": "repescagem"}
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(main.store, "_DB", Path(tmp) / "estado.db"), \
             patch.object(main, "canais_ativos", return_value=[canal]), \
             patch.object(main.config, "DIAS_ANTES_DE_REPETIR", 7), \
             patch.object(main.shortlinks, "esta_configurado", return_value=False), \
             patch.object(main.site_publisher, "esta_configurado", return_value=False):
            main.store.registrar_entrega("regressao", "Telegram", True, 50,
                                        agora=int(main.time.time()) - 8 * 86400)
            self.assertEqual(1, main.publicar(fonte, oferta))
            self.assertEqual(0, main.publicar(fonte, oferta))
        canal.postar.assert_called_once()

    def test_atualizacao_catalogo_registra_sucesso_sem_erro_de_telemetria(self):
        with patch.object(main.site_publisher, "esta_configurado", return_value=True), \
             patch.object(main.site_publisher, "atualizar_catalogo",
                          return_value={"consultados": 6, "encontrados": 5}), \
             patch.object(main.observabilidade.store, "registrar_evento") as registrar:
            self.assertEqual(6, main.atualizar_catalogo_site([]))
        self.assertEqual("catalogo_atualizado", registrar.call_args.args[0])

    def test_agendamento_externo_nao_cria_espera_interna_apos_rodada_vazia(self):
        with patch.object(main, "minutos_para_proximo", return_value=0), \
             patch.object(main.store, "definir_proximo_post") as definir:
            agora = datetime(2026, 9, 8, 20, 0, tzinfo=main.FUSO_BRASILIA)
            main.agendar_proxima(tentativa_curta=True, agora=agora)
        definir.assert_called_once_with(int(agora.timestamp()))

    def test_historico_de_vendas_guarda_somente_ofertas_comerciais(self):
        class Fonte:
            NOME = "Shopee"

            @staticmethod
            def buscar_ofertas():
                base = {"fonte": "Shopee", "priceDiscountRate": 40,
                        "ratingStar": 4.8, "sales": 500, "comissao": 0.2,
                        "productName": "Produto útil", "categoria": "outros"}
                return [
                    {**base, "oferta_id": "apta", "price": 100},
                    {**base, "oferta_id": "barata", "price": 1},
                ]

        with patch.object(main, "canais_ativos", return_value=[]), \
             patch.object(main.site_publisher, "esta_configurado", return_value=False), \
             patch.object(main.store, "registrar_vendas_produtos",
                          return_value={}) as registrar, \
             patch.object(main.store, "avaliar_elegibilidade",
                          return_value="inedita"):
            candidatas = main.buscar_candidatos(Fonte)
        self.assertEqual(["apta"], [o["oferta_id"] for o in candidatas])
        registradas = registrar.call_args.args[0]
        self.assertEqual(["apta"], [o["oferta_id"] for o in registradas])

    def test_sincroniza_atalho_de_loja_uma_vez_por_dia(self):
        fonte = type("Fonte", (), {"NOME": "Shopee"})()
        momento = datetime(2026, 9, 6, 10, 0, tzinfo=main.FUSO_BRASILIA)
        with patch.object(main.site_publisher, "esta_configurado", return_value=True), \
             patch.object(main.store, "link_loja_site_sincronizado",
                          side_effect=[False, True]), \
             patch.object(main.site_publisher, "publicar_loja") as publicar, \
             patch.object(main.store, "marcar_link_loja_site_sincronizado") as marcar:
            self.assertEqual(1, main.sincronizar_links_lojas_site([fonte], momento))
            self.assertEqual(0, main.sincronizar_links_lojas_site([fonte], momento))
        publicar.assert_called_once_with(fonte)
        marcar.assert_called_once_with("2026-09-06", "Shopee")

    def test_nao_publica_atalho_generico_do_mercado_livre_no_site(self):
        fonte = type("Fonte", (), {"NOME": "Mercado Livre"})()
        momento = datetime(2026, 9, 6, 10, 0, tzinfo=main.FUSO_BRASILIA)
        with patch.object(main.site_publisher, "esta_configurado", return_value=True), \
             patch.object(main.site_publisher, "publicar_loja") as publicar, \
             patch.object(main.store, "marcar_link_loja_site_sincronizado") as marcar:
            self.assertEqual(0, main.sincronizar_links_lojas_site([fonte], momento))
        publicar.assert_not_called()
        marcar.assert_not_called()

    def test_shopee_vip_publica_uma_vez_por_janela_sem_criar_nova_execucao(self):
        manha = datetime(2026, 9, 7, 10, 15, tzinfo=main.FUSO_BRASILIA)
        noite = datetime(2026, 9, 7, 19, 15, tzinfo=main.FUSO_BRASILIA)
        with patch.object(main.config, "SHOPEE_VIP_ATIVO", True), \
             patch.object(main.config, "SHOPEE_VIP_URL", "https://u.shopee.com.br/vip"), \
             patch.object(main.config, "SHOPEE_VIP_DIAS", [0, 2, 5]), \
             patch.object(main.config, "SHOPEE_VIP_HORAS", [10, 11, 19, 20]), \
             patch.object(main.telegram_poster, "esta_configurada", return_value=True), \
             patch.object(main.bluesky, "esta_configurada", return_value=True), \
             patch.object(main.site_publisher, "esta_configurado", return_value=False), \
             patch.object(main.store, "campanha_enviada", return_value=False) as enviada, \
             patch.object(main.store, "marcar_campanha_enviada") as marcar, \
             patch.object(main.telegram_poster, "postar_shopee_vip") as postar, \
             patch.object(main.bluesky, "postar_shopee_vip") as postar_bluesky:
            self.assertTrue(main.publicar_shopee_vip_se_preciso(manha))
            self.assertTrue(main.publicar_shopee_vip_se_preciso(noite))
        self.assertEqual(2, postar.call_count)
        self.assertEqual(2, postar_bluesky.call_count)
        self.assertEqual("shopee_vip_manha", enviada.call_args_list[0].args[1])
        self.assertEqual("Telegram", enviada.call_args_list[0].args[2])
        self.assertEqual("Bluesky", enviada.call_args_list[1].args[2])
        self.assertEqual("shopee_vip_noite", enviada.call_args_list[2].args[1])
        self.assertEqual("shopee_vip_manha", marcar.call_args_list[0].args[1])
        self.assertEqual("Telegram", marcar.call_args_list[0].args[2])
        self.assertEqual("Bluesky", marcar.call_args_list[1].args[2])
        self.assertEqual("shopee_vip_noite", marcar.call_args_list[2].args[1])

    def test_shopee_vip_espera_quando_ha_alerta_urgente_de_cupom(self):
        momento = datetime(2026, 9, 7, 19, 15, tzinfo=main.FUSO_BRASILIA)
        with patch.object(main.config, "SHOPEE_VIP_ATIVO", True), \
             patch.object(main.config, "SHOPEE_VIP_URL", "https://u.shopee.com.br/vip"), \
             patch.object(main.config, "SHOPEE_VIP_DIAS", [0]), \
             patch.object(main.config, "SHOPEE_VIP_HORAS", [19]), \
             patch.object(main.telegram_poster, "esta_configurada", return_value=True), \
             patch.object(main.bluesky, "esta_configurada", return_value=False), \
             patch.object(main.telegram_poster, "postar_shopee_vip") as postar:
            self.assertFalse(main.publicar_shopee_vip_se_preciso(
                momento, alertas_cupom=1
            ))
        postar.assert_not_called()

    def test_execucao_manual_do_vip_ignora_horario_repeticao_e_alerta(self):
        momento = datetime(2026, 9, 8, 3, 15, tzinfo=main.FUSO_BRASILIA)
        with patch.object(main.config, "SHOPEE_VIP_ATIVO", True), \
             patch.object(main.config, "SHOPEE_VIP_URL", "https://u.shopee.com.br/vip"), \
             patch.object(main.config, "SHOPEE_VIP_DIAS", [0]), \
             patch.object(main.config, "SHOPEE_VIP_HORAS", [19]), \
             patch.object(main.telegram_poster, "esta_configurada", return_value=True), \
             patch.object(main.bluesky, "esta_configurada", return_value=False), \
             patch.object(main.site_publisher, "esta_configurado", return_value=False), \
             patch.object(main.store, "campanha_enviada", return_value=True) as enviada, \
             patch.object(main.store, "marcar_campanha_enviada") as marcar, \
             patch.object(main.telegram_poster, "postar_shopee_vip") as postar:
            self.assertTrue(main.publicar_shopee_vip_se_preciso(
                momento, alertas_cupom=1, forcar=True
            ))
        enviada.assert_not_called()
        postar.assert_called_once()
        marcar.assert_called_once_with("2026-09-08", "shopee_vip_manha", "Telegram")

    def test_falha_do_vip_no_telegram_nao_impede_bluesky(self):
        momento = datetime(2026, 9, 8, 19, 15, tzinfo=main.FUSO_BRASILIA)
        with patch.object(main.config, "SHOPEE_VIP_ATIVO", True), \
             patch.object(main.config, "SHOPEE_VIP_URL", "https://u.shopee.com.br/vip"), \
             patch.object(main.telegram_poster, "esta_configurada", return_value=True), \
             patch.object(main.bluesky, "esta_configurada", return_value=True), \
             patch.object(main.site_publisher, "esta_configurado", return_value=False), \
             patch.object(main.store, "marcar_campanha_enviada") as marcar, \
             patch.object(main.telegram_poster, "postar_shopee_vip",
                          side_effect=RuntimeError("fora")), \
             patch.object(main.bluesky, "postar_shopee_vip") as postar_bluesky:
            self.assertTrue(main.publicar_shopee_vip_se_preciso(
                momento, forcar=True
            ))

        postar_bluesky.assert_called_once()
        marcar.assert_called_once_with("2026-09-08", "shopee_vip_noite", "Bluesky")

    def test_falha_ao_atualizar_catalogo_nao_interrompe_rodada(self):
        with patch.object(main.site_publisher, "esta_configurado", return_value=True), \
             patch.object(main.site_publisher, "atualizar_catalogo",
                          side_effect=RuntimeError("serviço fora")):
            self.assertEqual(0, main.atualizar_catalogo_site([]))

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
        self.assertEqual("codigo", cupons[0]["tipo"])

    def test_reune_campanhas_oficiais_sem_interromper_outras_fontes(self):
        class FonteOk:
            NOME = "Shopee"

            @staticmethod
            def buscar_cupons():
                return [{"id": "voucher_1", "codigo": ""}]

        class FonteFalha:
            NOME = "Outra"

            @staticmethod
            def buscar_cupons():
                raise RuntimeError("indisponível")

        self.assertEqual(
            [{"id": "voucher_1", "codigo": ""}],
            main.cupons_das_plataformas([FonteOk, FonteFalha]),
        )

    def test_desconto_maior_vence_variedade_quando_ambas_sao_inéditas(self):
        alta = {"oferta_id": "alta", "fonte": "Shopee", "price": 50,
                "priceDiscountRate": 70, "categoria": "cozinha", "_motivo": "inedita"}
        baixa = {"oferta_id": "baixa", "fonte": "Shopee", "price": 50,
                 "priceDiscountRate": 30, "categoria": "eletronicos", "_motivo": "inedita"}
        with patch.object(main.store, "ofertas_recentes", return_value=[]), \
             patch.object(main.store, "multiplicadores_desempenho", return_value={}):
            ordenadas = main._ordenar_candidatos([baixa, alta])
        self.assertEqual("alta", ordenadas[0]["oferta_id"])

    def test_pico_reserva_primeira_vaga_para_campeao_shopee(self):
        comum = {"oferta_id": "comum", "fonte": "Shopee", "sales": 50000,
                 "priceDiscountRate": 80, "comissao": 0}
        campeao = {"oferta_id": "campeao", "fonte": "Shopee", "sales": 1000,
                   "priceDiscountRate": 35, "comissao": 0,
                   "_shopee_campeao": True, "_vendas_24h": 40,
                   "_vendas_janela": 180}
        with patch.object(main.config, "PICO_PRIORIZA_MAIS_VENDIDOS", True), \
             patch.object(main.config, "HORAS_PICO", [12]):
            fila = main._priorizar_campeao_no_pico(
                [comum, campeao], datetime(2026, 9, 3, 12)
            )
        self.assertEqual(["campeao", "comum"], [o["oferta_id"] for o in fila])

    def test_fora_do_pico_preserva_ordenacao_normal(self):
        fila_original = [
            {"oferta_id": "comum", "fonte": "AliExpress"},
            {"oferta_id": "campeao", "fonte": "Shopee", "_shopee_campeao": True},
        ]
        with patch.object(main.config, "PICO_PRIORIZA_MAIS_VENDIDOS", True), \
             patch.object(main.config, "HORAS_PICO", [12]):
            fila = main._priorizar_campeao_no_pico(
                fila_original, datetime(2026, 9, 3, 10)
            )
        self.assertEqual(fila_original, fila)

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

    def test_falha_sistemica_do_diario_interrompe_sem_tentar_outros_canais(self):
        class Fonte:
            NOME = "Shopee"

            @staticmethod
            def gerar_link(*args):
                return "https://oferta.test"

        primeiro = unittest.mock.Mock(NOME="Telegram", TRACKING_ID="telegram")
        segundo = unittest.mock.Mock(NOME="Bluesky", TRACKING_ID="bsky")
        oferta = {"oferta_id": "x", "productUrl": "https://produto.test",
                  "price": 50}
        with patch.object(main, "canais_ativos", return_value=[primeiro, segundo]), \
             patch.object(main.store, "canal_pendente", return_value=True), \
             patch.object(main.shortlinks, "esta_configurado", return_value=False), \
             patch.object(main.idempotencia, "reservar_oferta",
                          side_effect=main.idempotencia.DiarioRemotoIndisponivel("fora")):
            with self.assertRaisesRegex(main.idempotencia.DiarioRemotoIndisponivel,
                                        "fora"):
                main.publicar(Fonte, oferta)
        primeiro.postar.assert_not_called()
        segundo.postar.assert_not_called()

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

    def test_mercado_livre_nao_usa_encurtador_externo(self):
        class Fonte:
            NOME = "Mercado Livre"

            @staticmethod
            def gerar_link(*args):
                return "https://www.mercadolivre.com.br/produto?matt_tool=71195511"

        class Canal:
            NOME = "Instagram Stories"
            TRACKING_ID = "instagram"

            @staticmethod
            def postar(*args):
                return None

        oferta = {"oferta_id": "mercadolivre_MLB1", "productUrl": "https://produto.test",
                  "price": 50}
        with patch.object(main, "canais_ativos", return_value=[Canal]), \
             patch.object(main.store, "canal_pendente", return_value=True), \
             patch.object(main.store, "registrar_entrega"), \
             patch.object(main.shortlinks, "esta_configurado", return_value=True), \
             patch.object(main.shortlinks, "criar") as criar, \
             patch.object(main.site_publisher, "esta_configurado", return_value=False), \
             patch.object(Canal, "postar") as postar:
            self.assertEqual(1, main.publicar(Fonte, oferta))
        criar.assert_not_called()
        postar.assert_called_once_with(
            oferta, "https://www.mercadolivre.com.br/produto?matt_tool=71195511"
        )

    def test_outras_lojas_continuam_usando_dominio_curto(self):
        class Fonte:
            NOME = "Shopee"

            @staticmethod
            def gerar_link(*args):
                return "https://shopee.com.br/produto"

        canal = unittest.mock.Mock(NOME="Instagram Stories", TRACKING_ID="instagram")
        oferta = {"oferta_id": "shopee_1", "productUrl": "https://produto.test",
                  "price": 50}
        curto = "https://go.canaltabarato.com.br/abcdefgh"
        with patch.object(main, "canais_ativos", return_value=[canal]), \
             patch.object(main.store, "canal_pendente", return_value=True), \
             patch.object(main.store, "registrar_entrega"), \
             patch.object(main.shortlinks, "esta_configurado", return_value=True), \
             patch.object(main.shortlinks, "criar", return_value=curto), \
             patch.object(main.shortlinks, "eh_proprio", return_value=True), \
             patch.object(main.site_publisher, "esta_configurado", return_value=False):
            self.assertEqual(1, main.publicar(Fonte, oferta))
        canal.postar.assert_called_once_with(oferta, curto)

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

    def test_comando_campanha_executa_somente_a_campanha_escolhida(self):
        with patch.object(main.sys, "argv", ["main.py", "--campanha", "shopee_vip"]), \
             patch.object(main, "executar_campanha", return_value=True) as executar, \
             patch.object(main, "checar") as checar, \
             patch.object(main, "rodar_uma_vez") as rodar:
            main.main()

        executar.assert_called_once_with("shopee_vip")
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
             patch.object(main.config, "peso_loja", return_value=1), \
             patch.object(main.config, "percentual_loja", return_value=0):
            self.assertEqual(1, main.rodar_uma_vez())

        self.assertEqual("AliExpress", publicar.call_args.args[0].NOME)

    def test_percentuais_distribuem_vinte_ofertas_entre_as_quatro_fontes(self):
        from collections import Counter
        fontes = ("Shopee", "Mercado Livre", "Amazon", "AliExpress")
        fila = []
        for fonte_nome in fontes:
            fonte = type("Fonte", (), {"NOME": fonte_nome})()
            for indice in range(20):
                fila.append({"_fonte_obj": fonte, "fonte": fonte_nome,
                             "oferta_id": f"{fonte_nome}-{indice}",
                             "productName": f"Produto {fonte_nome} {indice}",
                             "categoria": "outros"})
        with patch.object(main.store, "posts_por_fonte_desde", return_value={}), \
             patch.object(main.store, "posts_por_loja_hoje", return_value={}), \
             patch.object(main.store, "marcar_postada"), \
             patch.object(main, "publicar", return_value=1) as publicar, \
             patch.object(main.desempenho, "produtos_semelhantes", return_value=False), \
             patch.object(main.config, "DELAY_BETWEEN_POSTS_SECONDS", 0):
            self.assertEqual(20, main._publicar_fila(fila, 20))
        totais = Counter(chamada.args[0].NOME for chamada in publicar.call_args_list)
        self.assertEqual({"Shopee": 6, "Mercado Livre": 6,
                          "Amazon": 5, "AliExpress": 3}, dict(totais))

    def test_apos_tres_posts_da_mesma_fonte_prioriza_outra_disponivel(self):
        shopee = type("Fonte", (), {"NOME": "Shopee"})()
        amazon = type("Fonte", (), {"NOME": "Amazon"})()
        fila = [
            {"_fonte_obj": shopee, "fonte": "Shopee", "oferta_id": "s4",
             "productName": "Oferta Shopee", "categoria": "casa"},
            {"_fonte_obj": amazon, "fonte": "Amazon", "oferta_id": "a1",
             "productName": "Oferta Amazon", "categoria": "eletronicos"},
        ]
        with patch.object(main.store, "sequencia_fonte_recente",
                          return_value=("Shopee", 3)), \
             patch.object(main.store, "posts_por_fonte_desde", return_value={}), \
             patch.object(main.store, "posts_por_loja_hoje", return_value={}), \
             patch.object(main.store, "marcar_postada"), \
             patch.object(main, "publicar", return_value=1) as publicar, \
             patch.object(main.config, "MAX_POSTS_CONSECUTIVOS_FONTE", 3), \
             patch.object(main.config, "percentual_loja",
                          side_effect=lambda fonte: 100 if fonte == "Shopee" else 1):
            self.assertEqual(1, main._publicar_fila(fila, 1))
        self.assertEqual("Amazon", publicar.call_args.args[0].NOME)

    def test_apos_tres_posts_continua_mesma_fonte_se_nao_ha_alternativa(self):
        shopee = type("Fonte", (), {"NOME": "Shopee"})()
        fila = [{"_fonte_obj": shopee, "fonte": "Shopee", "oferta_id": "s4",
                 "productName": "Oferta Shopee", "categoria": "casa"}]
        with patch.object(main.store, "sequencia_fonte_recente",
                          return_value=("Shopee", 3)), \
             patch.object(main.store, "posts_por_fonte_desde", return_value={}), \
             patch.object(main.store, "posts_por_loja_hoje", return_value={}), \
             patch.object(main.store, "marcar_postada"), \
             patch.object(main, "publicar", return_value=1) as publicar, \
             patch.object(main.config, "MAX_POSTS_CONSECUTIVOS_FONTE", 3):
            self.assertEqual(1, main._publicar_fila(fila, 1))
        self.assertEqual("Shopee", publicar.call_args.args[0].NOME)

    def test_categoria_saturada_na_janela_da_lugar_a_outra(self):
        fonte = type("Fonte", (), {"NOME": "Shopee"})()
        fila = [
            {"_fonte_obj": fonte, "fonte": "Shopee", "oferta_id": "celular",
             "productName": "Smartphone premium", "categoria": "eletronicos"},
            {"_fonte_obj": fonte, "fonte": "Shopee", "oferta_id": "panela",
             "productName": "Panela antiaderente", "categoria": "cozinha"},
        ]
        recentes = [
            {"categoria": "eletronicos"}, {"categoria": "casa"},
            {"categoria": "eletronicos"},
        ]
        with patch.object(main.store, "ofertas_recentes", return_value=recentes), \
             patch.object(main.store, "sequencia_fonte_recente", return_value=(None, 0)), \
             patch.object(main.store, "posts_por_fonte_desde", return_value={}), \
             patch.object(main.store, "posts_por_loja_hoje", return_value={}), \
             patch.object(main.store, "marcar_postada"), \
             patch.object(main, "publicar", return_value=1) as publicar, \
             patch.object(main.config, "DIVERSIDADE_JANELA_POSTS", 6), \
             patch.object(main.config, "MAX_POSTS_CATEGORIA_NA_JANELA", 2):
            self.assertEqual(1, main._publicar_fila(fila, 1))
        self.assertEqual("panela", publicar.call_args.args[1]["oferta_id"])

    def test_completar_canais_secundarios_nao_consome_vaga_da_rodada(self):
        fonte = type("Fonte", (), {"NOME": "Shopee"})()
        fila = [
            {"_fonte_obj": fonte, "fonte": "Shopee", "oferta_id": "antiga-1",
             "productName": "Panela antiaderente", "categoria": "cozinha",
             "_motivo": "canal_pendente", "price": 50},
            {"_fonte_obj": fonte, "fonte": "Shopee", "oferta_id": "antiga-2",
             "productName": "Garrafa térmica", "categoria": "casa",
             "_motivo": "canal_pendente", "price": 40},
            {"_fonte_obj": fonte, "fonte": "Shopee", "oferta_id": "nova",
             "productName": "Fone Bluetooth", "categoria": "eletronicos",
             "_motivo": "inedita", "price": 80},
        ]
        with patch.object(main, "canais_ativos",
                          return_value=[main.telegram_poster, main.bluesky,
                                        main.facebook]), \
             patch.object(main.store, "ha_canal_pendente", return_value=False), \
             patch.object(main.store, "marcar_postada") as marcar, \
             patch.object(main, "publicar", return_value=1) as publicar, \
             patch.object(main.desempenho, "produtos_semelhantes", return_value=False), \
             patch.object(main.time, "sleep"):
            self.assertEqual(1, main._publicar_fila(fila, 1))

        # Só um complemento por rodada; a oferta nova ocupa a vaga normal.
        self.assertEqual(["antiga-1", "nova"],
                         [c.args[1]["oferta_id"] for c in publicar.call_args_list])
        marcar.assert_called_once()
        self.assertEqual("nova", marcar.call_args.args[0])

    def test_reenvio_pendente_no_telegram_continua_contando_na_rodada(self):
        fonte = type("Fonte", (), {"NOME": "Shopee"})()
        fila = [
            {"_fonte_obj": fonte, "fonte": "Shopee", "oferta_id": "falhou",
             "productName": "Panela antiaderente", "categoria": "cozinha",
             "_motivo": "canal_pendente", "price": 50},
            {"_fonte_obj": fonte, "fonte": "Shopee", "oferta_id": "nova",
             "productName": "Fone Bluetooth", "categoria": "eletronicos",
             "_motivo": "inedita", "price": 80},
        ]
        with patch.object(main, "canais_ativos",
                          return_value=[main.telegram_poster, main.bluesky]), \
             patch.object(main.store, "ha_canal_pendente", return_value=True), \
             patch.object(main.store, "marcar_postada"), \
             patch.object(main, "publicar", return_value=1) as publicar, \
             patch.object(main.time, "sleep"):
            self.assertEqual(1, main._publicar_fila(fila, 1))
        self.assertEqual(["falhou"],
                         [c.args[1]["oferta_id"] for c in publicar.call_args_list])

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

    def test_bloqueia_mesmo_produto_com_outro_identificador(self):
        fonte = type("Fonte", (), {"NOME": "Shopee"})()
        candidato = {"_fonte_obj": fonte, "_motivo": "inedita",
                     "fonte": "Shopee", "oferta_id": "novo-id",
                     "productName": "Liquidificador Mondial L-99 Turbo 550W",
                     "price": 100, "priceDiscountRate": 40,
                     "categoria": "cozinha"}
        historico = [{"oferta_id": "id-antigo",
                      "titulo": "Liquidificador Mondial L-99 Turbo 550W",
                      "preco": 109.99}]
        with patch.object(main.store, "ofertas_recentes", return_value=[]), \
             patch.object(main.store, "ofertas_desde", return_value=historico), \
             patch.object(main.store, "posts_por_loja_hoje", return_value={}), \
             patch.object(main.store, "multiplicadores_desempenho", return_value={}):
            self.assertEqual([], main._ordenar_candidatos([candidato]))

    def test_queda_real_libera_produto_semelhante(self):
        fonte = type("Fonte", (), {"NOME": "Shopee"})()
        candidato = {"_fonte_obj": fonte, "_motivo": "inedita",
                     "fonte": "Shopee", "oferta_id": "novo-id",
                     "productName": "Liquidificador Mondial L-99 Turbo 550W",
                     "price": 84.99, "priceDiscountRate": 45,
                     "categoria": "cozinha"}
        historico = [{"oferta_id": "id-antigo",
                      "titulo": "Liquidificador Mondial L-99 Turbo 550W",
                      "preco": 100}]
        with patch.object(main.store, "ofertas_recentes", return_value=[]), \
             patch.object(main.store, "ofertas_desde", return_value=historico), \
             patch.object(main.store, "posts_por_loja_hoje", return_value={}), \
             patch.object(main.store, "multiplicadores_desempenho", return_value={}):
            self.assertEqual("novo-id", main._ordenar_candidatos([candidato])[0]["oferta_id"])

    def test_limite_diario_evitar_busca_desnecessaria(self):
        with patch.object(main.store, "posts_hoje", return_value=50), \
             patch.object(main.config, "MAX_POSTS_POR_DIA", 50), \
             patch.object(main, "fontes_ativas") as fontes:
            self.assertEqual(0, main.rodar_uma_vez())
            fontes.assert_not_called()

    def test_desconto_baixo_exige_prova_comercial_forte(self):
        fraca = {"price": 50, "priceDiscountRate": 20, "ratingStar": 4.7,
                 "sales": 200, "comissao": 0.1}
        forte = dict(fraca, ratingStar=4.9, sales=5000)
        with patch.object(main.config, "MIN_DISCOUNT", 15), \
             patch.object(main.config, "DESCONTO_PREFERIDO", 30), \
             patch.object(main.config, "VENDAS_EXCECAO_DESCONTO", 1000), \
             patch.object(main.config, "MIN_RATING", 4), \
             patch.object(main.config, "MIN_SALES", 50), \
             patch.object(main.config, "MIN_PRICE", 10), \
             patch.object(main.config, "MIN_GANHO", 3):
            self.assertFalse(main.passa_no_filtro(fraca))
            self.assertTrue(main.passa_no_filtro(forte))

    def test_curadoria_manual_nao_exige_metrica_que_lista_nao_informa(self):
        oferta = {"price": 28.90, "priceDiscountRate": 0,
                  "ratingStar": 4.9, "sales": None, "comissao": None,
                  "curadoriaManual": True}
        with patch.object(main.config, "MIN_DISCOUNT", 15), \
             patch.object(main.config, "DESCONTO_PREFERIDO", 30), \
             patch.object(main.config, "MIN_RATING", 4), \
             patch.object(main.config, "MIN_PRICE", 10), \
             patch.object(main.config, "MIN_GANHO", 3):
            self.assertTrue(main.passa_no_filtro(oferta))

    def test_diagnostico_identifica_regra_comercial_que_rejeitou(self):
        oferta = {"price": 5, "priceDiscountRate": 80,
                  "ratingStar": 5, "sales": 1000, "comissao": 1}
        with patch.object(main.config, "MIN_PRICE", 10):
            self.assertEqual("preco", main.motivo_rejeicao_filtro(oferta))


if __name__ == "__main__":
    unittest.main()
