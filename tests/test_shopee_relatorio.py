import unittest
from datetime import datetime
from decimal import Decimal
from unittest.mock import patch

import shopee


class ShopeeRelatorioTest(unittest.TestCase):
    def setUp(self):
        self.inicio = datetime(2026, 8, 14, 9)
        self.fim = datetime(2026, 8, 21, 9)

    def test_preserva_marca_de_campeao_quando_item_aparece_nas_duas_listas(self):
        produto = {"shopId": 1, "itemId": 2, "productName": "Panela",
                   "productLink": "https://shopee.test/item", "commissionRate": "0.1"}
        with patch.object(shopee.config, "SHOPEE_LIST_TYPES", [0, 2]), \
             patch.object(shopee.config, "SHOPEE_PAGES", 1), \
             patch.object(shopee, "_buscar_pagina", side_effect=[[dict(produto)], [dict(produto)]]):
            ofertas = shopee.buscar_ofertas()
        self.assertEqual(1, len(ofertas))
        self.assertTrue(ofertas[0]["_shopee_campeao"])

    def test_preserva_primeira_pagina_quando_segunda_falha(self):
        produto = {"shopId": 1, "itemId": 2, "productName": "Panela"}
        with patch.object(shopee.config, "SHOPEE_LIST_TYPES", [0]), \
             patch.object(shopee.config, "SHOPEE_PAGES", 3), \
             patch.object(shopee, "_buscar_pagina", side_effect=[[produto], RuntimeError("falha")]):
            ofertas = shopee.buscar_ofertas()
        self.assertEqual(["shopee_1_2"], [item["oferta_id"] for item in ofertas])

    def test_falha_total_da_busca_nao_parece_lista_vazia(self):
        with patch.object(shopee.config, "SHOPEE_LIST_TYPES", [0]), \
             patch.object(shopee.config, "SHOPEE_PAGES", 1), \
             patch.object(shopee, "_buscar_pagina", side_effect=RuntimeError("falha")):
            with self.assertRaisesRegex(RuntimeError, "nenhuma página válida"):
                shopee.buscar_ofertas()

    def test_termo_rotativo_usa_mesma_quantidade_de_paginas(self):
        with patch.object(shopee.config, "SHOPEE_LIST_TYPES", [0]), \
             patch.object(shopee.config, "SHOPEE_PAGES", 3), \
             patch.object(shopee.config, "SHOPEE_KEYWORDS", ("celular", "fone")), \
             patch.object(shopee.captacao, "termo_da_rodada", return_value="fone"), \
             patch.object(shopee, "_buscar_pagina", return_value=[]) as buscar:
            self.assertEqual([], shopee.buscar_ofertas())
        buscar.assert_called_once_with(1, 0, "fone")

    def test_resultado_vazio(self):
        resposta = {
            "conversionReport": {
                "nodes": [],
                "pageInfo": {"hasNextPage": False, "scrollId": ""},
            }
        }
        with patch.object(shopee, "_executar", return_value=resposta):
            self.assertEqual(shopee.resumo_conversoes(self.inicio, self.fim), {
                "pendentes": 0,
                "concluidas": 0,
                "canceladas": 0,
                "outros": 0,
                "por_tracking": {},
                "comissao_por_tracking": {},
                "comissao_estimada": Decimal("0.00"),
                "comissao_liquida": Decimal("0.00"),
                "por_hora": {},
                "por_categoria": {},
                "por_faixa_preco": {},
                "por_faixa_desconto": {},
                "produtos": [],
            })

    def test_agrega_status_comissao_e_canal_sem_ids(self):
        resposta = {
            "conversionReport": {
                "nodes": [
                    {"conversionStatus": "PENDING",
                     "purchaseTime": 1787302800,
                     "estimatedTotalCommission": "4.501",
                     "netCommission": "0",
                     "utmContent": "telegram-ate50-descAte69--",
                     "orders": [{"items": [{
                         "shopId": 10, "itemId": 20, "itemName": "Panela",
                         "itemPrice": "49.90", "qty": 2,
                         "itemCommission": "0", "itemTotalCommission": "4.50",
                         "categoryLv1Name": "Casa e Cozinha",
                     }]}]},
                    {"conversionStatus": "COMPLETED",
                     "purchaseTime": 1787306400,
                     "estimatedTotalCommission": "8.00",
                     "netCommission": "7,25",
                     "utmContent": "bsky-acima150-desc70mais--",
                     "orders": [{"items": [{
                         "shopId": 11, "itemId": 21, "itemName": "Furadeira",
                         "itemPrice": "199.90", "qty": 1,
                         "itemCommission": "7.25", "itemTotalCommission": "8",
                         "categoryLv1Name": "Ferramentas",
                     }]}]},
                    {"conversionStatus": "CANCELLED",
                     "estimatedTotalCommission": "99.00",
                     "netCommission": "99.00",
                     "utmContent": "telegram"},
                    {"conversionStatus": "NOVO",
                     "estimatedTotalCommission": "invalido",
                     "netCommission": None,
                     "utmContent": "----"},
                ],
                "pageInfo": {"hasNextPage": False, "scrollId": ""},
            }
        }
        with patch.object(shopee, "_executar", return_value=resposta):
            resumo = shopee.resumo_conversoes(self.inicio, self.fim)

        self.assertEqual(resumo, {
            "pendentes": 1,
            "concluidas": 1,
            "canceladas": 1,
            "outros": 1,
            "por_tracking": {"telegram": 1, "bsky": 1},
            "comissao_por_tracking": {
                "telegram": Decimal("4.50"), "bsky": Decimal("7.25")},
            "comissao_estimada": Decimal("4.50"),
            "comissao_liquida": Decimal("7.25"),
            "por_hora": {"06h": 1, "07h": 1},
            "por_categoria": {"Casa e Cozinha": 2, "Ferramentas": 1},
            "por_faixa_preco": {"ate R$ 50": 2, "acima de R$ 150": 1},
            "por_faixa_desconto": {"ate 69%": 1, "70% ou mais": 1},
            "produtos": [
                {"oferta_id": "shopee_10_20", "nome": "Panela",
                 "categoria": "Casa e Cozinha", "quantidade": 2,
                 "conversoes": 1, "comissao": Decimal("4.50")},
                {"oferta_id": "shopee_11_21", "nome": "Furadeira",
                 "categoria": "Ferramentas", "quantidade": 1,
                 "conversoes": 1, "comissao": Decimal("7.25")},
            ],
        })
        self.assertNotIn("orderId", repr(resumo))

    def test_percorre_paginas_com_scroll_id_escapado(self):
        paginas = [
            {"conversionReport": {
                "nodes": [{"conversionStatus": "PENDING",
                           "estimatedTotalCommission": "1",
                           "netCommission": "0", "utmContent": "telegram"}],
                "pageInfo": {"hasNextPage": True, "scrollId": 'proxima"pagina'},
            }},
            {"conversionReport": {
                "nodes": [{"conversionStatus": "COMPLETED",
                           "estimatedTotalCommission": "0",
                           "netCommission": "2", "utmContent": "bsky"}],
                "pageInfo": {"hasNextPage": False, "scrollId": ""},
            }},
        ]
        with patch.object(shopee, "_executar", side_effect=paginas) as executar:
            resumo = shopee.resumo_conversoes(self.inicio, self.fim)

        self.assertEqual(resumo["pendentes"], 1)
        self.assertEqual(resumo["concluidas"], 1)
        self.assertEqual(executar.call_count, 2)
        self.assertIn('scrollId: "proxima\\"pagina"', executar.call_args_list[1].args[0])
        self.assertNotIn("orderId", executar.call_args_list[0].args[0])

    def test_rejeita_paginacao_sem_proximo_cursor(self):
        resposta = {"conversionReport": {
            "nodes": [],
            "pageInfo": {"hasNextPage": True, "scrollId": ""},
        }}
        with patch.object(shopee, "_executar", return_value=resposta):
            with self.assertRaisesRegex(RuntimeError, "paginacao invalida"):
                shopee.resumo_conversoes(self.inicio, self.fim)


if __name__ == "__main__":
    unittest.main()
