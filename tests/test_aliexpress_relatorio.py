import unittest
from datetime import datetime
from unittest.mock import patch

import aliexpress


def resposta(pedidos, paginas=1):
    return {
        "aliexpress_affiliate_order_list_response": {
            "resp_result": {
                "resp_code": 200,
                "resp_msg": "success",
                "result": {
                    "current_page_no": 1,
                    "total_page_no": paginas,
                    "orders": {"order": pedidos},
                },
            }
        }
    }


class AliExpressRelatorioTest(unittest.TestCase):
    def setUp(self):
        self.inicio = datetime(2026, 8, 14)
        self.fim = datetime(2026, 8, 21)

    def test_resultado_vazio_vira_totais_zerados(self):
        vazio = {
            "aliexpress_affiliate_order_list_response": {
                "resp_result": {"resp_code": 405, "resp_msg": "The result is empty"}
            }
        }
        with patch.object(aliexpress, "_chamar", return_value=vazio):
            self.assertEqual(aliexpress.resumo_conversoes(self.inicio, self.fim), {
                "pagos": 0,
                "confirmados": 0,
                "invalidos": 0,
                "por_tracking": {},
                "comissoes": {},
                "comissoes_por_tracking": {},
                "por_hora": {},
                "por_categoria": {},
                "por_faixa_preco": {},
                "por_faixa_desconto": {},
                "produtos": [],
            })

    def test_agrega_status_tracking_e_comissao_sem_contar_cancelado(self):
        pagos = resposta([
            {"tracking_id": "telegram", "estimated_paid_commission": "1.50",
             "settled_currency": "USD", "product_id": 10,
             "product_title": "Fone Bluetooth", "product_count": 2,
             "created_time": "2026-08-20 19:30:00"},
            {"tracking_id": "telegram", "estimated_paid_commission": "99.00",
             "settled_currency": "USD", "effect_detail_status": "FullRefund"},
            {"tracking_id": "bsky", "estimated_paid_commission": 2,
             "settled_currency": "USD", "product_id": 11,
             "product_title": "Panela antiaderente", "product_count": 1,
             "created_time": "2026-08-20 12:10:00"},
        ])
        confirmados = resposta([
            {"tracking_id": "telegram", "estimated_finished_commission": "3,25",
             "settled_currency": "USD", "product_id": 10,
             "product_title": "Fone Bluetooth", "product_count": 1,
             "created_time": "2026-08-20 19:50:00"},
        ])

        def chamar(_, parametros):
            return pagos if parametros["status"] == "Payment Completed" else confirmados

        with patch.object(aliexpress, "_chamar", side_effect=chamar):
            self.assertEqual(aliexpress.resumo_conversoes(self.inicio, self.fim), {
                "pagos": 2,
                "confirmados": 1,
                "invalidos": 1,
                "por_tracking": {"telegram": 2, "bsky": 1},
                "comissoes": {"USD": 6.75},
                "comissoes_por_tracking": {
                    "telegram": {"USD": 4.75}, "bsky": {"USD": 2.0}},
                "por_hora": {"19h": 2, "12h": 1},
                "por_categoria": {"eletronicos": 3, "cozinha": 1},
                "por_faixa_preco": {},
                "por_faixa_desconto": {},
                "produtos": [
                    {"oferta_id": "aliexpress_10", "nome": "Fone Bluetooth",
                     "categoria": "eletronicos", "quantidade": 3,
                     "conversoes": 2, "comissoes": {"USD": 4.75}},
                    {"oferta_id": "aliexpress_11", "nome": "Panela antiaderente",
                     "categoria": "cozinha", "quantidade": 1,
                     "conversoes": 1, "comissoes": {"USD": 2.0}},
                ],
            })

    def test_erro_real_da_api_nao_e_tratado_como_zero(self):
        erro = {"error_response": {"code": 50, "msg": "Remote service error"}}
        with patch.object(aliexpress, "_chamar", return_value=erro):
            with self.assertRaisesRegex(RuntimeError, "consulta de pedidos"):
                aliexpress.resumo_conversoes(self.inicio, self.fim)


if __name__ == "__main__":
    unittest.main()
