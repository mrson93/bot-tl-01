import unittest
from unittest.mock import patch

import site_publisher


class SitePublisherTest(unittest.TestCase):
    def test_envia_link_afiliado_e_dados_publicos(self):
        class Fonte:
            NOME = "Shopee"

            @staticmethod
            def gerar_link(url, tracking, etiquetas):
                return "https://s.shopee.com.br/afiliado"

        resposta = type("Resposta", (), {"status_code": 201})()
        oferta = {
            "oferta_id": "shopee_1_2", "productName": "Panela",
            "productUrl": "https://shopee.com.br/item", "price": 79.9,
            "priceDiscountRate": 40, "ratingStar": 4.8, "sales": 500,
            "imageUrl": "https://cf.shopee.com.br/image.jpg", "categoria": "cozinha",
        }
        with patch.object(site_publisher.config, "SITE_API_URL",
                          "https://canaltabarato.pages.dev/api/publish"), \
             patch.object(site_publisher.config, "SITE_API_TOKEN", "segredo"), \
             patch.object(site_publisher.config, "SITE_TRACKING_ID", "site"), \
             patch.object(site_publisher.requests, "post", return_value=resposta) as post:
            site_publisher.publicar(Fonte, oferta)
        self.assertEqual("Bearer segredo", post.call_args.kwargs["headers"]["Authorization"])
        self.assertEqual("https://s.shopee.com.br/afiliado",
                         post.call_args.kwargs["json"]["destination"])
        self.assertNotIn("segredo", str(post.call_args.kwargs["json"]))

    def test_erro_nao_expoe_token(self):
        class Fonte:
            NOME = "Shopee"
            gerar_link = staticmethod(lambda *args: "https://s.shopee.com.br/x")
        resposta = type("Resposta", (), {"status_code": 500})()
        with patch.object(site_publisher.config, "SITE_API_URL",
                          "https://canaltabarato.pages.dev/api/publish"), \
             patch.object(site_publisher.config, "SITE_API_TOKEN", "segredo"), \
             patch.object(site_publisher.requests, "post", return_value=resposta):
            with self.assertRaisesRegex(RuntimeError, "500") as erro:
                site_publisher.publicar(Fonte, {"oferta_id": "x", "price": 10})
        self.assertNotIn("segredo", str(erro.exception))

    def test_le_estatisticas_agregadas_do_site(self):
        resposta = type("Resposta", (), {
            "status_code": 200,
            "json": lambda self: {"total": 3, "by_channel": {"site": 3},
                                  "by_source": {"Shopee": 3},
                                  "by_offer": {"produto": 3}},
        })()
        with patch.object(site_publisher.config, "SITE_API_URL",
                          "https://canaltabarato.pages.dev/api/publish"), \
             patch.object(site_publisher.config, "SITE_API_TOKEN", "segredo"), \
             patch.object(site_publisher.requests, "get", return_value=resposta) as get:
            from datetime import datetime
            resumo = site_publisher.resumo_cliques(datetime(2026, 9, 1),
                                                    datetime(2026, 9, 2))
        self.assertEqual(3, resumo["total"])
        self.assertEqual("https://canaltabarato.pages.dev/api/stats",
                         get.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
