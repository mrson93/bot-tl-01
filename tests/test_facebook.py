import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import facebook
import feed_card
from PIL import Image


class Resposta:
    def __init__(self, corpo, status=200):
        self._corpo = corpo
        self.status_code = status
        self.text = str(corpo)

    def json(self):
        return self._corpo


class FacebookTest(unittest.TestCase):
    def configuracao(self):
        return patch.multiple(
            facebook.config,
            FACEBOOK_ATIVO=True,
            FACEBOOK_PAGE_ID="123456",
            FACEBOOK_PAGE_ACCESS_TOKEN="token-super-secreto",
            FACEBOOK_GRAPH_API_VERSION="v26.0",
            FACEBOOK_MAX_POSTS_DIA=4,
            HTTP_MAX_TENTATIVAS=1,
        )

    def test_publica_imagem_anexada_ao_feed_com_aviso_curto_de_publicidade(self):
        oferta = {"fonte": "Shopee", "productName": "Produto util",
                  "price": 49.9, "priceDiscountRate": 50,
                  "imageUrl": "https://imagem.test/produto.jpg"}
        with self.configuracao(), patch.object(
            facebook.requests, "post", side_effect=[
                Resposta({"id": "foto_123"}),
                Resposta({"id": "123456_789"}),
            ]
        ) as publicar:
            facebook.postar(oferta, "https://oferta.test/comprar")
        self.assertEqual(2, publicar.call_count)
        upload, feed = publicar.call_args_list
        self.assertTrue(upload.args[0].endswith("/123456/photos"))
        self.assertEqual("false", upload.kwargs["data"]["published"])
        arquivo = upload.kwargs["files"]["source"]
        self.assertEqual("oferta-feed.jpg", arquivo[0])
        self.assertEqual("image/jpeg", arquivo[2])
        self.assertTrue(arquivo[1].startswith(b"\xff\xd8\xff"))
        self.assertNotIn("caption", upload.kwargs["data"])
        self.assertTrue(feed.args[0].endswith("/123456/feed"))
        dados = feed.kwargs["data"]
        self.assertIn("Produto util", dados["message"])
        self.assertIn("Ver oferta #publi", dados["message"])
        self.assertNotIn("Link de afiliado", dados["message"])
        self.assertEqual("true", dados["published"])
        self.assertEqual(
            '{"media_fbid": "foto_123"}', dados["attached_media[0]"]
        )
        self.assertNotIn("attached_media", dados)
        self.assertNotIn("token-super-secreto", feed.args[0])

    def test_card_do_feed_tem_formato_4_por_5_e_titulo_longo_sem_colisao(self):
        titulo = ("Kit completo de panelas antiaderentes com tampas de vidro "
                  "utensílios para cozinha cabo removível conjunto premium "
                  "resistente para uso diário com entrega rápida")
        with patch.object(feed_card.base, "_baixar_imagem", return_value=None):
            conteudo = feed_card.gerar({
                "fonte": "Shopee", "productName": titulo, "price": 1234.56,
                "priceDiscountRate": 45,
            })
        imagem = Image.open(io.BytesIO(conteudo))
        self.assertEqual((1080, 1350), imagem.size)
        self.assertLessEqual(len(conteudo), feed_card.MAX_JPEG)

        draw = feed_card.ImageDraw.Draw(imagem)
        linhas, fonte, entrelinha = feed_card._ajustar_titulo(draw, titulo)
        layout = feed_card._layout_texto(
            draw, linhas, fonte, entrelinha, "R$ 1.234,56", 45
        )
        self.assertGreaterEqual(len(linhas), 4)
        self.assertGreaterEqual(layout["preco_topo"] - layout["titulo_fim"], 22)
        self.assertGreaterEqual(layout["cta_topo"] - layout["desconto_fim"], 17)

    def test_facebook_nao_corta_titulo_com_reticencias(self):
        titulo = "Conjunto completo para cozinha com vários acessórios úteis"
        with self.configuracao():
            texto = facebook.montar_texto(
                {"fonte": "Shopee", "productName": titulo, "price": 50},
                "https://oferta.test/comprar",
            )
        self.assertIn(titulo, texto)
        self.assertNotIn("…", texto)

        with self.configuracao():
            texto_catalogo = facebook.montar_texto(
                {"fonte": "Shopee", "productName": titulo + "...", "price": 50},
                "https://oferta.test/comprar",
            )
        self.assertNotIn("...", texto_catalogo)

    def test_card_remove_reticencias_que_ja_vieram_do_catalogo(self):
        titulo = "Produto completo enviado pelo catálogo..."
        with patch.object(feed_card.base, "_baixar_imagem", return_value=None), \
             patch.object(feed_card, "_ajustar_titulo",
                          wraps=feed_card._ajustar_titulo) as ajustar:
            feed_card.gerar({"productName": titulo, "price": 50})
        self.assertEqual("Produto completo enviado pelo catálogo",
                         ajustar.call_args.args[1])

    def test_foto_recusada_cai_para_post_de_link(self):
        oferta = {"fonte": "Shopee", "productName": "Produto", "price": 50,
                  "imageUrl": "https://imagem.test/produto.jpg"}
        with self.configuracao(), patch.object(facebook.requests, "post", side_effect=[
            Resposta({"error": {"message": "imagem invalida"}}, 400),
            Resposta({"id": "foto_original_123"}),
            Resposta({"id": "123_456"}),
        ]) as publicar:
            facebook.postar(oferta, "https://oferta.test/comprar")
        self.assertEqual(3, publicar.call_count)
        self.assertEqual(
            "https://imagem.test/produto.jpg",
            publicar.call_args_list[1].kwargs["data"]["url"],
        )
        feed = publicar.call_args
        self.assertTrue(feed.args[0].endswith("/123456/feed"))
        self.assertEqual("true", feed.kwargs["data"]["published"])
        self.assertEqual(
            '{"media_fbid": "foto_original_123"}',
            feed.kwargs["data"]["attached_media[0]"],
        )

    def test_exibe_motivo_quando_reposta_por_queda_real(self):
        oferta = {"fonte": "Shopee", "productName": "Produto", "price": 80,
                  "_motivo": "queda_preco", "_preco_publicacao_anterior": 100}
        with self.configuracao():
            texto = facebook.montar_texto(oferta, "https://oferta.test/comprar")
        self.assertIn("Reapareceu porque caiu 20%", texto)

    def test_falha_de_rede_incerta_nao_cria_post_duplicado(self):
        oferta = {"fonte": "Shopee", "productName": "Produto", "price": 50,
                  "imageUrl": "https://imagem.test/produto.jpg"}
        erro = facebook.requests.ConnectionError("falhou com token-super-secreto")
        with self.configuracao(), patch.object(facebook.requests, "post",
                                                side_effect=erro) as publicar:
            with self.assertRaises(RuntimeError) as contexto:
                facebook.postar(oferta, "https://oferta.test/comprar")
        self.assertEqual(1, publicar.call_count)
        self.assertNotIn("token-super-secreto", str(contexto.exception))
        self.assertIn("[SEGREDO]", str(contexto.exception))

    def test_erro_temporario_nao_dispara_fallback_que_pode_duplicar(self):
        oferta = {"fonte": "Shopee", "productName": "Produto", "price": 50,
                  "imageUrl": "https://imagem.test/produto.jpg"}
        with self.configuracao(), patch.object(
            facebook.requests, "post",
            return_value=Resposta({"error": {"message": "indisponivel"}}, 503),
        ) as publicar:
            with self.assertRaises(RuntimeError):
                facebook.postar(oferta, "https://oferta.test/comprar")
        self.assertEqual(1, publicar.call_count)

    def test_limite_diario_desativa_temporariamente_o_canal(self):
        with tempfile.TemporaryDirectory() as pasta, self.configuracao(), \
             patch.object(facebook.store, "_DB", Path(pasta) / "estado.db"):
            for indice in range(4):
                facebook.store.registrar_entrega(str(indice), "Facebook", True)
            self.assertFalse(facebook.pode_publicar())

    def test_limite_zero_significa_ilimitado(self):
        with self.configuracao(), patch.object(facebook.config, "FACEBOOK_MAX_POSTS_DIA", 0), \
             patch.object(facebook.store, "posts_canal_hoje", return_value=1000000):
            self.assertTrue(facebook.pode_publicar())

    def test_configuracao_incompleta_mantem_canal_desligado(self):
        with patch.object(facebook.config, "FACEBOOK_ATIVO", True), \
             patch.object(facebook.config, "FACEBOOK_PAGE_ID", ""), \
             patch.object(facebook.config, "FACEBOOK_PAGE_ACCESS_TOKEN", "token"):
            self.assertFalse(facebook.esta_configurada())


if __name__ == "__main__":
    unittest.main()
