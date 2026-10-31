import json
import os
import unittest
from unittest.mock import Mock, patch

import idempotencia


class IdempotenciaTest(unittest.TestCase):
    def _sessao(self, valor=None):
        sessao = Mock()
        resposta = Mock(status_code=200)
        resposta.json.return_value = {"body": json.dumps(valor or {
            "v": 1, "ofertas": {}, "bom_dia": {},
        })}
        resposta.raise_for_status.return_value = None
        sessao.get.return_value = resposta
        sessao.patch.return_value = Mock(status_code=204)
        sessao.patch.return_value.raise_for_status.return_value = None
        return sessao

    def _ambiente(self):
        return patch.dict(os.environ, {
            "GITHUB_REPOSITORY": "dono/repo", "GH_TOKEN": "segredo",
            "IDEMPOTENCIA_REMOTA_ATIVA": "true",
            "BOT_JOURNAL_ISSUE": "1",
        }, clear=False)

    def test_reserva_antes_da_publicacao_e_recusa_repeticao(self):
        inicial = {"v": 1, "ofertas": {}, "bom_dia": {}}
        sessao = self._sessao(inicial)
        with self._ambiente(), patch.object(idempotencia.time, "time", return_value=123):
            self.assertTrue(idempotencia.reservar_oferta(
                "produto", "Telegram", 49.9, "Shopee", sessao
            ))
        salvo = json.loads(sessao.patch.call_args.kwargs["json"]["body"])
        sessao = self._sessao(salvo)
        with self._ambiente():
            self.assertFalse(idempotencia.reservar_oferta(
                "produto", "Telegram", 49.9, "Shopee", sessao
            ))
        sessao.patch.assert_not_called()

    def test_sincroniza_reservas_no_sqlite_local(self):
        diario = {"v": 1, "ofertas": {"x": {
            "i": "produto", "f": "Amazon", "p": 100, "t": 123,
            "c": ["Telegram", "X"],
        }}, "bom_dia": {"2026-09-21": ["Telegram"]}}
        sessao = self._sessao(diario)
        with self._ambiente(), \
             patch.object(idempotencia.store, "registrar_entrega") as entrega, \
             patch.object(idempotencia.store, "marcar_postada") as postada, \
             patch.object(idempotencia.store, "marcar_bom_dia_enviado") as bom_dia:
            self.assertEqual(2, idempotencia.sincronizar(sessao))
        self.assertEqual(2, entrega.call_count)
        postada.assert_called_once_with(
            "produto", preco=100.0, fonte="Amazon", agora=123,
            titulo=None, categoria=None, loja=None,
        )
        bom_dia.assert_called_once_with("2026-09-21", "Telegram")

    def test_completar_canal_depois_nao_traz_a_oferta_para_o_turno_atual(self):
        inicial = {"v": 1, "ofertas": {}, "bom_dia": {}}
        sessao = self._sessao(inicial)
        with self._ambiente(), patch.object(idempotencia.time, "time", return_value=100):
            idempotencia.reservar_oferta("produto", "Telegram", 50, "Shopee", sessao)
        salvo = json.loads(sessao.patch.call_args.kwargs["json"]["body"])
        sessao = self._sessao(salvo)
        with self._ambiente(), patch.object(idempotencia.time, "time", return_value=9000):
            idempotencia.reservar_oferta("produto", "X", 50, "Shopee", sessao)
        salvo = json.loads(sessao.patch.call_args.kwargs["json"]["body"])
        item = next(iter(salvo["ofertas"].values()))
        self.assertEqual((9000, 100), (item["t"], item["o"]))
        with self._ambiente(), \
             patch.object(idempotencia.store, "registrar_entrega"), \
             patch.object(idempotencia.store, "marcar_postada") as postada:
            idempotencia.sincronizar(self._sessao(salvo))
        self.assertEqual(100, postada.call_args.kwargs["agora"])

    def test_diario_preserva_metadados_para_variedade_entre_execucoes(self):
        inicial = {"v": 1, "ofertas": {}, "bom_dia": {}}
        sessao = self._sessao(inicial)
        oferta = {"productName": "Creatina monohidratada 1kg",
                  "categoria": "esporte", "shopName": "Loja Fitness"}
        with self._ambiente(), patch.object(idempotencia.time, "time", return_value=123):
            self.assertTrue(idempotencia.reservar_oferta(
                "produto", "Telegram", 49.9, "Shopee", sessao, oferta=oferta
            ))
        salvo = json.loads(sessao.patch.call_args.kwargs["json"]["body"])
        item = next(iter(salvo["ofertas"].values()))
        self.assertEqual("Creatina monohidratada 1kg", item["n"])
        self.assertEqual("esporte", item["g"])
        self.assertEqual("Loja Fitness", item["l"])

    def test_compacta_por_tamanho_e_preserva_reserva_mais_recente(self):
        ofertas = {
            str(indice): {"i": f"produto-{indice}", "f": "Shopee", "p": 10,
                          "t": indice, "c": ["Telegram", "Bluesky", "Site"],
                          "n": "Produto com nome grande " * 8,
                          "g": "eletronicos", "l": "Loja com nome grande"}
            for indice in range(180)
        }
        sessao = self._sessao({"v": 1, "ofertas": ofertas, "bom_dia": {}})
        with self._ambiente(), patch.object(idempotencia.time, "time", return_value=999):
            self.assertTrue(idempotencia.reservar_oferta(
                "produto-novo", "Telegram", 49.9, "Shopee", sessao,
                oferta={"productName": "Novo"}
            ))
        corpo = sessao.patch.call_args.kwargs["json"]["body"]
        salvo = json.loads(corpo)
        self.assertLessEqual(len(corpo.encode("utf-8")), idempotencia.MAX_BYTES)
        self.assertIn(idempotencia._chave("produto-novo", "Shopee"),
                      salvo["ofertas"])
        self.assertLess(len(salvo["ofertas"]), len(ofertas))

    def test_falha_do_diario_tem_tipo_sistemico(self):
        sessao = self._sessao()
        sessao.get.side_effect = RuntimeError("fora")
        with self._ambiente():
            with self.assertRaisesRegex(idempotencia.DiarioRemotoIndisponivel,
                                        "fora"):
                idempotencia.reservar_oferta(
                    "produto", "Telegram", 49.9, "Shopee", sessao
                )

    def test_actions_falha_fechado_sem_credenciais(self):
        with patch.dict(os.environ, {"IDEMPOTENCIA_REMOTA_ATIVA": "true",
                                     "GITHUB_REPOSITORY": "", "GH_TOKEN": ""}):
            with self.assertRaisesRegex(RuntimeError, "sem credenciais"):
                idempotencia.reservar_bom_dia("2026-09-21", "Telegram")


if __name__ == "__main__":
    unittest.main()
