import os
import unittest
from unittest.mock import patch

import buffer_x


class BufferXTest(unittest.TestCase):
    def configuracao(self):
        return patch.dict(os.environ, {
            "BUFFER_API_KEY": "buffer-chave-secreta-comprida",
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
        self.assertNotIn("…", texto)

    def test_publica_card_no_canal_x_do_buffer(self):
        oferta = {"productName": "Produto", "price": 50,
                  "imageUrl": "https://imagem.test/produto.jpg"}
        with self.configuracao(), \
             patch.object(buffer_x.feed_card, "gerar", return_value=b"jpeg"), \
             patch.object(buffer_x.buffer_api, "publicar_no_canal") as publicar:
            buffer_x.postar(oferta, "https://oferta.test/comprar")
        publicar.assert_called_once()
        self.assertEqual("6aa9ceb2ea19ca0bde50aefa", publicar.call_args.args[3])
        self.assertNotIn("metadata", publicar.call_args.kwargs)

    def test_configuracao_exige_id_valido(self):
        with patch.dict(os.environ, {
            "BUFFER_API_KEY": "buffer-chave-secreta-comprida",
            "BUFFER_X_CHANNEL_ID": "invalido",
        }, clear=False):
            self.assertFalse(buffer_x.esta_configurada())


if __name__ == "__main__":
    unittest.main()
