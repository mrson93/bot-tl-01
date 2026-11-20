import unittest
from unittest import mock

import aliexpress
import config
import monitor_precos as mp
import telegram_poster


def resposta(produtos):
    return {"aliexpress_affiliate_productdetail_get_response": {"resp_result": {"result": {
        "products": {"product": produtos}}}}}


class LeituraAliexpressTest(unittest.TestCase):
    def test_le_em_lotes_usa_preco_normal_e_marca_indisponivel_quando_some(self):
        primeiro = resposta([{"product_id": 1005000000001, "product_title": " Fone  Bluetooth ",
                              "target_sale_price": "89.90", "target_app_sale_price": "79.90",
                              "target_original_price": "150.00",
                              "product_main_image_url": "https://ae01.alicdn.com/a.jpg",
                              "first_level_category_name": "Eletrônicos"}])
        segundo = resposta({"product_id": 1005000000003, "target_sale_price": "", "sale_price": None})
        with mock.patch.object(aliexpress, "_chamar", side_effect=[primeiro, segundo]) as chamar:
            leituras = aliexpress.consultar_monitor(["1005000000001", "1005000000002", "1005000000003", "xx"], lote=2)
        self.assertEqual(chamar.call_count, 2)
        self.assertEqual(chamar.call_args_list[0].args[1]["product_ids"], "1005000000001,1005000000002")
        lido = leituras["1005000000001"]
        self.assertEqual((lido["preco"], lido["preco_antigo"], lido["nome"]), (89.9, 150.0, "Fone Bluetooth"))
        self.assertEqual(lido["url"], "https://pt.aliexpress.com/item/1005000000001.html")
        self.assertTrue(lido["disponivel"])
        self.assertFalse(leituras["1005000000002"]["disponivel"])
        self.assertFalse(leituras["1005000000003"]["disponivel"])
        self.assertNotIn("xx", leituras)

    def test_coleta_inclui_aliexpress_e_conta_erro_da_api(self):
        produtos = [{"id": 8, "loja": "aliexpress", "id_produto": "1005000000001"}]
        with mock.patch.object(aliexpress, "esta_configurada", return_value=True), \
             mock.patch.object(aliexpress, "consultar_monitor",
                               return_value={"1005000000001": {"preco": 50, "disponivel": True}}):
            leituras, erros = mp.coletar(produtos, pausa=0)
        self.assertEqual((leituras[8]["preco"], erros), (50, 0))
        with mock.patch.object(aliexpress, "esta_configurada", return_value=True), \
             mock.patch.object(aliexpress, "consultar_monitor", side_effect=RuntimeError("fora")):
            leituras, erros = mp.coletar(produtos, pausa=0)
        self.assertEqual((leituras, erros), ({}, 1))

    def test_link_de_afiliado_pela_api(self):
        produto = {"loja": "aliexpress", "id_produto": "1005000000001"}
        with mock.patch.object(aliexpress, "gerar_link", return_value="https://s.click.aliexpress.com/e/_abc") as gerar:
            link = mp._link_afiliado(produto, {"url": "https://pt.aliexpress.com/item/1005000000001.html"})
        self.assertEqual(link, "https://s.click.aliexpress.com/e/_abc")
        gerar.assert_called_once_with("https://pt.aliexpress.com/item/1005000000001.html")

    def test_botao_do_canal_para_aliexpress(self):
        with mock.patch.object(config, "ALERTA_BOT_BOTAO_POSTS", True), \
             mock.patch.object(config, "ALERTA_BOT_USUARIO", "TaBaratoAlertaDePrecoBot"):
            self.assertEqual(telegram_poster.link_alerta({"oferta_id": "aliexpress_1005003214550744"}),
                             "https://t.me/TaBaratoAlertaDePrecoBot?start=ae_1005003214550744")
            self.assertEqual(telegram_poster.link_alerta({"oferta_id": "aliexpress_abc"}), "")


class VariacoesECupomTest(unittest.TestCase):
    def test_cupom_valido_vencido_e_invalido(self):
        futuro = "2999-12-31T23:59:59+00:00"
        self.assertEqual(aliexpress.cupom_do_produto({"promo_code_info": {
            "promo_code": "APP20", "code_value": " R$ 20  off ", "code_availabletime_end": futuro}}),
            {"codigo": "APP20", "condicao": "R$ 20 off", "expira_em": 32503679999})
        self.assertIsNone(aliexpress.cupom_do_produto({"promo_code_info": {
            "promo_code": "VELHO", "code_availabletime_end": "1000"}}))
        self.assertIsNone(aliexpress.cupom_do_produto({"promo_code_info": [{"promo_code": "<x>"}]}))
        self.assertIsNone(aliexpress.cupom_do_produto({}))

    def test_leitura_do_aliexpress_leva_o_cupom_e_some_quando_nao_ha(self):
        com = resposta([{"product_id": 1005000000001, "target_sale_price": "50",
                         "promo_code_info": {"promo_code": "APP20", "code_value": "R$ 20"}}])
        with mock.patch.object(aliexpress, "_chamar", return_value=com):
            lido = aliexpress.consultar_monitor(["1005000000001", "1005000000002"])
        self.assertEqual(lido["1005000000001"]["cupom"]["codigo"], "APP20")
        self.assertIsNone(lido["1005000000002"]["cupom"])

    def test_shopee_guarda_o_maior_preco_das_variacoes(self):
        import shopee
        respostas = [{"productOfferV2": {"nodes": [{"shopId": 1, "itemId": 2, "price": "89.9",
                                                    "priceMin": "89.9", "priceMax": "129.9"}]}},
                     {"productOfferV2": {"nodes": [{"shopId": 3, "itemId": 4, "price": "50",
                                                    "priceMin": "50", "priceMax": "50"}]}}]
        with mock.patch.object(shopee, "_executar", side_effect=respostas):
            lido = shopee.consultar_monitor(["1_2", "3_4"], pausa=0)
        self.assertEqual((lido["1_2"]["preco"], lido["1_2"]["preco_max"]), (89.9, 129.9))
        self.assertIsNone(lido["3_4"]["preco_max"])

    def test_site_so_recebe_os_campos_que_a_loja_informa(self):
        self.assertEqual(mp._leitura_para_o_site(1, {"preco": 10, "disponivel": True}),
                         {"produto_id": 1, "preco": 10, "preco_antigo": None, "disponivel": True})
        self.assertEqual(mp._leitura_para_o_site(2, {"preco": 10, "disponivel": 1, "preco_max": None, "cupom": None}),
                         {"produto_id": 2, "preco": 10, "preco_antigo": None, "disponivel": True,
                          "preco_max": None, "cupom": None})
