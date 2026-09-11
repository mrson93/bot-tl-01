import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import facebook


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

    def test_publica_foto_com_texto_e_aviso_de_afiliado(self):
        oferta = {"fonte": "Shopee", "productName": "Produto util",
                  "price": 49.9, "priceDiscountRate": 50,
                  "imageUrl": "https://imagem.test/produto.jpg"}
        with self.configuracao(), patch.object(
            facebook.requests, "post", return_value=Resposta({"post_id": "1_2"})
        ) as publicar:
            facebook.postar(oferta, "https://oferta.test/comprar")
        self.assertTrue(publicar.call_args.args[0].endswith("/123456/photos"))
        dados = publicar.call_args.kwargs["data"]
        self.assertIn("Produto util", dados["caption"])
        self.assertIn("Link de afiliado", dados["caption"])
        self.assertNotIn("token-super-secreto", publicar.call_args.args[0])

    def test_foto_recusada_cai_para_post_de_link(self):
        oferta = {"fonte": "Shopee", "productName": "Produto", "price": 50,
                  "imageUrl": "https://imagem.test/produto.jpg"}
        with self.configuracao(), patch.object(facebook.requests, "post", side_effect=[
            Resposta({"error": {"message": "imagem invalida"}}, 400),
            Resposta({"id": "123_456"}),
        ]) as publicar:
            facebook.postar(oferta, "https://oferta.test/comprar")
        self.assertEqual(2, publicar.call_count)
        self.assertTrue(publicar.call_args.args[0].endswith("/123456/feed"))

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
