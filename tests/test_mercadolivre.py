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


class MercadoLivreTest(unittest.TestCase):
    def test_parseia_lista_e_preserva_link_rastreado(self):
        with patch.object(mercadolivre, "_baixar_html", return_value=HTML), \
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
        self.assertTrue(cafe["curadoriaManual"])
        self.assertEqual("iPhone 17 256 gb", ofertas[1]["productName"])

    def test_gerar_link_rejeita_dominio_estranho(self):
        with self.assertRaises(ValueError):
            mercadolivre.gerar_link("https://exemplo.com/produto")

    def test_consulta_produtos_retorna_apenas_os_que_continuam_na_lista(self):
        with patch.object(mercadolivre, "_baixar_html", return_value=HTML), \
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


if __name__ == "__main__":
    unittest.main()
