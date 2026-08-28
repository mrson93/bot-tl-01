import sqlite3
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import store


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "postadas.db"
        self.db_patch = patch.object(store, "_DB", self.db)
        self.db_patch.start()

    def tearDown(self):
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_migra_banco_antigo_sem_apagar_historico(self):
        con = sqlite3.connect(self.db)
        con.execute("CREATE TABLE postadas (id TEXT PRIMARY KEY, postada_em INTEGER)")
        con.execute("INSERT INTO postadas VALUES ('antiga', 123)")
        con.commit()
        con.close()

        self.assertTrue(store.ja_postada("antiga"))
        con = sqlite3.connect(self.db)
        colunas = {linha[1] for linha in con.execute("PRAGMA table_info(postadas)")}
        con.close()
        self.assertTrue({"preco", "desconto", "fonte", "titulo", "categoria"}
                        .issubset(colunas))

    def test_queda_de_15_por_cento_libera_apenas_em_outro_dia(self):
        ontem = int(datetime.now().timestamp()) - 86400
        store.marcar_postada("produto", preco=100, desconto=30, fonte="Shopee", agora=ontem)
        self.assertEqual("queda_preco", store.avaliar_elegibilidade("produto", 85, 7, 15))
        store.marcar_postada("hoje", preco=100, desconto=30, fonte="Shopee")
        self.assertIsNone(store.avaliar_elegibilidade("hoje", 80, 7, 15))

    def test_entregas_sao_independentes_por_canal(self):
        store.registrar_entrega("x", "Telegram", True, 50, "Shopee")
        store.registrar_entrega("x", "Bluesky", False, 50, "Shopee", "timeout")
        self.assertFalse(store.canal_pendente("x", "Telegram", 50))
        self.assertTrue(store.canal_pendente("x", "Bluesky", 50))

    def test_conta_falhas_consecutivas_ate_o_ultimo_sucesso(self):
        store.registrar_entrega("a", "Telegram", True, agora=100)
        store.registrar_entrega("b", "Telegram", False, agora=110)
        store.registrar_entrega("c", "Telegram", False, agora=120)
        self.assertEqual(2, store.falhas_consecutivas("Telegram"))

    def test_proximo_horario_fica_persistido(self):
        store.definir_proximo_post(1_800_000_000)
        self.assertEqual(1_800_000_000, store.proximo_post())

    def test_bom_dia_fica_registrado_por_data(self):
        self.assertFalse(store.bom_dia_enviado("2026-08-19", "Telegram"))
        store.marcar_bom_dia_enviado("2026-08-19", "Telegram")
        self.assertTrue(store.bom_dia_enviado("2026-08-19", "Telegram"))
        self.assertFalse(store.bom_dia_enviado("2026-08-19", "Bluesky"))
        self.assertFalse(store.bom_dia_enviado("2026-08-20", "Telegram"))

    def test_cupom_ativo_e_entrega_sao_independentes_por_canal(self):
        cupom = {"id": "cupom_x", "fonte": "AliExpress", "codigo": "APP20",
                 "condicao": "R$ 20 off", "destino": "https://oferta.test",
                 "expira_em": 2_000_000_000}
        store.salvar_cupom(cupom, agora=100)
        self.assertEqual("APP20", store.cupons_ativos(5, agora=101)[0]["codigo"])
        self.assertTrue(store.cupom_pendente("cupom_x", "Telegram"))
        store.registrar_entrega_cupom("cupom_x", "Telegram", True, agora=101)
        self.assertFalse(store.cupom_pendente("cupom_x", "Telegram"))
        self.assertTrue(store.cupom_pendente("cupom_x", "Bluesky"))

    def test_desempenho_agregado_aumenta_pontuacao_sem_expor_pedido(self):
        agora = int(datetime.now().timestamp())
        store.registrar_entrega("post", "Telegram", True, 50, "Shopee", agora=agora)
        store.salvar_desempenho("Shopee", [{
            "oferta_id": "shopee_1_2", "categoria": "cozinha",
            "conversoes": 2, "quantidade": 3, "comissao": 8.5,
        }], agora=agora)
        fator = store.multiplicador_desempenho({
            "fonte": "Shopee", "oferta_id": "shopee_1_2", "categoria": "cozinha"
        })
        self.assertGreater(fator, 1)
        con = sqlite3.connect(self.db)
        colunas = {linha[1] for linha in con.execute("PRAGMA table_info(desempenho)")}
        con.close()
        self.assertNotIn("order_id", colunas)
        self.assertNotIn("buyer", colunas)

    def test_multiplicadores_em_lote_preservam_bonus_e_ignoram_id_vazio(self):
        agora = int(datetime.now().timestamp())
        store.salvar_desempenho("Shopee", [
            {"oferta_id": "", "categoria": "outros", "conversoes": 99},
            {"oferta_id": "produto", "categoria": "cozinha", "conversoes": 2},
        ], agora=agora)
        fatores = store.multiplicadores_desempenho([
            {"fonte": "Shopee", "oferta_id": "produto", "categoria": "cozinha"},
            {"fonte": "Shopee", "oferta_id": "novo", "categoria": "outros"},
        ])
        self.assertGreater(fatores[("Shopee", "produto")], 1)
        self.assertGreaterEqual(fatores[("Shopee", "novo")], 1)
        self.assertLessEqual(fatores[("Shopee", "novo")], 1.5)
        con = sqlite3.connect(self.db)
        self.assertEqual(0, con.execute(
            "SELECT COUNT(*) FROM desempenho WHERE oferta_id=''"
        ).fetchone()[0])
        con.close()

    def test_metadados_e_ofertas_sem_conversao(self):
        store.marcar_postada("a", 40, 30, "Shopee", agora=100,
                             titulo="Panela", categoria="cozinha")
        store.marcar_postada("b", 80, 50, "AliExpress", agora=110,
                             titulo="Fone", categoria="eletronicos")
        self.assertEqual("Panela", store.metadados_ofertas(["a"])["a"]["titulo"])
        self.assertEqual([("b", "AliExpress", "Fone")],
                         store.ofertas_sem_conversao(90, {"a"}))

    def test_series_diarias_e_experimentos_ficam_agregados(self):
        store.marcar_postada("a", 40, 30, "Shopee", agora=100,
                             titulo="Panela", categoria="cozinha",
                             experimento="chamada", variante="A")
        resumo = {
            "pendentes": 1, "concluidas": 0, "canceladas": 0,
            "comissao_estimada": 5, "comissao_liquida": 0,
            "por_tracking": {"telegram": 1},
            "comissao_por_tracking": {"telegram": 5},
            "por_categoria": {"cozinha": 1},
            "produtos": [{"oferta_id": "a", "conversoes": 1,
                           "quantidade": 1, "comissao": 5}],
        }
        store.salvar_metricas_diarias("2026-08-21", "Shopee", resumo,
                                      {"telegram": 1}, posts_total=1, agora=200)
        store.salvar_experimentos_diarios("2026-08-21", "Shopee",
                                          resumo["produtos"], 90, 150, agora=200)
        tendencias = store.tendencias_diarias(datetime(2026, 8, 22).date())
        testes = store.resumo_experimentos(datetime(2026, 8, 22).date())
        self.assertEqual(1, tendencias["Shopee"]["atual"]["conversoes"])
        self.assertEqual("A", testes[0]["variante"])
        self.assertEqual(1, testes[0]["conversoes"])


if __name__ == "__main__":
    unittest.main()
