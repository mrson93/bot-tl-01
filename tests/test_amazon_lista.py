import unittest
from unittest.mock import Mock
from unittest.mock import patch

import amazon


HTML = """
<a class="a-link-normal single-product-item-link" href="/dp/B0F9Z2DV83?linkCode=spc&amp;tag=canaltabarato-20&amp;creativeASIN=B0F9Z2DV83">
  <div class="single-product-item" data-asin="B0F9Z2DV83">
    <img class="product-image" src="https://m.media-amazon.com/images/I/robo.jpg">
    <span class="product-brand-text"><bdi>WAP</bdi></span>
    <span class="product-title-text"><bdi>Aspirador de Pó Robô W310</bdi></span>
    <span class="product-badge-label">57% off</span>
    <span class="a-price"><span class="a-offscreen">R$509,90</span></span>
    <span class="basis-price-text a-text-strike">R$ 1.199,90</span>
  </div>
</a>
<a class="a-link-normal single-product-item-link" href="/dp/B0DPNHDC9B?tag=canaltabarato-20">
  <div class="single-product-item" data-asin="B0DPNHDC9B">
    <img class="product-image" src="https://m.media-amazon.com/images/I/cerave.jpg">
    <span class="product-brand-text">CeraVe</span>
    <span class="product-title-text">Loção Facial Hidratante</span>
    <span class="a-price"><span class="a-offscreen">R$117,90</span></span>
  </div>
</a>
"""


class AmazonListaTest(unittest.TestCase):
    def _config(self):
        return (
            patch.object(amazon.config, "AMAZON_LIST_URL", "https://amzn.to/lista"),
            patch.object(amazon.config, "AMAZON_ASSOCIATE_TAG", "canaltabarato-20"),
            patch.object(amazon.config, "AMAZON_FETCH_LIMIT", 100),
            patch.object(amazon.config, "AMAZON_LIST_SOURCE_TAGS", ("emersonpettor-20",)),
        )

    def test_importa_lista_com_preco_desconto_e_tag_de_afiliado(self):
        a, b, c, d = self._config()
        with a, b, c, d, patch.object(amazon, "_baixar_lista", return_value=HTML):
            ofertas = amazon.buscar_ofertas()

        self.assertEqual(2, len(ofertas))
        robo = ofertas[0]
        self.assertEqual("amazon_B0F9Z2DV83", robo["oferta_id"])
        self.assertEqual(509.90, robo["price"])
        self.assertEqual(1199.90, robo["precoOriginal"])
        self.assertEqual(57, robo["priceDiscountRate"])
        self.assertEqual("WAP", robo["shopName"])
        self.assertIn("tag=canaltabarato-20", robo["productUrl"])
        self.assertTrue(robo["curadoriaManual"])

    def test_revalidacao_retorna_apenas_produto_ainda_presente(self):
        a, b, c, d = self._config()
        with a, b, c, d, patch.object(amazon, "_baixar_lista", return_value=HTML):
            encontrados = amazon.consultar_produtos([
                "amazon_B0DPNHDC9B", "amazon_B000000000"
            ])
        self.assertEqual(["amazon_B0DPNHDC9B"], list(encontrados))

    def test_prazo_explicito_da_lista_e_preservado(self):
        html = HTML.replace('data-asin="B0F9Z2DV83"',
                            'data-asin="B0F9Z2DV83" data-deal-end-date="2026-09-19T10:00:00Z"')
        a, b, c, d = self._config()
        with a, b, c, d, patch.object(amazon, "_baixar_lista", return_value=html):
            self.assertEqual("2026-09-19T10:00:00Z", amazon.buscar_ofertas()[0]["expira_em"])

    def test_descarta_produto_sem_tag_de_afiliado_correta(self):
        html = HTML.replace("tag=canaltabarato-20", "tag=outra-20")
        a, b, c, d = self._config()
        with a, b, c, d, patch.object(amazon, "_baixar_lista", return_value=html):
            with self.assertRaisesRegex(RuntimeError, "Nenhuma oferta válida"):
                amazon.buscar_ofertas()

    def test_aceita_tag_da_vitrine_e_publica_com_tag_do_bot(self):
        html = HTML.replace("tag=canaltabarato-20", "tag=emersonpettor-20")
        a, b, c, d = self._config()
        with a, b, c, d, patch.object(amazon, "_baixar_lista", return_value=html):
            ofertas = amazon.buscar_ofertas()
        self.assertEqual(2, len(ofertas))
        self.assertIn("tag=canaltabarato-20", ofertas[0]["productUrl"])
        self.assertNotIn("tag=emersonpettor-20", ofertas[0]["productUrl"])

    def test_rejeita_multiplas_tags_mesmo_se_uma_for_autorizada(self):
        html = HTML.replace("tag=canaltabarato-20", "tag=emersonpettor-20&amp;tag=outra-20")
        a, b, c, d = self._config()
        with a, b, c, d, patch.object(amazon, "_baixar_lista", return_value=html):
            with self.assertRaisesRegex(RuntimeError, "Nenhuma oferta válida"):
                amazon.buscar_ofertas()

    def test_gerar_link_substitui_tag_e_rejeita_outro_dominio(self):
        with patch.object(amazon.config, "AMAZON_ASSOCIATE_TAG", "canaltabarato-20"):
            link = amazon.gerar_link(
                "https://www.amazon.com.br/dp/B0F9Z2DV83?tag=antiga-20&psc=1"
            )
        self.assertIn("tag=canaltabarato-20", link)
        self.assertNotIn("tag=antiga-20", link)
        with self.assertRaises(ValueError):
            amazon.gerar_link("https://exemplo.com/produto")

    def test_lista_reutiliza_sessao_e_repete_503_com_espera(self):
        indisponivel = Mock(status_code=503, headers={})
        indisponivel.raise_for_status.side_effect = RuntimeError("503")
        sucesso = Mock(status_code=200, headers={}, encoding="utf-8")
        sucesso.iter_content.return_value = [HTML.encode()]
        sessao = Mock()
        sessao.__enter__ = Mock(return_value=sessao)
        sessao.__exit__ = Mock(return_value=False)
        sessao.get.side_effect = [indisponivel, sucesso]
        with patch.object(amazon.requests, "Session", return_value=sessao), \
             patch.object(amazon.time, "sleep") as esperar:
            self.assertIn("single-product-item-link", amazon._baixar_lista(
                "https://www.amazon.com.br/shop/teste/list/123"
            ))
        self.assertEqual(2, sessao.get.call_count)
        esperar.assert_called_once_with(2)


if __name__ == "__main__":
    unittest.main()
