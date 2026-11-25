import unittest
from unittest.mock import patch

import mercadolivre


HTML = """
<div class="andes-card lists-card poly-card">
  <img class="poly-component__picture" src="https://http2.mlstatic.com/cafe.webp"
       alt="Café Gourmet 250g">
  <div class="poly-card__content">
    <a class="poly-component__title"
       href="https://www.mercadolivre.com.br/cafe/p/MLB23766416?matt_tool=71195511&amp;x=1#source=lists&amp;tracking_id=abc&amp;wid=MLB3340103325">Café Gourmet 250g</a>
    <span class="poly-component__seller">Por 3 Corações</span>
    <s class="poly-price__previous" aria-label="Antes: 37 reais com 16 centavos"></s>
    <span class="poly-price__amount" aria-label="Agora: 28 reais com 90 centavos"></span>
    <span class="poly-price__disc--pill">22% OFF</span>
    <span class="poly-reviews__rating">4.9</span>
  </div>
</div>
<div class="andes-card lists-card poly-card">
  <img class="poly-component__picture" src="https://http2.mlstatic.com/iphone.webp"
       alt="iPhone 17 256 gb">
  <a class="poly-component__title"
     href="https://www.mercadolivre.com.br/iphone/p/MLB1055308917#source=lists&amp;wid=MLB7590894102">iPhone 17 256&nbsp;gb</a>
  <s class="poly-price__previous" aria-label="Antes: 7999 reais"></s>
  <span class="poly-price__amount" aria-label="Agora: 5039 reais"></span>
  <span class="poly-price__disc--pill">36% OFF</span>
</div>
"""
URL_LISTA = "https://www.mercadolivre.com.br/social/canal/lists/lista"


