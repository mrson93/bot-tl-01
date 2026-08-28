import json
import unittest
from unittest.mock import patch

import shopee


class ShopeeSegurancaTest(unittest.TestCase):
    def test_keyword_e_codificada_como_string_graphql(self):
        keyword = 'fone" } mutation { apagarTudo } #'
        with patch.object(shopee.config, "SHOPEE_KEYWORD", keyword), \
             patch.object(shopee, "_executar", return_value={}) as executar:
            shopee._buscar_pagina(1, 0)
        query = executar.call_args.args[0]
        self.assertIn(
            f"keyword: {json.dumps(keyword, ensure_ascii=False)}",
            query,
        )

    def test_url_do_produto_e_codificada_como_string_graphql(self):
        url = 'https://produto.test/item?x="}) { ataque }'
        with patch.object(
            shopee,
            "_executar",
            return_value={"generateShortLink": {"shortLink": "https://s.test/x"}},
        ) as executar:
            shopee.gerar_link(url)
        query = executar.call_args.args[0]
        self.assertIn(
            f"originUrl: {json.dumps(url, ensure_ascii=False)}",
            query,
        )


if __name__ == "__main__":
    unittest.main()
