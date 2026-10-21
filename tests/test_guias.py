import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import guias
import store

PAUTA = guias.PAUTAS[0]  # air fryer até R$ 600


def produto(n, **extra):
    base = {"fonte": "Shopee", "productName": f"Fritadeira Air Fryer Modelo {n} 5L 1500W Bivolt",
            "price": "299.90", "ratingStar": "4.8", "sales": 1200, "priceDiscountRate": 30,
            "shopName": f"Loja {n}", "productUrl": f"https://shopee.com.br/p{n}",
            "imageUrl": f"https://cf.shopee.com.br/{n}.jpg", "oferta_id": f"shopee_1_{n}"}
    base.update(extra)
    return base


class GuiasTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = patch.object(store, "_DB", Path(self.tmp.name) / "estado.db")
        self.db.start()

    def tearDown(self):
        self.db.stop()
        self.tmp.cleanup()

    def test_ficha_vem_apenas_do_titulo(self):
        ficha = guias.extrair_ficha("Air Fryer Mondial 5,5L 1500W 220V")
        self.assertEqual({"Capacidade": "5,5 L", "Potência": "1500 W", "Voltagem": "220V"}, ficha)
        self.assertEqual({"Capacidade": "20.000 mAh"},
                         guias.extrair_ficha("Power Bank 20000mAh carga rápida"))
        self.assertEqual({}, guias.extrair_ficha("Fritadeira elétrica preta"))

    def test_selecao_filtra_qualidade_preco_acessorios_e_lojas_repetidas(self):
        marcas = ("Mondial", "Philco", "Britânia", "Electrolux")
        bons = [produto(i, productName=f"Air Fryer {marca} {i + 2}L", sales=1000 + i)
                for i, marca in enumerate(marcas, start=1)]
        bons.append(produto(9, productName="Air Fryer Mondial 3L", shopName="Loja 9"))  # repetido
        ruins = [
            produto(10, price="900"),  # acima da faixa
            produto(11, ratingStar="4.1"),  # avaliação baixa
            produto(12, sales=10),  # poucas vendas
            produto(13, productName="Forma de silicone para Air Fryer"),  # acessório
            produto(14, shopName="Loja 2", productName="Air Fryer Outra 3L"),  # loja repetida
            produto(15, productName="Fone Bluetooth"),  # fora do tema
        ]
        escolhidos = guias.selecionar(bons + ruins, PAUTA)
        self.assertEqual(4, len(escolhidos))
        titulos = [p["productName"] for p in escolhidos]
        self.assertEqual(len(titulos), len(set(titulos)))  # duplicado barrado
        self.assertEqual(4, len({p["shopName"] for p in escolhidos}))
        self.assertFalse({"shopee_1_10", "shopee_1_11", "shopee_1_12", "shopee_1_13",
                          "shopee_1_15"} & {p["oferta_id"] for p in escolhidos})

    def test_guia_tem_resposta_rapida_tabela_cards_e_metodologia(self):
        produtos = [produto(i, productName=f"Air Fryer Marca{i} {i + 2}L 1500W",
                            price=str(150 + i * 50), sales=500 * i) for i in range(1, 5)]
        links = {id(p): f"https://s.shopee.com.br/link{i}" for i, p in enumerate(produtos)}
        with patch.object(guias.config, "BLOG_GUIAS_STATUS", "published"):
            guia = guias.montar_guia(PAUTA, produtos, links,
                                     datetime(2026, 10, 21, 10, tzinfo=guias.FUSO))
        corpo = guia["body_markdown"]
        self.assertEqual("melhor-air-fryer-ate-600-reais", guia["slug"])
        self.assertIn("outubro de 2026", guia["title"])
        self.assertIn("## Resposta rápida", corpo)
        self.assertIn("{{editorial-comparison-table}}", corpo)
        for indice in range(1, 5):
            self.assertIn(f"{{{{product:p{indice}}}}}", corpo)
        self.assertIn("## Como montamos este guia", corpo)
        self.assertIn("Não fazemos teste físico", corpo)
        self.assertIn("**Menor preço:** Air Fryer Marca1", corpo)
        self.assertEqual(4, len(guia["products"]))
        primeiro = guia["products"][0]
        self.assertEqual("R$ 200,00", primeiro["price_label"])
        self.assertEqual("https://s.shopee.com.br/link0", primeiro["links"][0]["affiliate_url"])
        self.assertEqual("Ver na Shopee", primeiro["links"][0]["label"])
        self.assertEqual(["Avaliação", "Vendidos"], list(primeiro["specs"])[:2])
        self.assertEqual("published", guia["status"])

    def test_rodizio_prioriza_pauta_inedita_e_respeita_intervalo(self):
        agora = 2_000_000_000
        for pauta in guias.PAUTAS[1:]:
            store._definir_estado(f"guia_atualizado:{pauta['slug']}", agora - 86400)
        self.assertEqual(guias.PAUTAS[0]["slug"], guias.proxima_pauta(agora)["slug"])
        store._definir_estado(f"guia_atualizado:{guias.PAUTAS[0]['slug']}", agora)
        self.assertIsNone(guias.proxima_pauta(agora))

    def test_um_guia_por_dia_e_pula_pauta_sem_produtos_suficientes(self):
        agora = datetime(2026, 10, 21, 10, tzinfo=guias.FUSO)
        fone = [produto(i, productName=f"Fone Bluetooth {marca}", price="99.90")
                for i, marca in enumerate(("JBL Tune 520BT", "QCY T13", "Edifier X3",
                                           "Haylou GT1", "Lenovo LP40"), start=1)]
        fone[0]["shopName"] = "JBL Oficial"
        with patch.object(guias.config, "BLOG_GUIAS_AUTOMATICOS", True), \
             patch.object(guias.config, "BLOG_GUIAS_HORA", 9), \
             patch.object(guias.site_publisher, "esta_configurado", return_value=True), \
             patch.object(guias, "buscar_candidatos",
                          side_effect=lambda p: fone if p is guias.PAUTAS[1] else []), \
             patch.object(guias, "_gerar_link", return_value="https://s.shopee.com.br/x"), \
             patch.object(guias, "publicar", return_value={"slug": guias.PAUTAS[1]["slug"]}) as publicar:
            self.assertFalse(guias.gerar_guia_do_dia(agora.replace(hour=8)))
            self.assertTrue(guias.gerar_guia_do_dia(agora))
            self.assertFalse(guias.gerar_guia_do_dia(agora.replace(hour=15)))
        publicar.assert_called_once()
        self.assertEqual(guias.PAUTAS[1]["slug"], publicar.call_args.args[0]["topic"])


if __name__ == "__main__":
    unittest.main()
