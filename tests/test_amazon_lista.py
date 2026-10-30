import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import Mock
from unittest.mock import patch

import requests

import amazon
import telegram_poster


HTML = """
<a class="a-link-normal single-product-item-link" href="/dp/B0F9Z2DV83?linkCode=spc&amp;tag=canaltabarato-20&amp;creativeASIN=B0F9Z2DV83">
  <div class="single-product-item" data-asin="B0F9Z2DV83">
    <img class="product-image" src="https://m.media-amazon.com/images/I/robo.jpg">
    <span class="product-brand-text"><bdi>WAP</bdi></span>
    <span class="product-title-text"><bdi>Aspirador de Pó Robô W310</bdi></span>
    <span class="product-badge-label">57% off</span>
    <span class="product-badge-message">Menor preço em 365 dias</span>
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
    def setUp(self):
        amazon._cache_lista.update(url=None, em=0.0, ofertas=None)
        pasta = tempfile.TemporaryDirectory()
        self.addCleanup(pasta.cleanup)
        banco = patch.object(amazon.store, "_DB", Path(pasta.name) / "estado.db")
        banco.start()
        self.addCleanup(banco.stop)

    def test_selo_de_menor_preco_da_amazon_vai_para_o_post(self):
        a, b, c, d = self._config()
        with a, b, c, d, patch.object(amazon, "_baixar_lista", return_value=HTML):
            ofertas = {o["oferta_id"]: o for o in amazon.buscar_ofertas()}
        robo = ofertas["amazon_B0F9Z2DV83"]
        self.assertEqual(365, robo["menorPrecoLojaDias"])
        self.assertNotIn("menorPrecoLojaDias", ofertas["amazon_B0DPNHDC9B"])
        self.assertEqual("📉 Menor preço em 365 dias, segundo a Amazon",
                         telegram_poster.linha_historico(robo))

    def test_segue_as_paginas_do_carregar_mais(self):
        inicio = HTML.split("</a>")[0] + "</a>" + (
            '<script type="a-state" data-a-state="{&quot;key&quot;:&quot;listScrollState&quot;}">'
            '{"listId":"2ZUSMM2BR8LVZ","vanityHandle":"emersonpettor",'
            '"shouldListLoadMoreFlag":true,"pageToken":"T1"}</script>')
        segunda = HTML.split("</a>")[1] + "</a>" + (
            '<input type="hidden" name="pageToken" value="T2" class="pageToken"/>'
            '<input type="hidden" name="shouldListLoadMoreFlag" value="false"/>')
        urls = []

        def baixar(url, sessao=None):
            urls.append(url)
            return inicio if len(urls) == 1 else segunda

        a, b, c, d = self._config()
        with a, b, c, d, patch.object(amazon, "_baixar_lista", side_effect=baixar), \
             patch.object(amazon, "_PAUSA_PAGINAS", 0):
            ofertas = amazon.buscar_ofertas()
        self.assertEqual({"amazon_B0F9Z2DV83", "amazon_B0DPNHDC9B"},
                         {o["oferta_id"] for o in ofertas})
        self.assertEqual(2, len(urls))
        self.assertIn("/shop/emersonpettor/api/listItems?listId=2ZUSMM2BR8LVZ&pageToken=T1", urls[1])

    def _site(self, copia=None, erro=None):
        url = "https://www.amazon.com.br/shop/emersonpettor/list/2ZUSMM2BR8LVZ"
        return (
            patch.object(amazon.config, "AMAZON_LIST_URL", url),
            patch.object(amazon.config, "AMAZON_LISTA_SITE_MINUTOS", 90),
            patch.object(amazon.site_publisher, "esta_configurado", return_value=True),
            patch.object(amazon.site_publisher, "ler_lista_amazon",
                         return_value=copia, side_effect=erro),
        )

    def test_usa_copia_recente_da_extensao_sem_chamar_a_amazon(self):
        a, b, c, d = self._config()
        e, f, g, h = self._site((time.time() - 10 * 60, [HTML]))
        with a, b, c, d, e, f, g, h as ler, \
             patch.object(amazon, "_baixar_lista") as baixar:
            ofertas = amazon.buscar_ofertas()
            # A reserva guarda a hora da leitura da extensão, não a da rodada.
            reserva, idade = amazon._lista_reserva()
        baixar.assert_not_called()
        ler.assert_called_once_with("2ZUSMM2BR8LVZ")
        self.assertEqual({"amazon_B0F9Z2DV83", "amazon_B0DPNHDC9B"},
                         {o["oferta_id"] for o in ofertas})
        self.assertEqual(2, len(reserva))
        self.assertGreaterEqual(idade, 9)

    def test_copia_velha_ou_site_fora_do_ar_volta_a_ler_a_amazon(self):
        for copia, erro in (((time.time() - 3 * 3600, [HTML]), None),
                            (None, RuntimeError("Site recusou (500)")),
                            (None, None)):
            amazon._cache_lista.update(url=None, em=0.0, ofertas=None)
            a, b, c, d = self._config()
            e, f, g, h = self._site(copia, erro)
            with a, b, c, d, e, f, g, h, \
                 patch.object(amazon, "_baixar_lista", return_value=HTML) as baixar:
                ofertas = amazon.buscar_ofertas()
            baixar.assert_called()
            self.assertEqual(2, len(ofertas))

    def _erro_503(self):
        return requests.HTTPError("503", response=Mock(status_code=503))

    def test_503_usa_a_ultima_leitura_boa_da_lista(self):
        a, b, c, d = self._config()
        with a, b, c, d:
            with patch.object(amazon, "_baixar_lista", return_value=HTML):
                amazon.buscar_ofertas()
            amazon._cache_lista.update(url=None, em=0.0, ofertas=None)
            with patch.object(amazon, "_baixar_lista", side_effect=self._erro_503()):
                ofertas = amazon.buscar_ofertas()
        self.assertEqual({"amazon_B0F9Z2DV83", "amazon_B0DPNHDC9B"},
                         {o["oferta_id"] for o in ofertas})

    def test_503_com_leitura_antiga_demais_continua_falhando(self):
        a, b, c, d = self._config()
        with a, b, c, d:
            with patch.object(amazon, "_baixar_lista", return_value=HTML):
                amazon.buscar_ofertas()
            amazon._cache_lista.update(url=None, em=0.0, ofertas=None)
            antigo = time.time() + (amazon.config.AMAZON_LISTA_RESERVA_MINUTOS + 1) * 60
            with patch.object(amazon, "_baixar_lista", side_effect=self._erro_503()), \
                 patch.object(amazon.time, "time", return_value=antigo):
                with self.assertRaises(requests.HTTPError):
                    amazon.buscar_ofertas()

    def test_revalidacao_reaproveita_lista_da_rodada_sem_novo_download(self):
        a, b, c, d = self._config()
        with a, b, c, d, patch.object(amazon, "_baixar_lista",
                                      return_value=HTML) as baixar:
            amazon.buscar_ofertas()
            oferta = amazon.revalidar_oferta({"oferta_id": "amazon_B0F9Z2DV83"})
        self.assertEqual(509.90, oferta["price"])
        baixar.assert_called_once()

    def test_revalidacao_baixa_de_novo_quando_leitura_expirou(self):
        a, b, c, d = self._config()
        with a, b, c, d, patch.object(amazon, "_baixar_lista",
                                      return_value=HTML) as baixar:
            amazon.buscar_ofertas()
            amazon._cache_lista["em"] -= amazon._VALIDADE_LISTA_SEGUNDOS + 1
            amazon.revalidar_oferta({"oferta_id": "amazon_B0F9Z2DV83"})
        self.assertEqual(2, baixar.call_count)

    def test_diagnostico_da_creators_api(self):
        with patch.object(amazon.config, "AMAZON_ASSOCIATE_TAG", "canaltabarato-20"), \
             patch.object(amazon, "_access_token", return_value="token"):
            with patch.object(amazon, "_chamar", return_value={"itemsResult": {"items": [{}]}}):
                self.assertEqual(("liberada", "1 produto(s) retornado(s)"), amazon.diagnosticar_api())
            erro = RuntimeError('Amazon recusou (403): {"code":"AssociateNotEligible","message":"x"}')
            with patch.object(amazon, "_chamar", side_effect=erro):
                self.assertEqual(("recusada", "403 AssociateNotEligible"), amazon.diagnosticar_api())
        resposta = Mock(status_code=401)
        with patch.object(amazon, "_access_token",
                          side_effect=amazon.requests.HTTPError(response=resposta)):
            self.assertEqual(("recusada", "credencial não aceita (401)"), amazon.diagnosticar_api())

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

    def test_api_revalida_por_asin_e_preco_antes_de_publicar(self):
        item = {"asin": "B0F9Z2DV83", "detailPageURL": "https://www.amazon.com.br/dp/B0F9Z2DV83",
                "itemInfo": {"title": {"displayValue": "Aspirador atualizado"}},
                "images": {"primary": {"large": {"url": "https://m.media-amazon.com/images/I/test.jpg"}}},
                "offersV2": {"listings": [{"price": {"money": {"amount": 99.9}},
                                           "availability": {"type": "IN_STOCK"}}]}}
        with patch.object(amazon.config, "AMAZON_LIST_URL", ""), \
             patch.object(amazon.config, "AMAZON_ASSOCIATE_TAG", "canaltabarato-20"), \
             patch.object(amazon, "_chamar", return_value={"itemsResult": {"items": [item]}}) as chamar:
            oferta = amazon.revalidar_oferta({"oferta_id": "amazon_B0F9Z2DV83", "price": 150})
        self.assertEqual(99.9, oferta["price"])
        self.assertEqual("getItems", chamar.call_args.args[0])
        self.assertEqual(["B0F9Z2DV83"], chamar.call_args.args[1]["itemIds"])

    def test_api_nao_publica_item_sem_preco_ou_fora_de_estoque(self):
        item = {"asin": "B0F9Z2DV83", "detailPageURL": "https://www.amazon.com.br/dp/B0F9Z2DV83",
                "offersV2": {"listings": [{"price": {"money": {"amount": 99.9}},
                                           "availability": {"type": "OUT_OF_STOCK"}}]}}
        with patch.object(amazon.config, "AMAZON_LIST_URL", ""), \
             patch.object(amazon, "_chamar", return_value={"itemsResult": {"items": [item]}}):
            self.assertIsNone(amazon.revalidar_oferta({"oferta_id": "amazon_B0F9Z2DV83"}))

    def test_api_usa_termo_rotativo_sem_aumentar_paginas(self):
        with patch.object(amazon.config, "AMAZON_KEYWORD", "fixo"), \
             patch.object(amazon.config, "AMAZON_KEYWORDS", ("celular", "notebook")), \
             patch.object(amazon.config, "AMAZON_PAGES", 3), \
             patch.object(amazon.captacao, "termo_da_rodada", return_value="notebook"), \
             patch.object(amazon, "_chamar", return_value={"searchResult": {"items": []}}) as chamar:
            self.assertEqual([], amazon._buscar_api())
        self.assertEqual(1, chamar.call_count)
        self.assertEqual("notebook", chamar.call_args.args[1]["keywords"])

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
