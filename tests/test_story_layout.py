import unittest

from PIL import Image

import story_card


class StoryLayoutTest(unittest.TestCase):
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
