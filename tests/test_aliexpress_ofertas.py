import unittest
from unittest.mock import patch

import aliexpress


class AliExpressOfertasTest(unittest.TestCase):
    def test_usa_cupom_e_preco_app_somente_quando_oficiais(self):
        produto = {
            "product_id": 10,
            "product_title": "Fone Bluetooth",
            "target_sale_price": "100",
            "target_app_sale_price": "80",
            "target_original_price": "120",
            "discount": "33%",
            "evaluate_rate": "96%",
            "lastest_volume": 500,
            "commission_rate": "10%",
            "first_level_category_name": "Eletronicos",
            "promo_code_info": {"promo_code": "APP20",
                                "code_value": "20 de desconto"},
            "product_detail_url": "https://aliexpress.com/item/10.html",
        }
        with patch.object(aliexpress.config, "ALIEXPRESS_PAGES", 1), \
             patch.object(aliexpress, "_buscar_pagina", return_value=[produto]):
            oferta = aliexpress.buscar_ofertas()[0]

        self.assertEqual(80, oferta["price"])
        self.assertTrue(oferta["precoNoApp"])
        self.assertEqual("APP20", oferta["cupom"])
        self.assertEqual("20 de desconto", oferta["cupomCondicao"])
        self.assertFalse(oferta["cupomResgate"])
        self.assertEqual("Eletronicos", oferta["categoria"])

    def test_nao_alega_preco_app_quando_valores_sao_iguais(self):
        produto = {"product_id": 10, "product_title": "Produto",
                   "target_sale_price": "80", "target_app_sale_price": "80"}
        with patch.object(aliexpress.config, "ALIEXPRESS_PAGES", 1), \
             patch.object(aliexpress, "_buscar_pagina", return_value=[produto]):
            oferta = aliexpress.buscar_ofertas()[0]
        self.assertEqual(80, oferta["price"])
        self.assertFalse(oferta["precoNoApp"])
        self.assertIsNone(oferta["cupom"])


if __name__ == "__main__":
    unittest.main()
