import unittest
from datetime import datetime
from unittest.mock import patch

import relatorio


class RelatorioTest(unittest.TestCase):
    def test_saude_das_lojas_aponta_pagina_que_mudou(self):
        saude = {"Shopee": {"ok": 20, "falhas": {}},
                 "Mercado Livre": {"ok": 3, "falhas": {"pagina_mudou": 17}},
                 "Amazon": {"ok": 11, "falhas": {"bloqueio": 9}}}
        linhas = relatorio.linhas_saude_fontes(saude)
        self.assertIn("✅ Shopee: 20/20 rodadas", linhas)
        self.assertIn("❌ Mercado Livre: 3/20 rodadas · página mudou 17", linhas)
        self.assertIn("⚠️ Amazon: 11/20 rodadas · bloqueio da loja 9", linhas)
        alertas = relatorio.alertas_saude_fontes(saude)
        self.assertEqual(1, len(alertas))
        self.assertIn("Mercado Livre funcionou em só 3 de 20 rodadas", alertas[0])
        self.assertIn("precisa de ajuste", alertas[0])
        texto = relatorio._texto([], "22/10/2026", saude=saude)
        self.assertIn("🩺 SAÚDE DAS LOJAS · ONTEM", texto)

    def test_vencedora_ab_exige_amostra_e_vantagem_clara(self):
        forte = [{"variante": "A", "posts": 40, "conversoes": 12, "comissao": 0},
                 {"variante": "B", "posts": 40, "conversoes": 4, "comissao": 0}]
        self.assertIn("Variante A converte mais (30.0% vs 10.0%",
                      relatorio._vencedora_ab(forte))
        pequena = [dict(item, posts=20) for item in forte]
        self.assertEqual("", relatorio._vencedora_ab(pequena))
        empate = [dict(forte[0], conversoes=8), dict(forte[1], conversoes=7)]
        self.assertEqual("", relatorio._vencedora_ab(empate))

    def test_soma_cliques_de_links_e_site(self):
        total = relatorio._somar_cliques([
            {"total": 2, "por_canal": {"telegram": 2},
             "por_fonte": {"Shopee": 2}, "por_oferta": {"a": 2}},
            {"total": 3, "por_canal": {"site": 3},
             "por_fonte": {"Shopee": 1, "Amazon": 2},
             "por_fonte_canal": {"Amazon": {"site": 2}},
             "por_oferta": {"a": 1, "b": 2},
             "por_origem": {"instagram": 3}},
        ])
        self.assertEqual(5, total["total"])
        self.assertEqual(3, total["por_oferta"]["a"])
        self.assertEqual(3, total["por_fonte"]["Shopee"])
        self.assertEqual(2, total["por_fonte_canal"]["Amazon"]["site"])
        self.assertEqual(3, total["por_origem"]["instagram"])

    def setUp(self):
        for nome, retorno in (
            ("metadados_ofertas", {}),
            ("publicacoes_por_fonte", {}),
            ("publicacoes_por_fonte_canal", {}),
            ("ofertas_sem_conversao", []),
            ("tendencias_diarias", {}),
            ("resumo_experimentos", []),
            ("falhas_consecutivas", 0),
            ("resumo_eventos", {}),
        ):
            remendo = patch.object(getattr(relatorio, "store"), nome,
                                   return_value=retorno)
            remendo.start()
            self.addCleanup(remendo.stop)
        salvar = patch.object(relatorio.store, "salvar_desempenho")
        salvar.start()
        self.addCleanup(salvar.stop)
        for nome in ("salvar_metricas_diarias", "salvar_experimentos_diarios"):
            remendo = patch.object(relatorio.store, nome)
            remendo.start()
            self.addCleanup(remendo.stop)
        links = patch.object(relatorio.shortlinks, "esta_configurado",
                             return_value=False)
        links.start()
        self.addCleanup(links.stop)

    def test_desativado_sem_admin(self):
        with patch.object(relatorio.config, "TELEGRAM_ADMIN_ID", ""):
            self.assertFalse(relatorio.enviar_se_devido(datetime(2026, 8, 17, 10)))

    def test_resultados_de_ontem_abrem_relatorio_sem_somar_canceladas(self):
        texto = relatorio._texto(
            [], "02/09/2026", cliques={"total": 999},
            diario_ali={"pagos": 2, "confirmados": 1, "invalidos": 20},
            diario_shopee={"pendentes": 4, "concluidas": 2, "canceladas": 30},
            cliques_dia={"total": 42},
        )
        inicio = texto.split("📮 OPERAÇÃO DE ONTEM")[0]
        self.assertIn("🔗 Cliques: 42", inicio)
        self.assertIn("🛒 Vendas: 9", inicio)
        self.assertIn("AliExpress: 3 · Shopee: 6", inicio)
        self.assertIn("Amazon e Mercado Livre: vendas não incluídas", inicio)
        self.assertNotIn("999", inicio)

    def test_relatorio_separa_cliques_amazon_e_mercado_livre_por_canal(self):
        cliques = {
            "total": 9,
            "por_fonte": {"Amazon": 4, "Mercado Livre": 3, "Shopee": 2},
            "por_fonte_canal": {
                "Amazon": {"Telegram": 3, "Facebook": 1},
                "Mercado Livre": {"Site": 2, "X": 1},
            },
        }
        texto = relatorio._texto([], "02/09/2026", cliques=cliques,
                                 cliques_dia=cliques)
        self.assertIn("Cliques por loja: Amazon: 4 (Facebook 1 · Telegram 3)", texto)
        self.assertIn("Mercado Livre: 3 (Site 2 · X 1)", texto)
        self.assertIn("Mercado Livre: só cliques do site", texto)
        self.assertIn("Por loja: Amazon: 4", texto)

    def test_relatorio_compara_cliques_por_post_de_cada_loja_com_a_meta(self):
        cliques = {"total": 30, "por_fonte": {"Shopee": 20, "Amazon": 10}}
        with patch.object(relatorio.config, "PERCENTUAL_SHOPEE", 50), \
             patch.object(relatorio.config, "PERCENTUAL_AMAZON", 50):
            texto = relatorio._texto([], "02/09/2026", cliques=cliques,
                                     posts_7d={"Shopee": 40, "Amazon": 5})
        self.assertIn("• Amazon: 5 posts · 10 cliques · 2,00/post · "
                      "33% dos cliques (meta 50%)", texto)
        self.assertIn("• Shopee: 40 posts · 20 cliques · 0,50/post · "
                      "67% dos cliques (meta 50%)", texto)
        self.assertIn("Por loja: Amazon: 10 · Mercado Livre: 0 · Shopee: 20", texto)
        self.assertNotIn("Mercado Livre conta só", texto)

    def test_resultado_diario_indisponivel_nao_vira_zero(self):
        texto = relatorio._texto([], "02/09/2026")
        self.assertIn("Cliques: indisponível", texto)
        self.assertIn("Vendas: indisponível", texto)
        parcial = relatorio._texto([], "02/09/2026", diario_shopee={
            "pendentes": 0, "concluidas": 0,
        }, cliques_dia={"total": 0})
        self.assertIn("Cliques: 0", parcial)
        self.assertIn("Vendas: 0 (parcial)", parcial)

    def test_desativado_sem_token_do_telegram(self):
        with patch.object(relatorio.config, "TELEGRAM_ADMIN_ID", "123"), \
             patch.object(relatorio.config, "TELEGRAM_BOT_TOKEN", ""):
            self.assertFalse(relatorio.enviar_se_devido(datetime(2026, 8, 17, 10)))

    def test_envia_uma_vez_por_dia(self):
        resposta = type("Resposta", (), {"json": lambda self: {"ok": True}})()
        with patch.object(relatorio.config, "TELEGRAM_ADMIN_ID", "123"), \
             patch.object(relatorio.config, "TELEGRAM_BOT_TOKEN", "token"), \
             patch.object(relatorio.config, "RELATORIO_HORA", 11), \
             patch.object(relatorio.config, "RELATORIO_MINUTO", 30), \
             patch.object(relatorio.aliexpress, "esta_configurada", return_value=True), \
             patch.object(relatorio.aliexpress, "resumo_conversoes", return_value={
                 "pagos": 0, "confirmados": 0, "invalidos": 0,
                 "por_tracking": {}, "comissoes": {}}), \
             patch.object(relatorio.shopee, "esta_configurada", return_value=False), \
             patch.object(relatorio.store, "relatorio_enviado", side_effect=[False, True]), \
             patch.object(relatorio.store, "resumo_periodo", return_value=[]), \
             patch.object(relatorio.store, "marcar_relatorio_enviado") as marcar, \
             patch.object(relatorio.requests, "post", return_value=resposta):
            self.assertFalse(relatorio.enviar_se_devido(
                datetime(2026, 8, 17, 11, 29)
            ))
            agora = datetime(2026, 8, 17, 11, 30)
            self.assertTrue(relatorio.enviar_se_devido(agora))
            self.assertFalse(relatorio.enviar_se_devido(agora))
            marcar.assert_called_once_with("2026-08-16")

    def test_texto_inclui_conversoes_tracking_e_comissao(self):
        conversoes = {
            "pagos": 2,
            "confirmados": 1,
            "invalidos": 1,
            "por_tracking": {"telegram": 2, "bsky": 1},
            "comissoes": {"USD": 6.75},
            "comissoes_por_tracking": {"telegram": {"USD": 4.5}},
        }
        texto = relatorio._texto([], "20/08/2026", conversoes)
        self.assertIn("🛒 AliExpress", texto)
        self.assertIn("✅ 1 confirmados · ⏳ 2 pagos · ❌ 1 inválidos", texto)
        self.assertIn("Por canal: bsky: 1 · telegram: 2", texto)
        self.assertIn("Comissão: US$ 6,75", texto)
        self.assertIn("Comissão telegram: US$ 4,50", texto)

    def test_texto_resume_filtros_fallbacks_e_falhas(self):
        eventos = {
            "por_tipo": {"ofertas_recebidas": 100, "ofertas_elegiveis": 8,
                         "ofertas_rejeitadas": 92},
            "rejeicoes": {"desconto": 70, "vendas": 22},
            "fallbacks": {"bluesky_imagem_download": 3},
            "falhas_por_canal": {"Telegram": 1},
        }
        texto = relatorio._texto([], "20/08/2026", eventos=eventos)
        self.assertIn("🧭 DIAGNÓSTICO", texto)
        self.assertIn("100 recebidas · 8 elegíveis · 92 rejeitadas", texto)
        self.assertIn("desconto 70", texto)
        self.assertIn("Bluesky", texto)
        self.assertIn("Telegram 1", texto)

    def test_texto_inclui_conversoes_e_comissoes_shopee(self):
        conversoes = {
            "pendentes": 2,
            "concluidas": 1,
            "canceladas": 3,
            "outros": 0,
            "por_tracking": {"telegram": 2, "bsky": 1},
            "comissao_estimada": 12.5,
            "comissao_liquida": 7.25,
            "comissao_por_tracking": {"telegram": 12.5, "bsky": 7.25},
        }
        texto = relatorio._texto([], "20/08/2026", None, conversoes)
        self.assertIn("🛍 Shopee", texto)
        self.assertIn("✅ 1 concluídas · ⏳ 2 pendentes · ❌ 3 canceladas", texto)
        self.assertIn("Por canal: bsky: 1 · telegram: 2", texto)
        self.assertIn("Comissão: R$ 12,50 estimada · R$ 7,25 líquida", texto)
        self.assertIn("Comissão por canal: bsky R$ 7,25 · telegram R$ 12,50", texto)

    def test_texto_mostra_detalhes_alertas_e_limite_de_cliques(self):
        conversoes = {
            "pagos": 1, "confirmados": 0, "invalidos": 0,
            "por_tracking": {"telegram": 1}, "comissoes": {"USD": 2},
            "por_hora": {"19h": 2}, "por_categoria": {"cozinha": 2},
            "por_faixa_preco": {"ate R$ 50": 2},
            "por_faixa_desconto": {"40% a 69%": 2},
            "produtos": [{"nome": "Panela antiaderente", "quantidade": 2}],
        }
        texto = relatorio._texto([], "20/08/2026", conversoes, None,
                                 ["Shopee: 10 posts e nenhuma conversao"],
                                 [("x", "Shopee", "Produto sem venda")], {
                                     "total": 5, "por_canal": {"Telegram": 5},
                                     "por_origem": {"instagram": 3},
                                     "por_produto": {"Panela": 5},
                                     "somente_cliques": [("Panela", 5)],
                                 })
        self.assertIn("AliExpress — Produtos: Panela antiaderente (2)", texto)
        self.assertIn("AliExpress — Horários: 19h 2", texto)
        self.assertIn("AliExpress — Categorias: cozinha 2", texto)
        self.assertIn("🔗 CLIQUES · 5 nos últimos 7 dias", texto)
        self.assertIn("Shopee: 10 posts e nenhuma conversao", texto)
        self.assertIn("Produto sem venda", texto)
        self.assertIn("Mais clicados: Panela (5)", texto)
        self.assertIn("Origem das visitas: instagram 3", texto)
        self.assertIn("Sem conversão: Panela (5)", texto)

    def test_texto_mostra_tendencia_e_ab_so_com_amostra_minima(self):
        texto = relatorio._texto([], "21/08/2026", tendencias={
            "Shopee": {
                "atual": {"posts": 20, "conversoes": 2, "dias": 7},
                "anterior": {"posts": 18, "conversoes": 1, "dias": 7},
            }
        }, testes_ab=[
            {"variante": "A", "posts": 12, "conversoes": 2, "comissao": 8},
            {"variante": "B", "posts": 5, "conversoes": 1, "comissao": 3},
        ])
        self.assertIn("📈 TENDÊNCIA SEMANAL", texto)
        self.assertIn("10.0%", texto)
        self.assertIn("• A: 12 posts", texto)
        self.assertNotIn("• B: 5 posts", texto)

    def test_falha_da_api_mantem_o_resumo_operacional(self):
        resposta = type("Resposta", (), {"json": lambda self: {"ok": True}})()
        with patch.object(relatorio.config, "TELEGRAM_ADMIN_ID", "123"), \
             patch.object(relatorio.config, "TELEGRAM_BOT_TOKEN", "token"), \
             patch.object(relatorio.config, "RELATORIO_HORA", 8), \
             patch.object(relatorio.aliexpress, "esta_configurada", return_value=True), \
             patch.object(relatorio.aliexpress, "resumo_conversoes",
                          side_effect=RuntimeError("fora do ar")), \
             patch.object(relatorio.shopee, "esta_configurada", return_value=False), \
             patch.object(relatorio.store, "relatorio_enviado", return_value=False), \
             patch.object(relatorio.store, "resumo_periodo", return_value=[]), \
             patch.object(relatorio.store, "marcar_relatorio_enviado"), \
             patch.object(relatorio.requests, "post", return_value=resposta) as postar:
            self.assertTrue(relatorio.enviar_se_devido(datetime(2026, 8, 17, 9)))
            self.assertIn("Dados de conversão indisponíveis hoje.",
                          postar.call_args.kwargs["json"]["text"])

    def test_nao_consulta_aliexpress_quando_a_loja_esta_desconfigurada(self):
        resposta = type("Resposta", (), {"json": lambda self: {"ok": True}})()
        with patch.object(relatorio.config, "TELEGRAM_ADMIN_ID", "123"), \
             patch.object(relatorio.config, "TELEGRAM_BOT_TOKEN", "token"), \
             patch.object(relatorio.config, "RELATORIO_HORA", 8), \
             patch.object(relatorio.aliexpress, "esta_configurada", return_value=False), \
             patch.object(relatorio.aliexpress, "resumo_conversoes") as consultar, \
             patch.object(relatorio.shopee, "esta_configurada", return_value=False), \
             patch.object(relatorio.store, "relatorio_enviado", return_value=False), \
             patch.object(relatorio.store, "resumo_periodo", return_value=[]), \
             patch.object(relatorio.store, "marcar_relatorio_enviado"), \
             patch.object(relatorio.requests, "post", return_value=resposta) as postar:
            self.assertTrue(relatorio.enviar_se_devido(datetime(2026, 8, 17, 9)))
            consultar.assert_not_called()
            self.assertIn("Dados de conversão indisponíveis hoje.",
                          postar.call_args.kwargs["json"]["text"])

    def test_falha_da_shopee_nao_remove_conversoes_aliexpress(self):
        resposta = type("Resposta", (), {"json": lambda self: {"ok": True}})()
        ali = {"pagos": 1, "confirmados": 0, "invalidos": 0,
               "por_tracking": {"telegram": 1}, "comissoes": {"USD": 2}}
        with patch.object(relatorio.config, "TELEGRAM_ADMIN_ID", "123"), \
             patch.object(relatorio.config, "TELEGRAM_BOT_TOKEN", "token"), \
             patch.object(relatorio.config, "RELATORIO_HORA", 8), \
             patch.object(relatorio.aliexpress, "esta_configurada", return_value=True), \
             patch.object(relatorio.aliexpress, "resumo_conversoes", return_value=ali), \
             patch.object(relatorio.shopee, "esta_configurada", return_value=True), \
             patch.object(relatorio.shopee, "resumo_conversoes",
                          side_effect=RuntimeError("fora do ar")), \
             patch.object(relatorio.store, "relatorio_enviado", return_value=False), \
             patch.object(relatorio.store, "resumo_periodo", return_value=[]), \
             patch.object(relatorio.store, "marcar_relatorio_enviado"), \
             patch.object(relatorio.requests, "post", return_value=resposta) as postar:
            self.assertTrue(relatorio.enviar_se_devido(datetime(2026, 8, 17, 9)))

        texto = postar.call_args.kwargs["json"]["text"]
        self.assertIn("🛒 AliExpress", texto)
        self.assertIn("✅ 0 confirmados · ⏳ 1 pagos", texto)

    def test_nao_consulta_shopee_quando_a_loja_esta_desconfigurada(self):
        resposta = type("Resposta", (), {"json": lambda self: {"ok": True}})()
        with patch.object(relatorio.config, "TELEGRAM_ADMIN_ID", "123"), \
             patch.object(relatorio.config, "TELEGRAM_BOT_TOKEN", "token"), \
             patch.object(relatorio.config, "RELATORIO_HORA", 8), \
             patch.object(relatorio.aliexpress, "esta_configurada", return_value=False), \
             patch.object(relatorio.shopee, "esta_configurada", return_value=False), \
             patch.object(relatorio.shopee, "resumo_conversoes") as consultar, \
             patch.object(relatorio.store, "relatorio_enviado", return_value=False), \
             patch.object(relatorio.store, "resumo_periodo", return_value=[]), \
             patch.object(relatorio.store, "marcar_relatorio_enviado"), \
             patch.object(relatorio.requests, "post", return_value=resposta):
            self.assertTrue(relatorio.enviar_se_devido(datetime(2026, 8, 17, 9)))
        consultar.assert_not_called()

    def test_envio_forcado_ignora_horario_e_marcacao_anterior(self):
        resposta = type("Resposta", (), {"json": lambda self: {"ok": True}})()
        with patch.object(relatorio.config, "TELEGRAM_ADMIN_ID", "123"), \
             patch.object(relatorio.config, "TELEGRAM_BOT_TOKEN", "token"), \
             patch.object(relatorio.config, "RELATORIO_HORA", 8), \
             patch.object(relatorio.aliexpress, "esta_configurada", return_value=False), \
             patch.object(relatorio.shopee, "esta_configurada", return_value=False), \
             patch.object(relatorio.store, "relatorio_enviado", return_value=True), \
             patch.object(relatorio.store, "resumo_periodo", return_value=[]), \
             patch.object(relatorio.store, "marcar_relatorio_enviado") as marcar, \
             patch.object(relatorio.requests, "post", return_value=resposta):
            self.assertTrue(relatorio.enviar_se_devido(
                datetime(2026, 8, 17, 6), forcar=True
            ))

        marcar.assert_called_once_with("2026-08-16")


if __name__ == "__main__":
    unittest.main()
