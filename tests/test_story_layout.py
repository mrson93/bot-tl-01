import unittest
from unittest.mock import patch

from PIL import Image

import story_card


class StoryLayoutTest(unittest.TestCase):
    def test_nome_da_plataforma_fica_centralizado_acima_da_foto(self):
        with patch.object(story_card, "_baixar_imagem", return_value=None), \
             patch.object(story_card.ImageDraw.ImageDraw, "text") as escrever:
            story_card.gerar({"fonte": "Mercado Livre", "productName": "Produto",
                              "price": 50}, "https://go.canaltabarato.com.br/x")
        etiqueta = next(call for call in escrever.call_args_list
                        if call.args[1] == "MERCADO LIVRE")
        self.assertEqual((540, 243), etiqueta.args[0])
        self.assertEqual("mm", etiqueta.kwargs["anchor"])
        self.assertEqual("white", etiqueta.kwargs["fill"])

    def test_titulo_de_quatro_linhas_nao_encosta_no_preco(self):
        titulo = (
            "Kit completo de panelas antiaderentes com tampas de vidro "
            "utensílios para cozinha cabo removível conjunto premium"
        )
        imagem = Image.new("RGB", (1080, 1920), "white")
        draw = story_card.ImageDraw.Draw(imagem)
        linhas, fonte, entrelinha = story_card._ajustar_titulo(draw, titulo)
        self.assertGreaterEqual(len(linhas), 4)
        layout = story_card._layout_inferior(
            draw, linhas, fonte, entrelinha, "R$ 1.234,56", 45
        )
        self.assertGreaterEqual(layout["preco_topo"] - layout["titulo_fim"], 30)
        self.assertGreaterEqual(layout["painel_topo"] - layout["desconto_fim"], 22)
        self.assertLess(layout["painel_topo"], layout["painel_fim"])


if __name__ == "__main__":
    unittest.main()
