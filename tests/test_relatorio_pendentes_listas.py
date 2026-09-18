import unittest
from unittest.mock import Mock

import relatorio_pendentes_listas as relatorio


class RelatorioPendentesListasTest(unittest.TestCase):
    def test_lista_apenas_ineditos_priorizando_desconto(self):
        fonte = Mock()
        fonte.buscar_ofertas.return_value = [
            {"oferta_id": "a", "productName": "Publicado", "priceDiscountRate": 90},
            {"oferta_id": "b", "productName": "Menor", "priceDiscountRate": 20},
            {"oferta_id": "c", "productName": "Maior", "priceDiscountRate": 45},
        ]
        total, pendentes = relatorio.pendentes_da_fonte(fonte, {"a"})
        self.assertEqual(3, total)
        self.assertEqual(["c", "b"], [item["oferta_id"] for item in pendentes])


if __name__ == "__main__":
    unittest.main()
