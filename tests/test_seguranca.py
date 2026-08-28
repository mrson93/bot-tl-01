import unittest
from unittest.mock import patch

import config
import seguranca


class SegurancaTest(unittest.TestCase):
    def test_redige_segredos_configurados_e_token_em_url(self):
        erro = (
            "falhou com segredo-app e "
            "https://api.telegram.org/bot123456:ABC-def/sendMessage"
        )
        with patch.object(config, "SHOPEE_SECRET", "segredo-app"):
            seguro = seguranca.redigir_segredos(erro)
        self.assertNotIn("segredo-app", seguro)
        self.assertNotIn("123456:ABC-def", seguro)
        self.assertIn("[SEGREDO]", seguro)

    def test_url_precisa_ser_https_publica(self):
        self.assertEqual(
            "https://oferta.test/produto",
            seguranca.validar_url_https_publica("https://oferta.test/produto"),
        )
        for url in (
            "http://oferta.test/produto",
            "https://127.0.0.1/imagem.jpg",
            "https://192.168.1.10/imagem.jpg",
            "https://usuario:senha@oferta.test/produto",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                seguranca.validar_url_https_publica(url)


if __name__ == "__main__":
    unittest.main()
