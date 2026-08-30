import unittest
from unittest.mock import patch

import experimentos


class ExperimentosTest(unittest.TestCase):
    def test_variante_e_deterministica_e_nao_depende_de_comprador(self):
        oferta = {"oferta_id": "produto-123"}
        with patch.object(experimentos.config, "AB_TEST_ATIVO", True), \
             patch.object(experimentos.config, "AB_TEST_NOME", "teste"):
            primeira = experimentos.atribuir(oferta)
            segunda = experimentos.atribuir(dict(oferta))
        self.assertIn(primeira, {"A", "B"})
        self.assertEqual(primeira, segunda)

    def test_variante_b_remove_chamada_humana(self):
        with patch.object(experimentos.config, "AB_TEST_ATIVO", True):
            self.assertFalse(experimentos.usa_chamada_humana({"variante": "B"}))
            self.assertTrue(experimentos.usa_chamada_humana({"variante": "A"}))

    def test_categoria_incerta_nao_entra_no_teste_ab(self):
        oferta = {"oferta_id": "produto-123", "categoria": "outros"}
        with patch.object(experimentos.config, "AB_TEST_ATIVO", True):
            resultado = experimentos.aplicar(oferta)
        self.assertEqual(resultado["variante"], "controle")
        self.assertIsNone(resultado["experimento"])
