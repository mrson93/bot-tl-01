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
            INSTAGRAM_DIRECT_ATIVO=True,
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
        posts = [
            Resposta({"success": True}),
            Resposta({"id": "18000000000000001"}),
            Resposta({"id": "17900000000000001"}),
        ]
        with self.configuracao(), \
             patch.object(instagram_stories.requests, "get", side_effect=gets) as get, \
             patch.object(instagram_stories.requests, "post", side_effect=posts) as post, \
             patch.object(instagram_stories.story_card, "gerar", return_value=b"jpeg") as gerar, \
             patch.object(instagram_stories.site_publisher, "publicar_imagem_story",
                          return_value="https://canaltabarato.pages.dev/story-assets/a.jpg"), \
             patch.object(instagram_stories.site_publisher, "verificar_imagem_publica_story"), \
             patch.object(instagram_stories.site_publisher, "registrar_story_instagram") as registrar, \
             patch.object(instagram_stories.time, "sleep"):
            instagram_stories.postar(
                {"productName": "Panela", "price": 79.9},
                "https://s.shopee.com.br/link-instagram",
            )

        self.assertEqual(3, get.call_count)
        self.assertEqual(3, post.call_count)
        assinar, criar, publicar = post.call_args_list
        self.assertTrue(assinar.args[0].endswith("/111695315138976/subscribed_apps"))
        self.assertEqual(
            "messages,messaging_postbacks",
            assinar.kwargs["data"]["subscribed_fields"],
        )
        self.assertEqual(
            "Bearer token-meta-secreto", assinar.kwargs["headers"]["Authorization"]
        )
        self.assertTrue(criar.args[0].endswith("/17841435020643780/media"))
        self.assertEqual("STORIES", criar.kwargs["data"]["media_type"])
        self.assertTrue(publicar.args[0].endswith("/17841435020643780/media_publish"))
        self.assertEqual("18000000000000001", publicar.kwargs["data"]["creation_id"])
        self.assertEqual(
            "Bearer token-meta-secreto", publicar.kwargs["headers"]["Authorization"]
        )
        # Direct ativo: o cartão chama para responder QUERO.
        self.assertEqual({"direct_ativo": True}, gerar.call_args.kwargs)
        registrar.assert_called_once()
        self.assertEqual("17900000000000001", registrar.call_args.args[0])

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
            side_effect=[
                Resposta({"success": True}),
                Resposta({"id": "18000000000000001"}),
                erro,
            ],
        ) as post, patch.object(
            instagram_stories.story_card, "gerar", return_value=b"jpeg"
        ), patch.object(
            instagram_stories.site_publisher, "publicar_imagem_story",
            return_value="https://canaltabarato.pages.dev/story-assets/a.jpg",
        ), patch.object(
            instagram_stories.site_publisher, "verificar_imagem_publica_story"
        ), patch.object(instagram_stories.time, "sleep"):
            with self.assertRaises(RuntimeError) as contexto:
                instagram_stories.postar({}, "https://oferta.test/x")
        self.assertEqual(3, post.call_count)
        self.assertNotIn("token-meta-secreto", str(contexto.exception))

    def test_limite_diario_e_configuravel(self):
        with tempfile.TemporaryDirectory() as pasta, self.configuracao(), \
             patch.object(instagram_stories.store, "_DB", Path(pasta) / "estado.db"):
            for indice in range(10):
                instagram_stories.store.registrar_entrega(
                    str(indice), "Instagram Stories", True
                )
            self.assertFalse(instagram_stories.pode_publicar())

    def test_cartao_tem_formato_vertical_sem_qr_code(self):
        link = "https://go.canaltabarato.com.br/a7kp3mq9"
        with patch.object(story_card, "_baixar_imagem", return_value=None):
            conteudo = story_card.gerar(
                {"productName": "Panela elétrica com desconto", "price": 79.9,
                 "priceDiscountRate": 40, "fonte": "Shopee"},
                link,
            )
        imagem = Image.open(io.BytesIO(conteudo))
        self.assertEqual((1080, 1920), imagem.size)
        self.assertLessEqual(len(conteudo), 850_000)
        self.assertEqual(
            "canaltabarato.com.br/a7kp3mq9",
            story_card._link_exibivel(link),
        )

    def test_titulo_do_cartao_fica_completo_sem_reticencias(self):
        titulo = ("Kit completo de panelas antiaderentes com tampas de vidro "
                  "cabos resistentes e acessórios para cozinha")
        imagem = Image.new("RGB", (1080, 1920), "white")
        draw = story_card.ImageDraw.Draw(imagem)
        linhas, _fonte, _entrelinha = story_card._ajustar_titulo(draw, titulo)
        self.assertEqual(titulo, " ".join(linhas))
        self.assertNotIn("…", " ".join(linhas))

    def test_titulo_longo_reserva_espaco_antes_do_preco(self):
        titulo = ("Kit completo de panelas antiaderentes com tampas de vidro "
                  "utensílios para cozinha cabo removível conjunto premium")
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

    def test_cartao_nao_baixa_imagem_fora_da_allowlist(self):
        with patch("seguranca.socket.getaddrinfo") as resolver, \
             patch.object(story_card.requests, "get") as baixar:
            self.assertIsNone(
                story_card._baixar_imagem("https://imagem-atacante.example/x.jpg")
            )
            resolver.assert_not_called()
            baixar.assert_not_called()

    def test_falha_ao_registrar_direct_nao_duplica_story_publicado(self):
        gets = [
            Resposta({"instagram_business_account": {"id": "17841435020643780"}}),
            Resposta({"id": "17841435020643780", "username": "ofertascanaltabarato"}),
            Resposta({"status_code": "FINISHED"}),
        ]
        posts = [Resposta({"success": True}),
                 Resposta({"id": "18000000000000001"}),
                 Resposta({"id": "17900000000000001"})]
        with self.configuracao(), \
             patch.object(instagram_stories.requests, "get", side_effect=gets), \
             patch.object(instagram_stories.requests, "post", side_effect=posts), \
             patch.object(instagram_stories.story_card, "gerar", return_value=b"jpeg") as gerar, \
             patch.object(instagram_stories.site_publisher, "publicar_imagem_story",
                          return_value="https://canaltabarato.pages.dev/story-assets/a.jpg"), \
             patch.object(instagram_stories.site_publisher, "verificar_imagem_publica_story"), \
             patch.object(instagram_stories.site_publisher, "registrar_story_instagram",
                          side_effect=RuntimeError("fora")), \
             patch.object(instagram_stories.time, "sleep"):
            instagram_stories.postar(
                {"oferta_id": "x", "productName": "Panela", "price": 79.9},
                "https://s.shopee.com.br/link-instagram",
            )
        # Com o Direct automático ativo, o cartão precisa pedir "QUERO".
        self.assertTrue(gerar.call_args.kwargs["direct_ativo"])

    def test_falha_ao_assinar_webhook_nao_impede_story(self):
        gets = [
            Resposta({"instagram_business_account": {"id": "17841435020643780"}}),
            Resposta({"id": "17841435020643780", "username": "ofertascanaltabarato"}),
            Resposta({"status_code": "FINISHED"}),
        ]
        posts = [
            Resposta({"error": {"message": "sem permissão"}}, status=403),
            Resposta({"id": "18000000000000001"}),
            Resposta({"id": "17900000000000001"}),
        ]
        with self.configuracao(), \
             patch.object(instagram_stories.requests, "get", side_effect=gets), \
             patch.object(instagram_stories.requests, "post", side_effect=posts) as post, \
             patch.object(instagram_stories.story_card, "gerar", return_value=b"jpeg"), \
             patch.object(instagram_stories.site_publisher, "publicar_imagem_story",
                          return_value="https://canaltabarato.pages.dev/story-assets/a.jpg"), \
             patch.object(instagram_stories.site_publisher, "verificar_imagem_publica_story"), \
             patch.object(instagram_stories.site_publisher, "registrar_story_instagram"), \
             patch.object(instagram_stories.time, "sleep"):
            instagram_stories.postar(
                {"oferta_id": "x", "productName": "Panela", "price": 79.9},
                "https://s.shopee.com.br/link-instagram",
            )
        self.assertEqual(3, post.call_count)


if __name__ == "__main__":
    unittest.main()
