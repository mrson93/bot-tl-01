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
        self.assertIsNone(oferta["ratingStar"])
        self.assertEqual(96, oferta["positiveFeedbackPercent"])

    def test_nao_alega_preco_app_quando_valores_sao_iguais(self):
        produto = {"product_id": 10, "product_title": "Produto",
                   "target_sale_price": "80", "target_app_sale_price": "80"}
        with patch.object(aliexpress.config, "ALIEXPRESS_PAGES", 1), \
             patch.object(aliexpress, "_buscar_pagina", return_value=[produto]):
            oferta = aliexpress.buscar_ofertas()[0]
        self.assertEqual(80, oferta["price"])
        self.assertFalse(oferta["precoNoApp"])
        self.assertIsNone(oferta["cupom"])

    def test_preserva_primeira_pagina_quando_segunda_falha(self):
        produto = {"product_id": 10, "product_title": "Fone", "target_sale_price": "80"}
        with patch.object(aliexpress.config, "ALIEXPRESS_PAGES", 3), \
             patch.object(aliexpress, "_buscar_pagina", side_effect=[[produto], RuntimeError("falha")]):
            ofertas = aliexpress.buscar_ofertas()
        self.assertEqual(["aliexpress_10"], [item["oferta_id"] for item in ofertas])

    def test_falha_na_primeira_pagina_continua_visivel(self):
        with patch.object(aliexpress.config, "ALIEXPRESS_PAGES", 1), \
             patch.object(aliexpress, "_buscar_pagina", side_effect=RuntimeError("falha")):
            with self.assertRaisesRegex(RuntimeError, "falha"):
                aliexpress.buscar_ofertas()

    def test_termo_rotativo_usa_mesma_quantidade_de_paginas(self):
        with patch.object(aliexpress.config, "ALIEXPRESS_PAGES", 3), \
             patch.object(aliexpress.config, "ALIEXPRESS_KEYWORDS", ("celular", "fone")), \
             patch.object(aliexpress.captacao, "termo_da_rodada", return_value="fone"), \
             patch.object(aliexpress, "_buscar_pagina", return_value=[]) as buscar:
            self.assertEqual([], aliexpress.buscar_ofertas())
        buscar.assert_called_once_with(1, "fone")

    def test_atualiza_varios_produtos_em_uma_consulta_de_detalhe(self):
        resposta = {"resp_result": {"result": {"products": {"product": [{
            "product_id": 10, "product_title": "Fone atualizado",
            "target_sale_price": "75", "target_original_price": "100",
            "discount": "25%", "product_main_image_url": "https://img.test/10.jpg",
            "product_detail_url": "https://aliexpress.com/item/10.html",
        }]}}}}
        with patch.object(aliexpress, "_chamar", return_value=resposta) as chamar:
            produtos = aliexpress.consultar_produtos(
                ["aliexpress_10", "aliexpress_20", "id_invalido"]
            )
        self.assertEqual(["aliexpress_10"], list(produtos))
        self.assertEqual(75, produtos["aliexpress_10"]["price"])
        self.assertEqual("10,20", chamar.call_args.args[1]["product_ids"])
        self.assertEqual("aliexpress.affiliate.productdetail.get",
                         chamar.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
