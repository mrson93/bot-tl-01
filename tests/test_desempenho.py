import unittest

import desempenho


class DesempenhoTest(unittest.TestCase):
    def test_replica_de_marca_e_detectada_mas_acessorio_e_loja_da_marca_passam(self):
        replica = {"productName": "Fone de Ouvido Sem Fio Airpods PRO Bluetooth para iOS Android",
                   "shopName": "SORTUDO 1666"}
        copo = {"productName": "Copo Térmico tipo Stanley 1L", "shopName": "Casa Bela"}
        capa = {"productName": "Capa para iPhone 15 Pro Max", "shopName": "Cases BR"}
        oficial = {"productName": "Caixa de Som JBL Go 4", "shopName": "JBL Oficial"}
        comum = {"productName": "Fone Bluetooth sem fio com estojo", "shopName": "Loja X"}
        estojo_depois = {"productName": "Fone Airpods Pro com estojo de carga",
                         "shopName": "Loja X"}
        estojo_antes = {"productName": "Estojo protetor para AirPods Pro", "shopName": "Loja X"}
        self.assertTrue(desempenho.parece_replica(estojo_depois))
        self.assertFalse(desempenho.parece_replica(estojo_antes))
        self.assertTrue(desempenho.parece_replica(replica))
        self.assertTrue(desempenho.parece_replica(copo))
        self.assertFalse(desempenho.parece_replica(capa))
        self.assertFalse(desempenho.parece_replica(oficial))
        self.assertFalse(desempenho.parece_replica(comum))

    def test_loja_oficial_pelo_nome(self):
        self.assertTrue(desempenho.loja_oficial({"shopName": "Mondial Loja Oficial"}))
        self.assertTrue(desempenho.loja_oficial({"shopName": "Xiaomi Official Store"}))
        self.assertFalse(desempenho.loja_oficial({"shopName": "SORTUDO 1666"}))

    def test_chave_metaforica_nao_e_ferramenta(self):
        oferta = {"productName": "O Poder do Autocontrole: A Chave para a Grandeza Pessoal"}
        self.assertEqual("outros", desempenho.categoria_produto(oferta))
        self.assertEqual("", desempenho.chamada_humana(oferta))
        self.assertEqual("ferramentas", desempenho.categoria_produto("Chave de fenda"))

    def test_livro_tem_prioridade_sobre_assunto_e_categoria_anterior(self):
        for titulo in ("Livro Construção da Casa", "Livro Cozinha e Panela",
                       "Livro Ferramentas da Mente", "Autocontrole capa dura"):
            oferta = {"productName": titulo, "categoria": "casa"}
            self.assertEqual("livros", desempenho.categoria_produto(oferta))
            self.assertIn(desempenho.chamada_humana(oferta),
                          desempenho.chamadas_categoria("livros"))
        self.assertNotEqual("livros", desempenho.categoria_produto("Prateleira para livros"))

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

    def test_classifica_celulares_smartwatch_e_suplementos(self):
        self.assertEqual("eletronicos", desempenho.categoria_produto(
            "Smartphone Motorola Moto G35 5G"
        ))
        self.assertEqual("eletronicos", desempenho.categoria_produto(
            "Relógio Inteligente Smart Watch T800"
        ))
        self.assertEqual("esporte", desempenho.categoria_produto(
            "Creatina suplemento monohidratada 100% pura"
        ))


if __name__ == "__main__":
    unittest.main()
