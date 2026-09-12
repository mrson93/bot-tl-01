import base64
import unittest
from unittest.mock import patch

import site_publisher


class SitePublisherTest(unittest.TestCase):
    def test_hospeda_jpeg_temporario_para_story(self):
        jpeg = b"\xff\xd8\xff" + b"imagem"
        resposta = type("Resposta", (), {
            "status_code": 201,
            "json": lambda self: {
                "url": "https://canaltabarato.pages.dev/story-assets/abc.jpg"
            },
        })()
        with patch.object(site_publisher.config, "SITE_ATIVO", True), \
             patch.object(site_publisher.config, "SITE_API_URL",
                          "https://canaltabarato.pages.dev/api/publish"), \
             patch.object(site_publisher.config, "SITE_API_TOKEN", "segredo"), \
             patch.object(site_publisher.requests, "post", return_value=resposta) as post:
            url = site_publisher.publicar_imagem_story(jpeg)
        self.assertEqual(
            "https://canaltabarato.pages.dev/api/story-assets",
            post.call_args.args[0],
        )
        self.assertEqual(
            jpeg, base64.b64decode(post.call_args.kwargs["json"]["image_base64"])
        )
        self.assertEqual(
            "https://canaltabarato.pages.dev/story-assets/abc.jpg", url
        )

    def test_verifica_jpeg_publico_para_story(self):
        resposta = type("Resposta", (), {
            "status_code": 200,
            "headers": {"Content-Type": "image/jpeg", "Content-Length": "7"},
            "iter_content": lambda self, _tamanho: iter([b"\xff\xd8\xffjpeg"]),
            "close": lambda self: None,
        })()
        with patch.object(site_publisher.requests, "get", return_value=resposta):
            site_publisher.verificar_imagem_publica_story(
                "https://canaltabarato.pages.dev/story-assets/abc.jpg", 7
            )

    def test_registra_story_para_resposta_no_direct(self):
        resposta = type("Resposta", (), {"status_code": 201})()
        oferta = {"oferta_id": "shopee_1", "productName": "Panela", "price": 79.9}
        with patch.object(site_publisher.config, "SITE_API_URL",
                          "https://canaltabarato.pages.dev/api/publish"), \
             patch.object(site_publisher.config, "SITE_API_TOKEN", "segredo"), \
             patch.object(site_publisher.requests, "post", return_value=resposta) as post:
            site_publisher.registrar_story_instagram(
                "17900000000000001", "18000000000000001", oferta,
                "https://s.shopee.com.br/instagram"
            )
        self.assertEqual("https://canaltabarato.pages.dev/api/instagram-story-links",
                         post.call_args.args[0])
        self.assertEqual("Panela", post.call_args.kwargs["json"]["title"])
        self.assertEqual("18000000000000001",
                         post.call_args.kwargs["json"]["container_id"])
        self.assertEqual(79.9, post.call_args.kwargs["json"]["price"])
        self.assertEqual("Bearer segredo",
                         post.call_args.kwargs["headers"]["Authorization"])

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
        self.assertIn("coupon_code", post.call_args.kwargs["json"])
        self.assertIn("payment_label", post.call_args.kwargs["json"])
        self.assertNotIn("segredo", str(post.call_args.kwargs["json"]))

    def test_publica_cupom_em_endpoint_separado(self):
        resposta = type("Resposta", (), {"status_code": 201})()
        cupom = {"id": "cupom_1", "fonte": "AliExpress", "codigo": "APP20",
                 "condicao": "R$ 20 acima de R$ 100", "ativo_em": 10,
                 "expira_em": 20}
        with patch.object(site_publisher.config, "SITE_API_URL",
                          "https://canaltabarato.pages.dev/api/publish"), \
             patch.object(site_publisher.config, "SITE_API_TOKEN", "segredo"), \
             patch.object(site_publisher.requests, "post", return_value=resposta) as post:
            site_publisher.publicar_cupom(cupom, "https://s.click.aliexpress.com/e/x")
        self.assertEqual("https://canaltabarato.pages.dev/api/coupons",
                         post.call_args.args[0])
        self.assertEqual("APP20", post.call_args.kwargs["json"]["code"])
        self.assertIn("title", post.call_args.kwargs["json"])
        self.assertIn("kind", post.call_args.kwargs["json"])
        self.assertEqual("Bearer segredo",
                         post.call_args.kwargs["headers"]["Authorization"])

    def test_publica_voucher_sem_codigo(self):
        resposta = type("Resposta", (), {"status_code": 201})()
        cupom = {"id": "voucher_1", "fonte": "Shopee", "codigo": "",
                 "titulo": "Frete grátis no app", "tipo": "voucher"}
        with patch.object(site_publisher.config, "SITE_API_URL",
                          "https://canaltabarato.pages.dev/api/publish"), \
             patch.object(site_publisher.config, "SITE_API_TOKEN", "segredo"), \
             patch.object(site_publisher.requests, "post", return_value=resposta) as post:
            site_publisher.publicar_cupom(cupom, "https://s.shopee.com.br/x")
        self.assertEqual("", post.call_args.kwargs["json"]["code"])
        self.assertEqual("Frete grátis no app", post.call_args.kwargs["json"]["title"])
        self.assertEqual("voucher", post.call_args.kwargs["json"]["kind"])

    def test_publica_atalho_da_loja_com_link_afiliado(self):
        class Fonte:
            NOME = "Shopee"
            chamada = None

            @classmethod
            def gerar_link(cls, url, tracking, etiquetas):
                cls.chamada = (url, tracking, etiquetas)
                return "https://s.shopee.com.br/pagina-inicial"

        resposta = type("Resposta", (), {"status_code": 201})()
        with patch.object(site_publisher.config, "SITE_API_URL",
                          "https://canaltabarato.pages.dev/api/publish"), \
             patch.object(site_publisher.config, "SITE_API_TOKEN", "segredo"), \
             patch.object(site_publisher.config, "SITE_TRACKING_ID", "site"), \
             patch.object(site_publisher.requests, "post", return_value=resposta) as post:
            site_publisher.publicar_loja(Fonte)
        self.assertEqual("https://canaltabarato.pages.dev/api/stores",
                         post.call_args.args[0])
        self.assertEqual("Shopee", post.call_args.kwargs["json"]["source"])
        self.assertEqual("https://s.shopee.com.br/pagina-inicial",
                         post.call_args.kwargs["json"]["destination"])
        self.assertEqual("https://shopee.com.br/", Fonte.chamada[0])

    def test_publica_link_do_shopee_vip_e_cria_atalho_rastreavel(self):
        resposta = type("Resposta", (), {"status_code": 201})()
        with patch.object(site_publisher.config, "SITE_API_URL",
                          "https://canaltabarato.pages.dev/api/publish"), \
             patch.object(site_publisher.config, "SITE_API_TOKEN", "segredo"), \
             patch.object(site_publisher.requests, "post", return_value=resposta) as post:
            site_publisher.publicar_shopee_vip("https://u.shopee.com.br/shopeevip?code=x")
            link = site_publisher.link_publico_loja("shopee-vip")
        self.assertEqual("Shopee VIP", post.call_args.kwargs["json"]["source"])
        self.assertEqual("https://canaltabarato.pages.dev/loja/shopee-vip", link)

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
            "json": lambda self: {"total": 3, "views": 12, "ctr": 25,
                                  "by_channel": {"site": 3},
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
        self.assertEqual(12, resumo["visitas"])
        self.assertEqual(25, resumo["ctr"])
        self.assertEqual("https://canaltabarato.pages.dev/api/stats",
                         get.call_args.args[0])

    def test_atualiza_catalogo_sem_republicar_nas_redes(self):
        class Fonte:
            NOME = "Shopee"

            @staticmethod
            def consultar_produtos(ids):
                return {ids[0]: {
                    "productName": "Panela atualizada", "price": 69.9,
                    "precoOriginal": 99.9, "priceDiscountRate": 30,
                    "ratingStar": 4.9, "sales": 700, "shopName": "Loja",
                    "imageUrl": "https://img.test/panela.jpg", "categoria": "cozinha",
                }}

        fila = type("Resposta", (), {
            "status_code": 200,
            "json": lambda self: {"candidates": [
                {"id": "shopee_1_2", "source": "Shopee"},
                {"id": "shopee_1_3", "source": "Shopee"},
            ]},
        })()
        salva = type("Resposta", (), {"status_code": 200})()
        with patch.object(site_publisher.config, "SITE_ATIVO", True), \
             patch.object(site_publisher.config, "SITE_API_URL",
                          "https://canaltabarato.pages.dev/api/publish"), \
             patch.object(site_publisher.config, "SITE_API_TOKEN", "segredo"), \
             patch.object(site_publisher.requests, "get", return_value=fila), \
             patch.object(site_publisher.requests, "post", return_value=salva) as post:
            resultado = site_publisher.atualizar_catalogo([Fonte], 2)
        self.assertEqual({"consultados": 2, "encontrados": 1}, resultado)
        updates = post.call_args.kwargs["json"]["updates"]
        self.assertTrue(updates[0]["found"])
        self.assertFalse(updates[1]["found"])
        self.assertEqual("https://canaltabarato.pages.dev/api/refresh",
                         post.call_args.args[0])

    def test_falha_da_plataforma_nao_marca_produto_como_ausente(self):
        class Fonte:
            NOME = "Shopee"
            consultar_produtos = staticmethod(
                lambda ids: (_ for _ in ()).throw(RuntimeError("API fora"))
            )

        fila = type("Resposta", (), {
            "status_code": 200,
            "json": lambda self: {"candidates": [
                {"id": "shopee_1_2", "source": "Shopee"}
            ]},
        })()
        with patch.object(site_publisher.config, "SITE_ATIVO", True), \
             patch.object(site_publisher.config, "SITE_API_URL",
                          "https://canaltabarato.pages.dev/api/publish"), \
             patch.object(site_publisher.config, "SITE_API_TOKEN", "segredo"), \
             patch.object(site_publisher.requests, "get", return_value=fila), \
             patch.object(site_publisher.requests, "post") as post:
            resultado = site_publisher.atualizar_catalogo([Fonte], 1)
        self.assertEqual(0, resultado["consultados"])
        post.assert_not_called()


if __name__ == "__main__":
    unittest.main()
