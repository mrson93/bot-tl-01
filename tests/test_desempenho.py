import unittest

import desempenho


class DesempenhoTest(unittest.TestCase):
    def test_garrafa_termica_recebe_chamada_especifica(self):
        oferta = {"productName": "Garrafa Térmica Inox 1 litro"}
        self.assertEqual("hidratacao", desempenho.categoria_produto(oferta))
        self.assertIn(desempenho.chamada_humana(oferta), desempenho.chamadas_categoria("hidratacao"))

    def test_detecta_produtos_muito_parecidos_sem_confundir_categorias(self):
        self.assertTrue(desempenho.produtos_semelhantes(
            "Fone Bluetooth Lenovo LP40 sem fio",
            "Fone Bluetooth Lenovo LP40 original",
        ))
        self.assertFalse(desempenho.produtos_semelhantes(
            "Fone Bluetooth Lenovo LP40", "Panela antiaderente 24 cm"
        ))

    def test_geracao_nao_e_confundida_com_racao(self):
        echo = {"productName": "Echo Dot 5 Geração Alto Falante com Alexa"}
        ipad = {"productName": "Apple iPad 11 Geração A16 128GB"}
        self.assertEqual("eletronicos", desempenho.categoria_produto(echo))
        self.assertEqual("eletronicos", desempenho.categoria_produto(ipad))
        self.assertIn(desempenho.chamada_humana(echo), desempenho.chamadas_categoria("eletronicos"))

    def test_palavras_de_pet_continuam_funcionando_quando_inteiras(self):
        self.assertEqual("pet", desempenho.categoria_produto("Ração para cachorro"))
        self.assertNotEqual("pet", desempenho.categoria_produto("Produto geração nova"))

    def test_classifica_titulo_com_acento_e_gera_chamada(self):
        oferta = {"productName": "Parafusadeira elétrica com bateria"}
        self.assertEqual("ferramentas", desempenho.categoria_produto(oferta))
        self.assertIn(desempenho.chamada_humana(oferta), desempenho.chamadas_categoria("ferramentas"))

    def test_todas_as_categorias_tem_dez_chamadas_e_escolha_estavel(self):
        for categoria, frases, _ in desempenho._REGRAS:
            self.assertGreaterEqual(len(frases), 10, categoria)
        oferta = {"productName": "Fone Bluetooth sem fio", "oferta_id": "fone-1"}
        self.assertEqual(desempenho.chamada_humana(oferta), desempenho.chamada_humana(oferta))

    def test_categoria_desconhecida_nao_inventa_chamada(self):
        oferta = {"productName": "Produto sem classificação"}
        self.assertEqual("outros", desempenho.categoria_produto(oferta))
        self.assertEqual("", desempenho.chamada_humana(oferta))

    def test_lustre_para_cozinha_continua_sendo_item_de_casa(self):
        oferta = {"productName": "Lustre LED para sala e cozinha no teto"}
        self.assertEqual("casa", desempenho.categoria_produto(oferta))
        self.assertIn(desempenho.chamada_humana(oferta),
                      desempenho.chamadas_categoria("casa"))

    def test_produto_casa_limpa_nao_recebe_chamada_de_beleza(self):
        oferta = {"productName": "Kit Casa Limpa Coala perfumes para limpeza"}
        self.assertNotEqual("beleza", desempenho.categoria_produto(oferta))
        self.assertNotIn(desempenho.chamada_humana(oferta),
                         desempenho.chamadas_categoria("beleza"))

    def test_faixas_comerciais(self):
        self.assertEqual("ate R$ 50", desempenho.faixa_preco(49.99))
        self.assertEqual("R$ 50 a R$ 150", desempenho.faixa_preco(50))
        self.assertEqual("acima de R$ 150", desempenho.faixa_preco(150))
        self.assertEqual("ate 39%", desempenho.faixa_desconto(39))
        self.assertEqual("40% a 69%", desempenho.faixa_desconto(40))
        self.assertEqual("70% ou mais", desempenho.faixa_desconto(70))


if __name__ == "__main__":
    unittest.main()
