import json
import time
import unittest
from unittest.mock import patch

import shopee


class ShopeeSegurancaTest(unittest.TestCase):
    def test_busca_somente_campanhas_ativas_relacionadas_a_cupom(self):
        agora = int(time.time())
        nodes = [
            {"offerName": "Cupom de R$ 20 no app", "offerType": 1,
             "originalLink": "https://shopee.com.br/m/cupom",
             "periodStartTime": agora - 60, "periodEndTime": agora + 3600},
            {"offerName": "Festival de moda", "offerType": 1,
             "originalLink": "https://shopee.com.br/m/moda",
             "periodStartTime": agora - 60, "periodEndTime": agora + 3600},
            {"offerName": "Voucher expirado", "offerType": 1,
             "originalLink": "https://shopee.com.br/m/antigo",
             "periodEndTime": agora - 1},
        ]
        with patch.object(shopee.config, "SHOPEE_CAMPANHAS_CUPOM", True), \
             patch.object(shopee, "_executar", return_value={
                 "shopeeOfferV2": {"nodes": nodes}
             }):
            cupons = shopee.buscar_cupons()
        self.assertEqual(1, len(cupons))
        self.assertEqual("voucher", cupons[0]["tipo"])
        self.assertEqual("", cupons[0]["codigo"])
        self.assertIn("Cupom de R$ 20", cupons[0]["titulo"])

    def test_busca_de_campanhas_pode_ser_desligada(self):
        with patch.object(shopee.config, "SHOPEE_CAMPANHAS_CUPOM", False), \
             patch.object(shopee, "_executar") as executar:
            self.assertEqual([], shopee.buscar_cupons())
        executar.assert_not_called()

    def test_busca_respeita_limite_maximo_do_endpoint_de_campanhas(self):
        with patch.object(shopee.config, "SHOPEE_CAMPANHAS_CUPOM", True), \
             patch.object(shopee, "_executar", return_value={}) as executar:
            shopee.buscar_cupons()
        self.assertIn("shopeeOfferV2(limit: 50", executar.call_args.args[0])
        self.assertNotIn("limit: 100", executar.call_args.args[0])

    def test_keyword_e_codificada_como_string_graphql(self):
        keyword = 'fone" } mutation { apagarTudo } #'
        with patch.object(shopee.config, "SHOPEE_KEYWORD", keyword), \
             patch.object(shopee, "_executar", return_value={}) as executar:
            shopee._buscar_pagina(1, 0)
        query = executar.call_args.args[0]
        self.assertIn(
            f"keyword: {json.dumps(keyword, ensure_ascii=False)}",
            query,
        )

    def test_url_do_produto_e_codificada_como_string_graphql(self):
        url = 'https://produto.test/item?x="}) { ataque }'
        with patch.object(
            shopee,
            "_executar",
            return_value={"generateShortLink": {"shortLink": "https://s.test/x"}},
        ) as executar:
            shopee.gerar_link(url)
        query = executar.call_args.args[0]
        self.assertIn(
            f"originUrl: {json.dumps(url, ensure_ascii=False)}",
            query,
        )

    def test_consulta_produto_exato_para_atualizar_catalogo(self):
        node = {"shopId": 12, "itemId": 34, "productName": "Panela",
                "price": 79.9, "imageUrl": "https://img.test/panela.jpg",
                "productLink": "https://shopee.com.br/produto"}
        with patch.object(shopee, "_executar", return_value={
                "productOfferV2": {"nodes": [node]}}) as executar:
            produtos = shopee.consultar_produtos(
                ["shopee_12_34", "texto_invalido"]
            )
        self.assertEqual(["shopee_12_34"], list(produtos))
        query = executar.call_args.args[0]
        self.assertIn("shopId: 12", query)
        self.assertIn("itemId: 34", query)


if __name__ == "__main__":
    unittest.main()
