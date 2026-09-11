import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

import instagram_stories
import story_card


class Resposta:
    def __init__(self, corpo, status=200):
        self._corpo = corpo
        self.status_code = status
        self.text = str(corpo)

    def json(self):
        return self._corpo


class InstagramStoriesTest(unittest.TestCase):
    def configuracao(self):
        return patch.multiple(
            instagram_stories.config,
            INSTAGRAM_STORIES_ATIVO=True,
            INSTAGRAM_USERNAME="ofertascanaltabarato",
            INSTAGRAM_MAX_STORIES_DIA=10,
            INSTAGRAM_CONTAINER_TENTATIVAS=2,
            FACEBOOK_PAGE_ID="111695315138976",
            FACEBOOK_PAGE_ACCESS_TOKEN="token-meta-secreto",
            FACEBOOK_GRAPH_API_VERSION="v26.0",
            SITE_ATIVO=True,
            SITE_API_URL="https://canaltabarato.pages.dev/api/publish",
            SITE_API_TOKEN="token-site-secreto",
            HTTP_MAX_TENTATIVAS=1,
        )

    def test_publica_story_na_conta_profissional_vinculada(self):
        gets = [
            Resposta({"instagram_business_account": {"id": "17841435020643780"}}),
            Resposta({"id": "17841435020643780", "username": "ofertascanaltabarato"}),
            Resposta({"id": "18000000000000001", "status_code": "FINISHED"}),
        ]
        posts = [Resposta({"id": "18000000000000001"}), Resposta({"id": "17900000000000001"})]
        with self.configuracao(), \
             patch.object(instagram_stories.requests, "get", side_effect=gets) as get, \
             patch.object(instagram_stories.requests, "post", side_effect=posts) as post, \
             patch.object(instagram_stories.story_card, "gerar", return_value=b"jpeg"), \
             patch.object(instagram_stories.site_publisher, "publicar_imagem_story",
                          return_value="https://canaltabarato.pages.dev/story-assets/a.jpg"):
            instagram_stories.postar(
                {"productName": "Panela", "price": 79.9},
                "https://s.shopee.com.br/link-instagram",
            )

        self.assertEqual(3, get.call_count)
        self.assertEqual(2, post.call_count)
        criar, publicar = post.call_args_list
        self.assertTrue(criar.args[0].endswith("/17841435020643780/media"))
        self.assertEqual("STORIES", criar.kwargs["data"]["media_type"])
        self.assertTrue(publicar.args[0].endswith("/17841435020643780/media_publish"))
        self.assertEqual("18000000000000001", publicar.kwargs["data"]["creation_id"])
        self.assertEqual(
            "Bearer token-meta-secreto", publicar.kwargs["headers"]["Authorization"]
        )

    def test_recusa_conta_vinculada_diferente_da_configurada(self):
        with self.configuracao(), patch.object(
            instagram_stories.requests, "get", side_effect=[
                Resposta({"instagram_business_account": {"id": "17841435020643780"}}),
                Resposta({"id": "17841435020643780", "username": "outra_conta"}),
            ]
        ), patch.object(instagram_stories.requests, "post") as post:
            with self.assertRaisesRegex(RuntimeError, "não é @ofertascanaltabarato"):
                instagram_stories.postar({}, "https://oferta.test/x")
        post.assert_not_called()

    def test_falha_incerta_ao_publicar_nao_tenta_duplicar(self):
        erro = instagram_stories.requests.ConnectionError("token-meta-secreto")
        with self.configuracao(), patch.object(
            instagram_stories.requests, "get", side_effect=[
                Resposta({"instagram_business_account": {"id": "17841435020643780"}}),
                Resposta({"id": "17841435020643780", "username": "ofertascanaltabarato"}),
                Resposta({"status_code": "FINISHED"}),
            ]
        ), patch.object(
            instagram_stories.requests, "post",
            side_effect=[Resposta({"id": "18000000000000001"}), erro],
        ) as post, patch.object(
            instagram_stories.story_card, "gerar", return_value=b"jpeg"
        ), patch.object(
            instagram_stories.site_publisher, "publicar_imagem_story",
            return_value="https://canaltabarato.pages.dev/story-assets/a.jpg",
        ):
            with self.assertRaises(RuntimeError) as contexto:
                instagram_stories.postar({}, "https://oferta.test/x")
        self.assertEqual(2, post.call_count)
        self.assertNotIn("token-meta-secreto", str(contexto.exception))

    def test_limite_diario_e_configuravel(self):
        with tempfile.TemporaryDirectory() as pasta, self.configuracao(), \
             patch.object(instagram_stories.store, "_DB", Path(pasta) / "estado.db"):
            for indice in range(10):
                instagram_stories.store.registrar_entrega(
                    str(indice), "Instagram Stories", True
                )
            self.assertFalse(instagram_stories.pode_publicar())

    def test_cartao_tem_formato_vertical_e_qr_do_link(self):
        with patch.object(story_card, "_baixar_imagem", return_value=None):
            conteudo = story_card.gerar(
                {"productName": "Panela elétrica com desconto", "price": 79.9,
                 "priceDiscountRate": 40, "fonte": "Shopee"},
                "https://canaltabarato.pages.dev/go/oferta-instagram",
            )
        imagem = Image.open(io.BytesIO(conteudo))
        self.assertEqual((1080, 1920), imagem.size)
        self.assertLessEqual(len(conteudo), 850_000)


if __name__ == "__main__":
    unittest.main()
