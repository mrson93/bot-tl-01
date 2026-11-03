import os
import unittest
from unittest.mock import patch

import buffer_x


class BufferXTest(unittest.TestCase):
    def test_limite_do_x_por_turno_e_24_horas(self):
        with patch.object(buffer_x, "esta_configurada", return_value=True), \
             patch.object(buffer_x.turnos, "janela", return_value=("manha", 100, 200)), \
             patch.object(buffer_x.store, "posts_canal_entre", return_value=8):
            self.assertFalse(buffer_x.pode_publicar())
        with patch.object(buffer_x, "esta_configurada", return_value=True), \
             patch.object(buffer_x.turnos, "janela", return_value=("tarde", 100, 200)), \
             patch.object(buffer_x.store, "posts_canal_entre", return_value=14), \
             patch.object(buffer_x.store, "posts_canal_desde", return_value=44):
            self.assertTrue(buffer_x.pode_publicar())
    def configuracao(self):
        return patch.dict(os.environ, {
            "BUFFER_X_API_KEY": "buffer-chave-secreta-comprida",
            "BUFFER_X_CHANNEL_ID": "6aa9ceb2ea19ca0bde50aefa",
        }, clear=False)

    def test_monta_texto_dentro_do_limite_com_link(self):
        oferta = {
            "productName": "Produto muito interessante " * 20,
            "price": 129.90,
            "priceDiscountRate": 45,
        }
        texto = buffer_x.montar_texto(oferta, "https://go.canaltabarato.com.br/abc")
        self.assertLessEqual(buffer_x._comprimento_x(texto), 280)
        self.assertIn("https://go.canaltabarato.com.br/abc", texto)
        self.assertIn("R$ 129,90", texto)
        self.assertIn("🛒 #ad · COMPRAR NA LOJA:", texto)
        self.assertNotIn("Link de afiliado", texto)
        self.assertNotIn("…", texto)
        self.assertIn(":\n\nhttps://go.canaltabarato.com.br/abc", texto)

    def test_prioriza_preco_link_e_cupom_quando_precisa_encurtar(self):
        oferta = {
            "fonte": "Mercado Livre", "productName": "Produto " * 100,
            "price": 79.90, "priceDiscountRate": 50, "cupom": "BARATO20",
            "variante": "A",
        }
        texto = buffer_x.montar_texto(
            oferta, "https://go.canaltabarato.com.br/abcdefgh"
        )
        self.assertLessEqual(len(texto), 280)
        self.assertIn("R$ 79,90", texto)
        self.assertIn("BARATO20", texto)
        self.assertIn("https://go.canaltabarato.com.br/abcdefgh", texto)

    def test_emojis_contam_dois_caracteres_como_no_x(self):
        self.assertEqual(4, buffer_x._comprimento_x("💰ℹ️"))
        self.assertEqual(3, buffer_x._comprimento_x("Pão"))
        oferta = {
            "productName": "Chaleira Elétrica de Inox 1.8 Litros " * 6,
            "price": 79.90, "precoOriginal": 129.90, "ratingStar": 4.8,
            "sales": 12000, "shopName": "Loja Oficial", "cupom": "BARATO20",
            "cupomCondicao": "Válido em compras acima de R$ 100",
        }
        texto = buffer_x.montar_texto(oferta, "https://go.canaltabarato.com.br/abc")
        self.assertLessEqual(buffer_x._comprimento_x(texto), 280)

    def test_selo_black_friday_abre_o_post_em_todas_as_redes(self):
        import facebook
        import telegram_poster
        oferta = {
            "fonte": "Amazon", "blackFriday": True,
            "productName": "Robô Aspirador WAP " * 8, "price": 509.90,
            "precoOriginal": 1199.90, "shopName": "WAP",
        }
        link = "https://go.canaltabarato.com.br/abc"
        selo = "🖤 Oferta Black Friday da Amazon"
        texto_x = buffer_x.montar_texto(oferta, link)
        self.assertTrue(texto_x.startswith(selo))
        self.assertLessEqual(buffer_x._comprimento_x(texto_x), 280)
        self.assertTrue(telegram_poster.montar_legenda(oferta, link).startswith(selo))
        self.assertIn(selo, facebook.montar_texto(oferta, link))
        sem_selo = dict(oferta, blackFriday=False)
        self.assertNotIn("Black Friday", buffer_x.montar_texto(sem_selo, link))

    def test_link_oficial_longo_conta_como_tco_sem_perder_atribuicao(self):
        oferta = {
            "fonte": "Mercado Livre", "productName": "Produto " * 100,
            "price": 79.90, "priceDiscountRate": 50,
        }
        link = (
            "https://www.mercadolivre.com.br/produto/p/MLB123"
            "?matt_tool=71195511#source=lists&tracking_id=canal&wid=MLB123"
        )
        texto = buffer_x.montar_texto(oferta, link)
        self.assertLessEqual(buffer_x._comprimento_x(texto), 280)
        self.assertIn(link, texto)
        self.assertIn("matt_tool=71195511", texto)
        self.assertIn("tracking_id=canal", texto)

    def test_publica_card_no_canal_x_do_buffer(self):
        oferta = {"productName": "Produto", "price": 50,
                  "imageUrl": "https://imagem.test/produto.jpg"}
        with self.configuracao(), \
             patch.object(buffer_x.feed_card, "gerar", return_value=b"jpeg"), \
             patch.object(buffer_x.buffer_api, "publicar_confirmado") as publicar:
            buffer_x.postar(oferta, "https://oferta.test/comprar")
        publicar.assert_called_once()
        self.assertEqual("X", publicar.call_args.args[1])

    def test_configuracao_exige_id_valido(self):
        with patch.dict(os.environ, {
            "BUFFER_X_API_KEY": "buffer-chave-secreta-comprida",
            "BUFFER_X_CHANNEL_ID": "invalido",
        }, clear=False):
            self.assertFalse(buffer_x.esta_configurada())

    def test_reutiliza_chave_do_facebook_apos_conectar_x_na_mesma_conta(self):
        with patch.dict(os.environ, {
            "BUFFER_API_KEY": "buffer-chave-do-facebook-comprida",
            "BUFFER_X_API_KEY": "",
            "BUFFER_X_CHANNEL_ID": "6aac89b3ea19ca0bde718fb6",
        }, clear=False):
            self.assertTrue(buffer_x.esta_configurada())
            self.assertEqual("buffer-chave-do-facebook-comprida", buffer_x._chave())

    def test_publi_no_x_apenas_para_amazon(self):
        oferta = {"fonte": "Amazon", "productName": "Produto", "price": 50}
        texto = buffer_x.montar_texto(oferta, "https://oferta.test")
        self.assertIn("🛒 #ad · COMPRAR NA AMAZON:", texto)


if __name__ == "__main__":
    unittest.main()
