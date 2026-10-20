import os
import unittest
from unittest.mock import patch

import buffer_facebook
import facebook


class Resposta:
    def __init__(self, corpo, status=200):
        self._corpo = corpo
        self.status_code = status

    def json(self):
        return self._corpo


class BufferFacebookTest(unittest.TestCase):
    def configuracao(self):
        return patch.dict(os.environ, {
            "BUFFER_API_KEY": "buffer-chave-secreta-comprida",
            "BUFFER_FACEBOOK_CHANNEL_ID": "6aa9c3e5ea19ca0bde4ff5f3",
        }, clear=False)

    def test_publica_card_imediatamente_com_variaveis_graphql(self):
        jpeg = b"\xff\xd8\xffcard"
        with self.configuracao(), \
             patch.object(buffer_facebook.site_publisher,
                          "publicar_imagem_story",
                          return_value="https://canaltabarato.com.br/story-assets/card.jpg"), \
             patch.object(buffer_facebook.site_publisher,
                          "verificar_imagem_publica_story") as verificar, \
             patch.object(buffer_facebook.requests, "post", return_value=Resposta({
                 "data": {"createPost": {"post": {"id": "post_123"}}}
             })) as post:
            post_id = buffer_facebook.publicar("Oferta", jpeg)

        self.assertEqual("post_123", post_id)
        verificar.assert_called_once_with(
            "https://canaltabarato.com.br/story-assets/card.jpg", len(jpeg)
        )
        chamada = post.call_args
        self.assertEqual("https://api.buffer.com", chamada.args[0])
        self.assertEqual("Bearer buffer-chave-secreta-comprida",
                         chamada.kwargs["headers"]["Authorization"])
        entrada = chamada.kwargs["json"]["variables"]["input"]
        self.assertEqual("shareNow", entrada["mode"])
        self.assertEqual("automatic", entrada["schedulingType"])
        self.assertEqual("post", entrada["metadata"]["facebook"]["type"])
        self.assertEqual("6aa9c3e5ea19ca0bde4ff5f3", entrada["channelId"])
        self.assertEqual(
            "https://canaltabarato.com.br/story-assets/card.jpg",
            entrada["assets"][0]["image"]["url"],
        )

    def test_falha_incerta_nao_e_repetida(self):
        with self.configuracao(), \
             patch.object(buffer_facebook.requests, "post",
                          side_effect=buffer_facebook.requests.ConnectionError()) as post:
            with self.assertRaisesRegex(RuntimeError, "sem confirmação"):
                buffer_facebook.publicar("Oferta", None)
        self.assertEqual(1, post.call_count)

    def test_erro_graphql_nao_expoe_resposta(self):
        with self.configuracao(), patch.object(
            buffer_facebook.requests, "post",
            return_value=Resposta({"errors": [{"message": "segredo"}]})
        ):
            with self.assertRaisesRegex(RuntimeError, "recusou") as contexto:
                buffer_facebook.publicar("Oferta", None)
        self.assertNotIn("segredo", str(contexto.exception))

    def test_erro_tipado_e_sanitizado_para_diagnostico(self):
        with self.configuracao(), patch.object(
            buffer_facebook.requests, "post",
            return_value=Resposta({
                "data": {"createPost": {
                    "message": "campo inválido buffer-chave-secreta-comprida"
                }}
            })
        ):
            with self.assertRaisesRegex(RuntimeError, "campo inválido") as contexto:
                buffer_facebook.publicar("Oferta", None)
        self.assertNotIn("buffer-chave-secreta-comprida", str(contexto.exception))

    def test_configuracao_exige_id_de_canal_valido(self):
        with patch.dict(os.environ, {
            "BUFFER_API_KEY": "buffer-chave-secreta-comprida",
            "BUFFER_FACEBOOK_CHANNEL_ID": "invalido",
        }, clear=False):
            self.assertFalse(buffer_facebook.esta_configurado())

    def test_facebook_prefere_buffer_sem_chamar_api_direta_da_meta(self):
        oferta = {"fonte": "Shopee", "productName": "Produto", "price": 50}
        with patch.object(facebook.config, "FACEBOOK_ATIVO", True), \
             patch.object(facebook.buffer_facebook, "esta_configurado",
                          return_value=True), \
             patch.object(facebook.buffer_facebook, "publicar_confirmado") as publicar, \
             patch.object(facebook, "_publicar") as publicar_meta:
            facebook.postar(oferta, "https://oferta.test/comprar")
        publicar.assert_called_once()
        publicar_meta.assert_not_called()

    def test_post_em_fila_nao_e_contado_como_entregue_nem_duplicado(self):
        import tempfile
        from pathlib import Path
        import store
        with tempfile.TemporaryDirectory() as pasta, \
             patch.object(store, "_DB", Path(pasta) / "estado.db"), \
             patch.object(buffer_facebook, "consultar_status", return_value="scheduled"):
            criar = unittest.mock.Mock(return_value="post_123")
            for _ in range(2):
                with self.assertRaisesRegex(RuntimeError, "scheduled"):
                    buffer_facebook.publicar_confirmado("oferta-1", "Facebook", criar)
            criar.assert_called_once()

    def test_post_ainda_enviando_aguarda_ate_confirmar(self):
        import tempfile
        from pathlib import Path
        import store
        with tempfile.TemporaryDirectory() as pasta, \
             patch.object(store, "_DB", Path(pasta) / "estado.db"), \
             patch.object(buffer_facebook, "consultar_status",
                          side_effect=["sending", "sending", "sending", "sent"]), \
             patch.object(buffer_facebook.time, "sleep") as esperar:
            criar = unittest.mock.Mock(return_value="post_123")
            self.assertEqual("post_123", buffer_facebook.publicar_confirmado(
                "oferta-1", "Facebook", criar))
        self.assertEqual([2, 3, 5], [c.args[0] for c in esperar.call_args_list])

    def test_post_em_erro_e_retentado_no_mesmo_id_apos_24_horas(self):
        import tempfile
        from pathlib import Path
        import store
        with tempfile.TemporaryDirectory() as pasta, \
             patch.object(store, "_DB", Path(pasta) / "estado.db"), \
             patch.object(buffer_facebook.time, "time", return_value=200000):
            store.registrar_buffer_post("oferta-1", "Facebook", "post_123")
            with store._conn() as con:
                con.execute("UPDATE buffer_posts SET criado_em=100000")
            criar = unittest.mock.Mock()
            with patch.object(buffer_facebook, "consultar_status",
                              side_effect=["error", "sent"]), \
                 patch.object(buffer_facebook, "retentar_post_com_erro") as retentar:
                self.assertEqual("post_123", buffer_facebook.publicar_confirmado(
                    "oferta-1", "Facebook", criar))
            criar.assert_not_called()
            retentar.assert_called_once_with("post_123", None)
            self.assertEqual(200000, store.buffer_post_info("oferta-1", "Facebook")[2])


if __name__ == "__main__":
    unittest.main()