class MercadoLivreTest(unittest.TestCase):
    def setUp(self):
        mercadolivre._ultima_leitura.update(em=0.0, ofertas=None)

    def test_parseia_lista_e_preserva_link_rastreado(self):
        lista_rastreada = URL_LISTA + "?matt_tool=71195511&forceInApp=true"
        with patch.object(mercadolivre, "_baixar_html", return_value=(HTML, lista_rastreada)), \
             patch.object(mercadolivre.config, "MERCADOLIVRE_LIST_URL", "https://meli.la/x"), \
             patch.object(mercadolivre.config, "MERCADOLIVRE_FETCH_LIMIT", 150):
            ofertas = mercadolivre.buscar_ofertas()

        self.assertEqual(2, len(ofertas))
        cafe = ofertas[0]
        self.assertEqual("mercadolivre_MLB3340103325", cafe["oferta_id"])
        self.assertEqual(28.90, cafe["price"])
        self.assertEqual(37.16, cafe["precoOriginal"])
        self.assertEqual(22, cafe["priceDiscountRate"])
        self.assertEqual(4.9, cafe["ratingStar"])
        self.assertEqual("3 Corações", cafe["shopName"])
        self.assertIn("tracking_id=abc", cafe["productUrl"])
        self.assertIn("matt_tool=71195511", cafe["productUrl"])
        self.assertIn("matt_tool=71195511", ofertas[1]["productUrl"])
        self.assertNotIn("forceInApp", ofertas[1]["productUrl"])
        self.assertTrue(cafe["curadoriaManual"])
        self.assertEqual("iPhone 17 256 gb", ofertas[1]["productName"])

    def test_gerar_link_rejeita_dominio_estranho(self):
        with self.assertRaises(ValueError):
            mercadolivre.gerar_link("https://exemplo.com/produto")

    def test_marcador_existente_do_produto_nao_e_substituido(self):
        url = mercadolivre._adicionar_marcadores_lista(
            "https://www.mercadolivre.com.br/p/MLB1?matt_tool=original#tracking_id=x",
            URL_LISTA + "?matt_tool=lista",
        )
        self.assertIn("matt_tool=original", url)
        self.assertNotIn("matt_tool=lista", url)

    def test_prazo_explicito_da_lista_e_preservado(self):
        html = HTML.replace('class="andes-card lists-card poly-card"',
                            'class="andes-card lists-card poly-card" data-deal-end-date="2026-09-19T10:00:00Z"', 1)
        with patch.object(mercadolivre, "_baixar_html", return_value=(html, URL_LISTA)), \
             patch.object(mercadolivre.config, "MERCADOLIVRE_LIST_URL", "https://meli.la/x"):
            self.assertEqual("2026-09-19T10:00:00Z", mercadolivre.buscar_ofertas()[0]["expira_em"])

    def test_consulta_produtos_retorna_apenas_os_que_continuam_na_lista(self):
        with patch.object(mercadolivre, "_baixar_html", return_value=(HTML, URL_LISTA)), \
             patch.object(mercadolivre.config, "MERCADOLIVRE_LIST_URL", "https://meli.la/x"), \
             patch.object(mercadolivre.config, "MERCADOLIVRE_FETCH_LIMIT", 150):
            encontrados = mercadolivre.consultar_produtos([
                "mercadolivre_MLB3340103325", "mercadolivre_MLB0000000000"
            ])

        self.assertEqual(["mercadolivre_MLB3340103325"], list(encontrados))
        self.assertEqual(28.90, encontrados["mercadolivre_MLB3340103325"]["price"])

    def test_revalidacao_informa_quando_produto_saiu_da_lista(self):
        with patch.object(mercadolivre, "buscar_ofertas", return_value=[]):
            self.assertIsNone(mercadolivre.revalidar_oferta({
                "oferta_id": "mercadolivre_MLB3340103325"
            }))

    def test_preco_com_milhar_e_centavos(self):
        self.assertEqual(5039, mercadolivre._preco_por_rotulo("Agora: 5039 reais"))
        self.assertEqual(1234.56, mercadolivre._preco_por_rotulo(
            "Agora: 1.234 reais com 56 centavos"
        ))

    def test_link_da_lista_recebe_matt_word_configurado(self):
        from unittest.mock import patch
        with patch.object(mercadolivre.config, "MERCADOLIVRE_AFILIADO_PARAMETROS",
                          "matt_word=canaltabarato&matt_tool=71195511"):
            url = mercadolivre._adicionar_marcadores_lista(
                "https://www.mercadolivre.com.br/produto/p/MLB1?x=1",
                "https://www.mercadolivre.com.br/social/emerpettorini/lists/1?matt_tool=71195511&forceInApp=true")
        self.assertEqual("https://www.mercadolivre.com.br/produto/p/MLB1?x=1&matt_tool=71195511"
                         "&matt_word=canaltabarato", url)

    def test_preco_em_espanhol_como_a_pagina_passou_a_mostrar(self):
        self.assertEqual(151.5, mercadolivre._preco_por_rotulo(
            "Ahora: 151 reales con 50 centavos"))
        self.assertEqual(1202, mercadolivre._preco_por_rotulo("Antes: 1.202 reales"))

    def test_id_de_anuncio_sem_pagina_de_catalogo(self):
        self.assertEqual("MLB4049176847", mercadolivre._id_produto(
            "https://produto.mercadolivre.com.br/MLB-4049176847-calca-wide-cargo-jeans-_JM"))

    def test_importa_todas_as_paginas_da_lista(self):
        segunda = HTML.replace("MLB3340103325", "MLB1111111111").replace(
            "MLB7590894102", "MLB2222222222"
        )
        with patch.object(mercadolivre, "_baixar_html", side_effect=[
            (HTML, URL_LISTA), (segunda, URL_LISTA + "?page=2"),
            (segunda, URL_LISTA + "?page=3"),
        ]) as baixar, patch.object(
            mercadolivre.config, "MERCADOLIVRE_LIST_URL", "https://meli.la/x"
        ), patch.object(mercadolivre.config, "MERCADOLIVRE_FETCH_LIMIT", 150):
            ofertas = mercadolivre.buscar_ofertas()
        self.assertEqual(4, len(ofertas))
        self.assertEqual(URL_LISTA + "?page=2", baixar.call_args_list[1].args[0])
        self.assertEqual(URL_LISTA + "?page=3", baixar.call_args_list[2].args[0])

    def test_lista_quebrada_avisa_mesmo_com_a_api_funcionando(self):
        da_api = {"oferta_id": "mercadolivre_MLB9", "productName": "Fone"}
        with patch.object(mercadolivre.config, "MERCADOLIVRE_LIST_URL", URL_LISTA), \
             patch.object(mercadolivre, "_buscar_lista",
                          side_effect=RuntimeError("Nenhuma oferta válida")), \
             patch.object(mercadolivre.mercadolivre_api, "pode_publicar", return_value=True), \
             patch.object(mercadolivre.mercadolivre_api, "buscar_mais_vendidos",
                          return_value=[da_api]), \
             patch.object(mercadolivre.mercadolivre_api, "resumo_diagnostico", return_value=""), \
             patch.object(mercadolivre.monitor, "avisar_falha_lista") as avisar:
            ofertas = mercadolivre.buscar_ofertas()
        self.assertEqual(["mercadolivre_MLB9"], [o["oferta_id"] for o in ofertas])
        avisar.assert_called_once()
        self.assertEqual("Mercado Livre (lista manual)", avisar.call_args.args[0])
        self.assertIn("API", avisar.call_args.kwargs["impacto"])


    def _com_api_vazia(self, copia):
        return [patch.object(mercadolivre.config, "MERCADOLIVRE_LIST_URL", ""),
                patch.object(mercadolivre.mercadolivre_api, "pode_publicar", return_value=True),
                patch.object(mercadolivre.mercadolivre_api, "buscar_mais_vendidos", return_value=[]),
                patch.object(mercadolivre.mercadolivre_api, "resumo_diagnostico", return_value=""),
                patch.object(mercadolivre.mercadolivre_api.config, "MERCADOLIVRE_AFILIADO_PARAMETROS",
                             "matt_word=canaltabarato&matt_tool=71195511"),
                patch.object(mercadolivre.site_publisher, "ler_lista_mercadolivre", return_value=copia)]

    def test_api_sem_ofertas_usa_a_copia_da_extensao_com_link_de_afiliado(self):
        import time
        itens = [{"id": "MLB5410852112", "product_id": "MLB24028629", "title": "Fone P20i", "price": 118.75,
                  "original_price": 149.9, "image": "https://http2.mlstatic.com/D_Q_NP_2X_1-AB.webp",
                  "url": "https://www.mercadolivre.com.br/fone/p/MLB24028629", "position": 1, "pix": True},
                 {"id": "MLB1234567", "title": "Foto ruim", "price": 10, "image": "https://evil.com/a.webp",
                  "url": "https://www.mercadolivre.com.br/x/p/MLB1"}]
        remendos = self._com_api_vazia((time.time() - 1800, itens))
        for r in remendos:
            r.start()
        try:
            ofertas = mercadolivre.buscar_ofertas()
        finally:
            for r in reversed(remendos):
                r.stop()
        self.assertEqual(["mercadolivre_MLB24028629"], [o["oferta_id"] for o in ofertas])
        oferta = ofertas[0]
        self.assertEqual((118.75, 149.9, 21, 1), (oferta["price"], oferta["precoOriginal"],
                                                  oferta["priceDiscountRate"], oferta["_ml_mais_vendido"]))
        self.assertIn("matt_tool=71195511", oferta["productUrl"])
        self.assertTrue(oferta["precoNoPix"])

    def test_copia_velha_ou_ausente_nao_vira_oferta(self):
        import time
        item = {"id": "MLB5410852112", "title": "Fone", "price": 10,
                "image": "https://http2.mlstatic.com/a.webp", "url": "https://www.mercadolivre.com.br/p/MLB1"}
        for copia in (None, (time.time() - 5 * 3600, [item])):
            remendos = self._com_api_vazia(copia)
            for r in remendos:
                r.start()
            try:
                with self.assertRaises(RuntimeError):
                    mercadolivre.buscar_ofertas()
            finally:
                for r in reversed(remendos):
                    r.stop()


if __name__ == "__main__":
    unittest.main()
