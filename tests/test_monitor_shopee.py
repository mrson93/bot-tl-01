import unittest
from unittest import mock

import config
import monitor_precos as mp
import shopee
import telegram_poster


class LeituraShopeeTest(unittest.TestCase):
    def test_le_preco_e_marca_indisponivel_quando_some(self):
        respostas = [
            {"productOfferV2": {"nodes": [{"shopId": 1, "itemId": 2, "productName": " Fone  X ",
                                           "price": "89.9", "imageUrl": "https://cf.shopee.com.br/a",
                                           "productLink": "https://shopee.com.br/product/1/2"}]}},
            {"productOfferV2": {"nodes": []}},
        ]
        with mock.patch.object(shopee, "_executar", side_effect=respostas):
            leituras = shopee.consultar_monitor(["1_2", "3_4", "invalido"], pausa=0)
        self.assertEqual(leituras["1_2"]["preco"], 89.9)
        self.assertEqual(leituras["1_2"]["nome"], "Fone X")
        self.assertTrue(leituras["1_2"]["disponivel"])
        self.assertFalse(leituras["3_4"]["disponivel"])
        self.assertNotIn("invalido", leituras)

    def test_coleta_inclui_shopee(self):
        produtos = [{"id": 5, "loja": "shopee", "id_produto": "1_2"}]
        with mock.patch.object(shopee, "esta_configurada", return_value=True), \
             mock.patch.object(shopee, "consultar_monitor", return_value={"1_2": {"preco": 50, "disponivel": True}}):
            leituras, erros = mp.coletar(produtos, pausa=0)
        self.assertEqual(leituras[5]["preco"], 50)
        self.assertEqual(erros, 0)

    def test_link_da_shopee_leva_a_origem_no_subid(self):
        produto = {"loja": "shopee", "id_produto": "1_2", "link_afiliado": "https://s.shopee.com.br/velho"}
        with mock.patch.object(shopee, "gerar_link", return_value="https://s.shopee.com.br/novo") as gerar, \
             mock.patch.object(mp.shortlinks, "esta_configurado", return_value=False):
            link = mp._link_rastreado(produto, {"url": "https://shopee.com.br/product/1/2"}, "alerta")
        self.assertEqual(link, "https://s.shopee.com.br/novo")
        gerar.assert_called_once_with("https://shopee.com.br/product/1/2", "alerta")


class BotaoAlertaTest(unittest.TestCase):
    def test_link_do_bot_por_loja(self):
        self.assertEqual(telegram_poster.link_alerta({"oferta_id": "mercadolivre_MLB123"}),
                         "https://t.me/TaBaratoAlertaDePrecoBot?start=ml_MLB123")
        self.assertEqual(telegram_poster.link_alerta({"oferta_id": "shopee_17_23"}),
                         "https://t.me/TaBaratoAlertaDePrecoBot?start=sp_17_23")
        self.assertEqual(telegram_poster.link_alerta({"oferta_id": "amazon_B0C1234567"}), "")
        with mock.patch.object(config, "ALERTA_BOT_BOTAO_POSTS", False):
            self.assertEqual(telegram_poster.link_alerta({"oferta_id": "shopee_17_23"}), "")

    def test_post_do_canal_ganha_o_botao(self):
        oferta = {"oferta_id": "shopee_17_23", "productName": "Fone", "price": 50, "fonte": "Shopee",
                  "imageUrl": "https://cf.shopee.com.br/a"}
        with mock.patch.object(telegram_poster.requests, "post") as post, \
             mock.patch.object(telegram_poster, "montar_legenda", return_value="x"):
            post.return_value.json.return_value = {"ok": True}
            telegram_poster.postar(oferta, "https://s.shopee.com.br/abc")
        linhas = post.call_args.kwargs["json"]["reply_markup"]["inline_keyboard"]
        self.assertEqual(linhas[1][0]["text"], "🔔 Avisar quando baixar")
        self.assertTrue(linhas[1][0]["url"].endswith("?start=sp_17_23"))


if __name__ == "__main__":
    unittest.main()
