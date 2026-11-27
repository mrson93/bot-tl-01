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


class CanalTest(unittest.TestCase):
    def test_troca_descricao_publica_fixa_e_solta_o_antigo(self):
        from unittest import mock
        chamadas = []

        def post(url, json=None, timeout=None):
            metodo = url.rsplit("/", 1)[-1]
            chamadas.append((metodo, json))
            resultado = {"getChat": {"pinned_message": {"message_id": 7}}, "sendMessage": {"message_id": 99}}.get(metodo, True)
            return mock.Mock(json=lambda: {"ok": True, "result": resultado})

        marcados = []
        with mock.patch.object(post_fixado.requests, "post", side_effect=post), \
             mock.patch.object(post_fixado.telegram_poster, "esta_configurada", return_value=True), \
             mock.patch.object(post_fixado.store, "campanha_enviada", return_value=False), \
             mock.patch.object(post_fixado.store, "marcar_campanha_enviada", side_effect=lambda *a: marcados.append(a)):
            self.assertTrue(post_fixado.atualizar_canal())
        metodos = [m for m, _ in chamadas]
        self.assertEqual(metodos, ["getChat", "setChatDescription", "sendMessage", "pinChatMessage", "unpinChatMessage"])
        self.assertEqual(chamadas[3][1]["message_id"], 99)
        self.assertEqual(chamadas[4][1]["message_id"], 7)
        self.assertLessEqual(len(post_fixado.DESCRICAO_CANAL), 255)
        self.assertIn("Podemos ganhar comissão", chamadas[2][1]["text"])
        self.assertEqual(marcados, [("canal-2026-11-cupons", "post_fixado_canal", "Telegram")])
        self.assertIn("@CanalTaBaratoCupons", chamadas[2][1]["text"])
        self.assertIn("@CanalTaBaratoCupons", post_fixado.DESCRICAO_CANAL)

    def test_nao_repete_a_mesma_versao(self):
        from unittest import mock
        with mock.patch.object(post_fixado.store, "campanha_enviada", return_value=True), \
             mock.patch.object(post_fixado.requests, "post") as post:
            self.assertTrue(post_fixado.atualizar_canal())
        post.assert_not_called()


class CanalCuponsTest(unittest.TestCase):
    def test_foto_descricao_post_fixado_no_canal_de_cupons(self):
        chamadas = []

        def post(url, json=None, data=None, files=None, timeout=None):
            metodo = url.rsplit("/", 1)[-1]
            chamadas.append((metodo, json or data, files))
            resultado = {"getChat": {}, "sendMessage": {"message_id": 3}}.get(metodo, True)
            return mock.Mock(json=lambda: {"ok": True, "result": resultado})

        marcados = []
        with mock.patch.object(post_fixado.requests, "post", side_effect=post), \
             mock.patch.object(post_fixado.config, "TELEGRAM_BOT_TOKEN", "t"), \
             mock.patch.object(post_fixado.config, "TELEGRAM_CANAL_CUPONS", "@CanalTaBaratoCupons"), \
             mock.patch.object(post_fixado.store, "campanha_enviada", return_value=False), \
             mock.patch.object(post_fixado.store, "marcar_campanha_enviada", side_effect=lambda *a: marcados.append(a)):
            self.assertTrue(post_fixado.configurar_canal_cupons())
        self.assertEqual([m for m, _, _ in chamadas],
                         ["setChatPhoto", "setChatDescription", "getChat", "sendMessage", "pinChatMessage"])
        self.assertIn("photo", chamadas[0][2])
        self.assertEqual("@CanalTaBaratoCupons", chamadas[0][1]["chat_id"])
        self.assertLessEqual(len(post_fixado.DESCRICAO_CUPONS), 255)
        self.assertIn("Copiar código", chamadas[3][1]["text"])
        self.assertEqual(marcados, [("cupons-2026-11", "canal_cupons", "Telegram")])
        self.assertTrue(post_fixado.FOTO_CUPONS.exists())
