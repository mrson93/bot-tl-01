import unittest
from unittest import mock

import post_fixado


class PostFixadoTest(unittest.TestCase):
    def test_textos_cabem_nos_limites(self):
        self.assertLessEqual(len(post_fixado.TEXTO_BLUESKY), 300)
        self.assertLessEqual(len(post_fixado.TEXTO_TELEGRAM), 1024)
        self.assertLessEqual(len(post_fixado.TEXTO_INSTAGRAM), 2200)
        self.assertTrue(post_fixado.ARTE.exists())

    def test_links_do_bluesky_ficam_clicaveis(self):
        uris = [f["features"][0]["uri"] for f in post_fixado.facetas(post_fixado.TEXTO_BLUESKY)]
        self.assertEqual(uris, [
            "https://t.me/TaBaratoAlertaDePrecoBot?start=bsky", "https://canaltabarato.com.br",
            "https://t.me/CanalTaBarato", "https://instagram.com/ofertascanaltabarato",
        ])
        texto = post_fixado.TEXTO_BLUESKY.encode("utf-8")
        primeira = post_fixado.facetas(post_fixado.TEXTO_BLUESKY)[0]["index"]
        self.assertEqual(texto[primeira["byteStart"]:primeira["byteEnd"]],
                         b"t.me/TaBaratoAlertaDePrecoBot?start=bsky")

    def test_publica_uma_vez_por_rede(self):
        feitas = set()
        redes = (("A", lambda: True, mock.Mock(return_value="ok")),
                 ("B", lambda: True, mock.Mock(side_effect=RuntimeError("falhou"))))
        with mock.patch.object(post_fixado, "REDES", redes), \
             mock.patch.object(post_fixado.store, "campanha_enviada", side_effect=lambda d, c, n: n in feitas), \
             mock.patch.object(post_fixado.store, "marcar_campanha_enviada", side_effect=lambda d, c, n: feitas.add(n)):
            self.assertTrue(post_fixado.executar())
            self.assertFalse(post_fixado.executar())
        self.assertEqual(feitas, {"A"})
        self.assertEqual(redes[0][2].call_count, 1)
        self.assertEqual(redes[1][2].call_count, 2)


if __name__ == "__main__":
    unittest.main()
