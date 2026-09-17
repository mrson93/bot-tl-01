import unittest
from unittest.mock import patch

import bluesky
import desempenho
import telegram_poster as telegram


class FormatacaoTest(unittest.TestCase):
    def test_chamada_humana_vai_direto_para_o_produto_sem_oferta_generica(self):
        oferta = {
            "fonte": "Shopee", "productName": "Panela antiaderente",
            "price": 79.9, "priceDiscountRate": 50, "variante": "A",
        }
        legenda = telegram.montar_legenda(oferta, "https://shope.ee/x")
        chamada = desempenho.chamada_humana(oferta)
        self.assertIn(f"{chamada}\n\n<b>Panela antiaderente</b>", legenda)
        self.assertNotIn("OFERTA", legenda)

        texto, _ = bluesky.montar_texto(oferta, "https://shope.ee/x")
        self.assertIn(f"{chamada}\n\nPanela antiaderente", texto)
        self.assertNotIn("OFERTA", texto)

    def test_variante_b_comeca_objetiva_sem_chamada_de_categoria(self):
        oferta = {
            "fonte": "Shopee", "productName": "Panela antiaderente",
            "price": 79.9, "priceDiscountRate": 50, "variante": "B",
        }
        with patch.object(telegram.experimentos.config,
                          "AB_TEST_ATIVO", True):
            legenda = telegram.montar_legenda(oferta, "https://shope.ee/x")
        self.assertNotIn("facilitar a rotina", legenda)
        self.assertNotIn("OFERTA", legenda)
        self.assertIn("<b>Panela antiaderente</b>\n\n💰", legenda)
        self.assertIn("Panela antiaderente", legenda)

        texto, _ = bluesky.montar_texto(oferta, "https://shope.ee/x")
        self.assertTrue(texto.startswith("Panela antiaderente\n\n💰"))
        self.assertNotIn("OFERTA", texto)

    def test_chamadas_respeitam_limites(self):
        self.assertEqual("", telegram.abertura(39))
        self.assertIn("OFERTA", telegram.abertura(40))
        self.assertIn("OFERTA", telegram.abertura(70))
        self.assertIn("BAIXOU MUITO", telegram.abertura(71))

    def test_nao_inventa_preco_original_nem_parcelamento(self):
        oferta = {"fonte": "Shopee", "productName": "Produto", "price": 50,
                  "priceDiscountRate": 50}
        legenda = telegram.montar_legenda(oferta, "https://exemplo.test")
        self.assertNotIn("De <s>", legenda)
        self.assertNotIn("Parcelamento", legenda)
        self.assertIn("R$ 50,00", legenda)

    def test_usa_preco_original_quando_real_e_maior(self):
        oferta = {"fonte": "Shopee", "productName": "Produto", "price": 50,
                  "precoOriginal": 100, "priceDiscountRate": 50}
        self.assertIn("De <s>R$ 100,00</s>", telegram.montar_legenda(oferta, "https://x.test"))

    def test_queda_que_antecipa_repeticao_e_explicada_nos_dois_canais(self):
        oferta = {"fonte": "Shopee", "productName": "Panela antiaderente",
                  "price": 80, "_motivo": "queda_preco",
                  "_preco_publicacao_anterior": 100, "variante": "B"}
        legenda = telegram.montar_legenda(oferta, "https://shope.ee/x")
        texto, _ = bluesky.montar_texto(oferta, "https://shope.ee/x")
        self.assertIn("Reapareceu porque caiu <b>20%</b>", legenda)
        self.assertIn("Reapareceu porque caiu 20%", texto)

    def test_post_normal_nao_recebe_aviso_de_repeticao(self):
        oferta = {"fonte": "Shopee", "productName": "Panela antiaderente",
                  "price": 80, "_motivo": "inedita",
                  "_preco_publicacao_anterior": 100}
        self.assertNotIn("Reapareceu", telegram.montar_legenda(oferta, "https://shope.ee/x"))

    def test_titulo_nao_e_cortado_no_separador(self):
        titulo = "Conjunto completo de acessórios: Teclado, mouse e headset gamer"
        self.assertEqual(titulo, telegram.limpar_titulo(titulo))

    def test_titulo_remove_etiqueta_promocional_e_respeita_limite(self):
        titulo = "【Novo 2025】Ventilador portátil " + "muito potente " * 20
        with patch.object(telegram.config, "TITULO_MAX_CARACTERES", 90):
            limpo = telegram.limpar_titulo(titulo)
        self.assertNotIn("Novo 2025", limpo)
        self.assertLessEqual(len(limpo), 90)
        self.assertTrue(limpo.endswith("…"))

    def test_amazon_usa_mesmo_formato_e_moeda_brasileira(self):
        oferta = {"fonte": "Amazon", "productName": "Pipoqueira elétrica",
                  "price": 109.23, "precoOriginal": 190,
                  "priceDiscountRate": 42, "variante": "B"}
        legenda = telegram.montar_legenda(oferta, "https://amazon.test/x")
        self.assertIn("R$ 109,23", legenda)
        self.assertIn("COMPRAR NA AMAZON", legenda)
        self.assertIn("#publi", legenda)
        self.assertNotIn("OFERTA", legenda)

    def test_bluesky_tambem_nao_inventa_preco_original(self):
        texto, _ = bluesky.montar_texto({"fonte": "Shopee", "productName": "Produto",
            "price": 50, "priceDiscountRate": 50}, "https://x.test")
        self.assertNotIn("De R$", texto)

    def test_link_do_telegram_e_escapado_no_html(self):
        oferta = {"fonte": "Shopee", "productName": "Produto", "price": 50}
        link = 'https://oferta.test/?busca="><b>ataque</b>'
        legenda = telegram.montar_legenda(oferta, link)
        self.assertNotIn('"><b>ataque</b>', legenda)
        self.assertIn('&quot;&gt;&lt;b&gt;ataque&lt;/b&gt;', legenda)

    def test_telegram_rejeita_link_que_nao_e_https(self):
        oferta = {"fonte": "Shopee", "productName": "Produto", "price": 50}
        with self.assertRaises(ValueError):
            telegram.montar_legenda(oferta, "javascript:alert(1)")

    def test_link_de_compartilhar_inseguro_e_omitido(self):
        oferta = {"fonte": "Shopee", "productName": "Produto", "price": 50}
        with patch.object(telegram.config, "LINK_COMPARTILHAR", "javascript:alert(1)"):
            legenda = telegram.montar_legenda(oferta, "https://oferta.test")
        self.assertNotIn("Compartilhe o canal", legenda)

    def test_oferta_tem_um_unico_caminho_de_compra_sem_compartilhamento(self):
        oferta = {"fonte": "Shopee", "productName": "Panela antiaderente",
                  "price": 50, "priceDiscountRate": 50}
        with patch.object(telegram.config, "LINK_COMPARTILHAR",
                          "https://t.me/CanalTaBarato"):
            legenda = telegram.montar_legenda(oferta, "https://oferta.test")
        self.assertIn(desempenho.chamada_humana(oferta), legenda)
        self.assertEqual(1, legenda.count("COMPRAR"))
        self.assertNotIn("Compartilhe", legenda)

    def test_cupom_e_preco_no_app_so_aparecem_quando_informados(self):
        oferta = {"fonte": "AliExpress", "productName": "Fone Bluetooth",
                  "price": 79.9, "precoOriginal": 99.9, "precoNoApp": True,
                  "cupom": "OFERTA20", "cupomCondicao": "R$ 20 acima de R$ 100"}
        legenda = telegram.montar_legenda(oferta, "https://oferta.test")
        self.assertIn("R$ 79,90</b> no app", legenda)
        self.assertIn("<code>OFERTA20</code>", legenda)
        self.assertIn("Ative o cupom no aplicativo", legenda)

        texto, _ = bluesky.montar_texto(oferta, "https://oferta.test")
        self.assertIn("R$ 79,90 no app", texto)
        self.assertIn("Cupom: OFERTA20", texto)
        self.assertIn("R$ 20 acima de R$ 100", texto)
        self.assertIn("Ative no app antes de finalizar", texto)

    def test_bluesky_coloca_compra_antes_da_reputacao_e_inclui_loja(self):
        oferta = {"fonte": "Shopee", "productName": "Tênis esportivo",
                  "price": 29, "ratingStar": 4.3, "sales": 5327,
                  "shopName": "Dulojashoes", "variante": "B"}
        texto, _ = bluesky.montar_texto(oferta, "https://oferta.test")
        self.assertIn("🏬 Dulojashoes", texto)
        self.assertLess(texto.index("🛒 Ver oferta"), texto.index("⭐ 4.3"))

    def test_bluesky_preserva_preco_compra_e_link_em_texto_extremo(self):
        oferta = {"fonte": "AliExpress", "productName": "Produto longo " * 30,
                  "price": 29, "precoNoApp": True, "ratingStar": 4.9,
                  "sales": 99999, "shopName": "Loja longa " * 10,
                  "cupom": "CUPOM123", "cupomCondicao": "Condição " * 20,
                  "variante": "A"}
        link = "https://oferta.test/" + "x" * 180
        texto, _ = bluesky.montar_texto(oferta, link)
        self.assertLessEqual(len(texto), 300)
        self.assertIn("R$ 29,00 no app", texto)
        self.assertIn("#publi", texto)
        self.assertIn(link, texto)
        self.assertLess(texto.index("R$ 29,00"), texto.index(link))

    def test_bluesky_inclui_reputacao_e_respeita_300_caracteres(self):
        oferta = {"fonte": "Shopee", "productName": "Fone Bluetooth " * 30,
                  "price": 50, "priceDiscountRate": 50,
                  "ratingStar": 4.8, "sales": 2000}
        texto, _ = bluesky.montar_texto(oferta, "https://oferta.test")
        self.assertIn("⭐ 4.8", texto)
        self.assertIn("2.000 vendidos", texto)
        self.assertLessEqual(len(texto), 300)

    def test_preco_e_reputacao_ficam_separados_por_linha_vazia(self):
        oferta = {"fonte": "Shopee", "productName": "Tênis esportivo",
                  "price": 29, "priceDiscountRate": 42, "variante": "B",
                  "ratingStar": 4.3, "sales": 5327, "shopName": "Loja"}
        legenda = telegram.montar_legenda(oferta, "https://oferta.test")
        self.assertIn("42% OFF\n\n⭐ 4.3", legenda)

        texto, _ = bluesky.montar_texto(oferta, "https://oferta.test")
        self.assertIn("42% OFF\n\n🛒 Ver oferta", texto)
        self.assertIn("https://oferta.test\n\n⭐ 4.3", texto)


if __name__ == "__main__":
    unittest.main()
