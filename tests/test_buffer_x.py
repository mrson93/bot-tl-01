import os
import unittest
from unittest.mock import patch

import buffer_x


class BufferXTest(unittest.TestCase):
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
        self.assertLessEqual(len(texto), 280)
        self.assertIn("https://go.canaltabarato.com.br/abc", texto)
        self.assertIn("R$ 129,90", texto)
        self.assertIn("🛒 Publicidade · COMPRAR NA LOJA:", texto)
        self.assertNotIn("Link de afiliado", texto)
        self.assertNotIn("…", texto)

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
        self.assertIn("🛒 #publi · COMPRAR NA AMAZON:", texto)


if __name__ == "__main__":
    unittest.main()
