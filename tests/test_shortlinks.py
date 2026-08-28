import unittest
from datetime import datetime
from unittest.mock import patch

import shortlinks


class Resposta:
    status_code = 200

    def __init__(self, dados):
        self.dados = dados

    def json(self):
        return self.dados


class ShortlinksTest(unittest.TestCase):
    def test_cria_link_somente_na_origem_configurada(self):
        with patch.object(shortlinks.config, "SHORTLINK_API_URL",
                          "https://oferta.example/api"), \
             patch.object(shortlinks.config, "SHORTLINK_BASE_URL",
                          "https://oferta.example"), \
             patch.object(shortlinks.config, "SHORTLINK_API_TOKEN", "segredo"), \
             patch.object(shortlinks.requests, "post",
                          return_value=Resposta({"short_url": "https://oferta.example/abc"})):
            self.assertEqual("https://oferta.example/abc", shortlinks.criar(
                "https://s.click.aliexpress.com/e/x", "produto", "Telegram", "AliExpress"
            ))

    def test_rejeita_link_de_origem_diferente(self):
        with patch.object(shortlinks.config, "SHORTLINK_API_URL",
                          "https://oferta.example"), \
             patch.object(shortlinks.config, "SHORTLINK_BASE_URL",
                          "https://oferta.example"), \
             patch.object(shortlinks.config, "SHORTLINK_API_TOKEN", "segredo"), \
             patch.object(shortlinks.requests, "post",
                          return_value=Resposta({"short_url": "https://ataque.example/x"})):
            with self.assertRaisesRegex(RuntimeError, "fora do dominio"):
                shortlinks.criar("https://shope.ee/x", "produto", "Telegram", "Shopee")

    def test_relatorio_de_cliques_e_somente_agregado(self):
        resposta = Resposta({"total": 3, "by_channel": {"Telegram": 2},
                             "by_source": {"Shopee": 3},
                             "by_offer": {"shopee_1_2": 3}})
        with patch.object(shortlinks.config, "SHORTLINK_API_URL",
                          "https://oferta.example"), \
             patch.object(shortlinks.config, "SHORTLINK_API_TOKEN", "segredo"), \
             patch.object(shortlinks.requests, "get", return_value=resposta):
            resumo = shortlinks.resumo_cliques(datetime(2026, 8, 1),
                                                datetime(2026, 8, 2))
        self.assertEqual(3, resumo["total"])
        self.assertEqual({"shopee_1_2": 3}, resumo["por_oferta"])
        self.assertNotIn("ip", repr(resumo).lower())


if __name__ == "__main__":
    unittest.main()
