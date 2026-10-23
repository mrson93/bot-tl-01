import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import mercadolivre
import mercadolivre_api as api
import store


def resposta(status=200, corpo=None):
    r = Mock(status_code=status, content=b"x")
    r.json.return_value = corpo or {}
    r.raise_for_status = Mock()
    return r


class MercadoLivreApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.patches = [
            patch.object(store, "_DB", Path(self.tmp.name) / "estado.db"),
            patch.object(api.config, "MERCADOLIVRE_CLIENT_ID", "123"),
            patch.object(api.config, "MERCADOLIVRE_CLIENT_SECRET", "segredo"),
            patch.object(api.config, "MERCADOLIVRE_REFRESH_TOKEN", "TG-inicial"),
            patch.object(api.config, "MERCADOLIVRE_AFILIADO_PARAMETROS",
                         "matt_word=canaltabarato&matt_tool=71195511"),
            patch.object(api.config, "MERCADOLIVRE_CATEGORIAS", ("MLB1574", "MLB5726", "MLB1000")),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.tmp.cleanup()

    def test_renova_token_guarda_o_novo_e_reaproveita_ate_expirar(self):
        novo = resposta(corpo={"access_token": "A1", "refresh_token": "TG-novo", "expires_in": 21600})
        with patch.object(api.requests, "post", return_value=novo) as post:
            self.assertEqual("A1", api._access_token(agora=1000))
            self.assertEqual("A1", api._access_token(agora=2000))
        post.assert_called_once()
        self.assertEqual("TG-inicial", post.call_args.kwargs["data"]["refresh_token"])
        self.assertEqual("TG-novo", store._estado("ml_refresh_token"))
        with patch.object(api.requests, "post", return_value=novo) as post:
            api._access_token(agora=1000 + 21600)
        self.assertEqual("TG-novo", post.call_args.kwargs["data"]["refresh_token"])

    def test_autorizacao_revogada_vira_erro_especifico(self):
        negado = resposta(400, {"error": "invalid_grant"})
        with patch.object(api.requests, "post", return_value=negado):
            with self.assertRaises(api.AcessoRevogado):
                api._access_token(agora=1000)

    def test_link_de_afiliado_substitui_marcadores_antigos(self):
        link = api.link_afiliado("https://www.mercadolivre.com.br/produto/p/MLB123?matt_tool=999&x=1")
        self.assertEqual("https://www.mercadolivre.com.br/produto/p/MLB123?x=1&matt_word=canaltabarato"
                         "&matt_tool=71195511", link)
        with self.assertRaises(Exception):
            api.link_afiliado("https://site-falso.com/p/MLB123")

    def test_sem_parametros_de_afiliado_nada_e_publicado(self):
        with patch.object(api.config, "MERCADOLIVRE_AFILIADO_PARAMETROS", ""):
            self.assertFalse(api.pode_publicar())
        self.assertTrue(api.pode_publicar())

    def test_rodizio_de_categorias(self):
        self.assertEqual(["MLB1574", "MLB5726"], api.categorias_da_rodada())
        self.assertEqual(["MLB1000", "MLB1574"], api.categorias_da_rodada())

    def test_mais_vendidos_de_produto_e_anuncio(self):
        def get(caminho, params=None):
            if caminho.startswith("/highlights/"):
                return {"content": [{"id": "MLB111", "type": "PRODUCT", "position": 1},
                                    {"id": "MLB222", "type": "ITEM", "position": 2}]}
            if caminho == "/products/MLB111":
                return {"name": "Air Fryer Mondial 4L", "permalink": "https://www.mercadolivre.com.br/air-fryer/p/MLB111",
                        "pictures": [{"url": "http://http2.mlstatic.com/a.jpg"}],
                        "buy_box_winner": {"price": 300, "original_price": 400}}
            if caminho == "/items":
                return [{"code": 200, "body": {"id": "MLB222", "title": "Fone Bluetooth", "price": 90,
                         "original_price": None, "condition": "new", "status": "active",
                         "permalink": "https://produto.mercadolivre.com.br/MLB-222-fone",
                         "thumbnail": "https://http2.mlstatic.com/b.jpg"}}]
            raise AssertionError(caminho)
        with patch.object(api, "_get", side_effect=get), \
             patch.object(api.config, "MERCADOLIVRE_CATEGORIAS", ("MLB1574",)):
            ofertas = api.buscar_mais_vendidos()
        self.assertEqual(["mercadolivre_MLB111", "mercadolivre_MLB222"], [o["oferta_id"] for o in ofertas])
        air = ofertas[0]
        self.assertEqual(25, air["priceDiscountRate"])
        self.assertEqual("https://http2.mlstatic.com/a.jpg", air["imageUrl"])
        self.assertIn("matt_word=canaltabarato", air["productUrl"])
        self.assertEqual(1, air["_ml_mais_vendido"])
        self.assertEqual("", air["shopName"])
        self.assertEqual(0, ofertas[1]["priceDiscountRate"])

    def test_produto_sem_vencedor_usa_menor_preco_dos_anuncios(self):
        def get(caminho, params=None):
            if caminho.startswith("/highlights/"):
                return {"content": [{"id": "MLB111", "type": "PRODUCT", "position": 3}]}
            if caminho == "/products/MLB111":
                return {"name": "Cafeteira", "pictures": [{"url": "https://http2.mlstatic.com/c.jpg"}]}
            if caminho == "/products/MLB111/items":
                return {"results": [{"price": 250, "original_price": 300}, {"price": 220, "original_price": 280}]}
            raise AssertionError(caminho)
        with patch.object(api, "_get", side_effect=get), \
             patch.object(api.config, "MERCADOLIVRE_CATEGORIAS", ("MLB1574",)):
            ofertas = api.buscar_mais_vendidos()
        self.assertEqual(220, ofertas[0]["price"])
        self.assertEqual(21, ofertas[0]["priceDiscountRate"])
        self.assertIn("produto_preco_por_anuncio=1", api.resumo_diagnostico())

    def test_revalidacao_reaproveita_leitura_da_rodada(self):
        mercadolivre._ultima_leitura.update(em=0.0, ofertas=None)
        lista = [{"oferta_id": "mercadolivre_MLB9", "productName": "Item", "price": 10}]
        with patch.object(mercadolivre.config, "MERCADOLIVRE_LIST_URL", "https://meli.la/x"), \
             patch.object(mercadolivre, "_buscar_lista", return_value=lista) as lista_mock, \
             patch.object(api, "buscar_mais_vendidos", return_value=[]) as api_mock, \
             patch.object(api, "consultar", return_value={}) as consultar:
            mercadolivre.buscar_ofertas()
            achados = mercadolivre.consultar_produtos(["mercadolivre_MLB9"])
            mercadolivre.consultar_produtos(["mercadolivre_MLB777"])
        self.assertEqual(["mercadolivre_MLB9"], list(achados))
        lista_mock.assert_called_once()
        api_mock.assert_called_once()
        consultar.assert_called_once_with(["mercadolivre_MLB777"])
        mercadolivre._ultima_leitura.update(em=0.0, ofertas=None)

    def test_falha_da_api_nao_derruba_a_lista(self):
        lista = [{"oferta_id": "mercadolivre_MLB9", "productName": "Item da lista", "price": 10}]
        with patch.object(mercadolivre.config, "MERCADOLIVRE_LIST_URL", "https://meli.la/x"), \
             patch.object(mercadolivre, "_buscar_lista", return_value=lista), \
             patch.object(api, "buscar_mais_vendidos", side_effect=RuntimeError("fora")):
            self.assertEqual(lista, mercadolivre.buscar_ofertas())

    def test_lista_e_api_sao_somadas_sem_repetir(self):
        lista = [{"oferta_id": "mercadolivre_MLB1", "productName": "Lista", "price": 10}]
        mais = [{"oferta_id": "mercadolivre_MLB1", "productName": "API", "price": 9},
                {"oferta_id": "mercadolivre_MLB2", "productName": "API 2", "price": 20}]
        with patch.object(mercadolivre.config, "MERCADOLIVRE_LIST_URL", "https://meli.la/x"), \
             patch.object(mercadolivre, "_buscar_lista", return_value=lista), \
             patch.object(api, "buscar_mais_vendidos", return_value=mais):
            ofertas = mercadolivre.buscar_ofertas()
        self.assertEqual(["Lista", "API 2"], [o["productName"] for o in ofertas])


if __name__ == "__main__":
    unittest.main()
