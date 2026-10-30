import io
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

import telegram_poster
import bluesky


class Resposta:
    def __init__(self, corpo, status_code=200):
        self.corpo = corpo
        self.status_code = status_code
        self.text = str(corpo)
    def json(self):
        return self.corpo
    def raise_for_status(self):
        pass


class ImagemGrande:
    status_code = 200
    headers = {"Content-Type": "image/jpeg", "Content-Length": "8000001"}

    def raise_for_status(self):
        pass

    def iter_content(self, chunk_size):
        raise AssertionError("imagem grande nao deve ser baixada")

    def close(self):
        pass


class ImagemEmPartes:
    status_code = 200
    headers = {"Content-Type": "image/jpeg"}

    def __init__(self):
        self.fechada = False

    def raise_for_status(self):
        pass

    def iter_content(self, chunk_size):
        return [b"a" * 600_000, b"b" * 600_000]

    def close(self):
        self.fechada = True


class Redirecionamento:
    status_code = 307
    headers = {"Location": "http://127.0.0.1/segredo"}
    text = "redirect"

    def raise_for_status(self):
        pass

    def json(self):
        return {"accessJwt": "nao deveria", "did": "did:x"}

    def close(self):
        pass


class PublicacaoTest(unittest.TestCase):
    def test_shopee_vip_usa_texto_cauteloso_e_botao_rastreavel(self):
        with patch.object(telegram_poster.config, "TELEGRAM_CHANNEL", "@canal"), \
             patch.object(telegram_poster.requests, "post",
                          return_value=Resposta({"ok": True})) as postar:
            telegram_poster.postar_shopee_vip(
                "https://canaltabarato.pages.dev/loja/shopee-vip", 0
            )
        dados = postar.call_args.kwargs["json"]
        self.assertIn("teste grátis por 1 mês", dados["text"])
        self.assertIn("Depois, R$ 9,90 por mês", dados["text"])
        self.assertIn("renovação automática", dados["text"])
        self.assertIn("Confira se o período grátis aparece para a sua conta", dados["text"])
        self.assertIn("Frete grátis ilimitado", dados["text"])
        self.assertIn("2 cupons de R$ 5", dados["text"])
        self.assertIn("Cupons extras em datas duplas", dados["text"])
        self.assertIn("Atendimento prioritário", dados["text"])
        self.assertIn("35% de desconto nos planos de assistência Meu Pet Club", dados["text"])
        self.assertIn("elegibilidade", dados["text"])
        self.assertEqual(
            "https://canaltabarato.pages.dev/loja/shopee-vip",
            dados["reply_markup"]["inline_keyboard"][0][0]["url"],
        )

    def test_bluesky_publica_bom_dia_sem_link_ou_imagem(self):
        with patch.object(bluesky, "_sessao", return_value={"accessJwt": "jwt", "did": "did:x"}), \
             patch.object(bluesky.requests, "post", return_value=Resposta({})) as postar:
            bluesky.postar_bom_dia("Bom dia! ☀️")
            record = postar.call_args.kwargs["json"]["record"]
            self.assertEqual("Bom dia! ☀️", record["text"])
            self.assertNotIn("facets", record)
            self.assertNotIn("embed", record)

    def test_bluesky_publica_shopee_vip_com_link_e_texto_adaptado(self):
        link = "https://canaltabarato.pages.dev/loja/shopee-vip"
        with patch.object(bluesky, "_sessao",
                          return_value={"accessJwt": "jwt", "did": "did:x"}), \
             patch.object(bluesky.requests, "post", return_value=Resposta({})) as postar:
            bluesky.postar_shopee_vip(link, 1)

        record = postar.call_args.kwargs["json"]["record"]
        self.assertLessEqual(len(record["text"]), 300)
        self.assertIn("1 mês grátis", record["text"])
        self.assertIn("R$ 9,90/mês", record["text"])
        self.assertIn("Contas elegíveis", record["text"])
        self.assertEqual(
            link, record["facets"][0]["features"][0]["uri"]
        )
        inicio = record["facets"][0]["index"]["byteStart"]
        fim = record["facets"][0]["index"]["byteEnd"]
        self.assertEqual(link.encode("utf-8"), record["text"].encode("utf-8")[inicio:fim])

    def test_telegram_tenta_texto_quando_foto_falha(self):
        oferta = {"fonte": "Shopee", "productName": "Produto", "price": 50,
                  "priceDiscountRate": 50, "imageUrl": "https://imagem.test/x.jpg"}
        with patch.object(telegram_poster.config, "TELEGRAM_BOT_TOKEN", "token"), \
             patch.object(telegram_poster.config, "TELEGRAM_CHANNEL", "@canal"), \
             patch.object(telegram_poster.requests, "post", side_effect=[
                 Resposta({"ok": False, "description": "wrong file"}), Resposta({"ok": True})
             ]) as postar:
            telegram_poster.postar(oferta, "https://oferta.test")
            self.assertEqual(2, postar.call_count)
            self.assertIn("sendMessage", postar.call_args_list[1].args[0])

    def test_telegram_mantem_url_crua_no_botao_e_escapa_so_o_html(self):
        oferta = {"fonte": "Shopee", "productName": "Produto", "price": 50}
        link = 'https://oferta.test/?busca="><b>ataque</b>'
        with patch.object(telegram_poster.config, "TELEGRAM_BOT_TOKEN", "token"), \
             patch.object(telegram_poster.config, "TELEGRAM_CHANNEL", "@canal"), \
             patch.object(telegram_poster.requests, "post", return_value=Resposta({"ok": True})) as postar:
            telegram_poster.postar(oferta, link)
        dados = postar.call_args.kwargs["json"]
        self.assertIn("&quot;&gt;&lt;b&gt;ataque&lt;/b&gt;", dados["caption"])
        self.assertEqual(link, dados["reply_markup"]["inline_keyboard"][0][0]["url"])

    def test_falha_do_fallback_do_telegram_nao_expoe_token(self):
        oferta = {"fonte": "Shopee", "productName": "Produto", "price": 50,
                  "imageUrl": "https://imagem.test/x.jpg"}
        erro = telegram_poster.requests.ConnectionError(
            "falhou em https://api.telegram.org/bot123456:ABC-def/sendMessage"
        )
        with patch.object(telegram_poster.config, "TELEGRAM_BOT_TOKEN", "123456:ABC-def"), \
             patch.object(telegram_poster.config, "TELEGRAM_CHANNEL", "@canal"), \
             patch.object(telegram_poster.requests, "post", side_effect=[
                 Resposta({"ok": False}), erro
             ]):
            with self.assertRaises(RuntimeError) as contexto:
                telegram_poster.postar(oferta, "https://oferta.test")
        self.assertNotIn("123456:ABC-def", str(contexto.exception))
        self.assertIn("[SEGREDO]", str(contexto.exception))
        self.assertTrue(contexto.exception.__suppress_context__)

    def test_bluesky_nao_busca_imagem_em_endereco_privado(self):
        with patch.object(bluesky.requests, "get") as baixar:
            self.assertIsNone(bluesky._upload_imagem("jwt", "https://127.0.0.1/x.jpg"))
            baixar.assert_not_called()

    def test_bluesky_nao_busca_imagem_fora_da_allowlist(self):
        with patch("seguranca.socket.getaddrinfo") as resolver, \
             patch.object(bluesky.requests, "get") as baixar:
            self.assertIsNone(bluesky._upload_imagem("jwt", "https://imagem-atacante.example/x.jpg"))
            resolver.assert_not_called()
            baixar.assert_not_called()

    def test_bluesky_recusa_imagem_grande_antes_de_baixar_o_corpo(self):
        endereco_publico = [(2, 1, 6, "", ("93.184.216.34", 443))]
        saida = io.StringIO()
        with redirect_stdout(saida), \
             patch("seguranca.socket.getaddrinfo", return_value=endereco_publico), \
             patch.object(bluesky.requests, "get", return_value=ImagemGrande()) as baixar:
            self.assertIsNone(bluesky._upload_imagem("jwt", "https://cf.shopee.com.br/x.jpg"))
            self.assertTrue(baixar.call_args.kwargs["stream"])
        self.assertIn("imagem original maior que 8 MB", saida.getvalue())
        self.assertNotIn("cf.shopee.com.br", saida.getvalue())

    def test_bluesky_limita_imagem_mesmo_sem_content_length(self):
        imagem = ImagemEmPartes()
        endereco_publico = [(2, 1, 6, "", ("93.184.216.34", 443))]
        with patch("seguranca.socket.getaddrinfo", return_value=endereco_publico), \
             patch.object(bluesky.requests, "get", return_value=imagem), \
             patch.object(bluesky.requests, "post") as postar:
            self.assertIsNone(bluesky._upload_imagem("jwt", "https://cf.shopee.com.br/x.jpg"))
        self.assertTrue(imagem.fechada)
        postar.assert_not_called()

    def test_bluesky_comprime_foto_acima_de_1_mb_em_vez_de_descartar(self):
        import os
        from PIL import Image
        bruto = Image.frombytes("RGB", (1500, 1500), os.urandom(1500 * 1500 * 3))
        arquivo = io.BytesIO()
        bruto.save(arquivo, format="PNG")
        self.assertGreater(arquivo.tell(), bluesky.MAX_IMAGEM_BYTES)

        class FotoGrande(ImagemEmPartes):
            headers = {"Content-Type": "image/png"}

            def iter_content(self, chunk_size):
                return [arquivo.getvalue()]

        endereco_publico = [(2, 1, 6, "", ("93.184.216.34", 443))]
        with patch("seguranca.socket.getaddrinfo", return_value=endereco_publico), \
             patch.object(bluesky, "_pds", return_value="https://pds.test"), \
             patch.object(bluesky.requests, "get", return_value=FotoGrande()), \
             patch.object(bluesky.requests, "post",
                          return_value=Resposta({"blob": {"ref": "x"}})) as postar:
            self.assertEqual({"ref": "x"},
                             bluesky._upload_imagem("jwt", "https://cf.shopee.com.br/x.png"))
        enviado = postar.call_args.kwargs
        self.assertLessEqual(len(enviado["data"]), bluesky.MAX_IMAGEM_BYTES)
        self.assertEqual("image/jpeg", enviado["headers"]["Content-Type"])

    def test_bluesky_rejeita_hostname_que_resolve_para_rede_privada(self):
        endereco_privado = [(2, 1, 6, "", ("10.0.0.5", 443))]
        with patch("seguranca.socket.getaddrinfo", return_value=endereco_privado), \
             patch.object(bluesky.requests, "get") as baixar:
            self.assertIsNone(bluesky._upload_imagem("jwt", "https://cf.shopee.com.br/x.jpg"))
            baixar.assert_not_called()

    def test_bluesky_nao_segue_redirecionamento_de_imagem(self):
        endereco_publico = [(2, 1, 6, "", ("93.184.216.34", 443))]
        saida = io.StringIO()
        with redirect_stdout(saida), \
             patch("seguranca.socket.getaddrinfo", return_value=endereco_publico), \
             patch.object(bluesky.requests, "get", return_value=Redirecionamento()) as baixar, \
             patch.object(bluesky.requests, "post") as postar:
            self.assertIsNone(bluesky._upload_imagem("jwt", "https://cf.shopee.com.br/x.jpg"))
        self.assertFalse(baixar.call_args.kwargs["allow_redirects"])
        postar.assert_not_called()
        self.assertIn("redirecionamento não permitido", saida.getvalue())
        self.assertNotIn("127.0.0.1", saida.getvalue())

    def test_bluesky_nao_envia_senha_para_pds_inseguro(self):
        with patch.object(bluesky.config, "BLUESKY_PDS", "http://127.0.0.1"), \
             patch.object(bluesky.requests, "post") as postar:
            with self.assertRaises(ValueError):
                bluesky._sessao()
            postar.assert_not_called()

    def test_bluesky_nao_reenvia_senha_em_redirecionamento(self):
        with patch.object(bluesky.requests, "post", return_value=Redirecionamento()) as postar:
            with self.assertRaises(RuntimeError):
                bluesky._sessao()
        self.assertFalse(postar.call_args.kwargs["allow_redirects"])

    def test_bluesky_rejeita_pds_com_caminho(self):
        with patch.object(bluesky.config, "BLUESKY_PDS", "https://bsky.social/atalho"), \
             patch.object(bluesky.requests, "post") as postar:
            with self.assertRaises(ValueError):
                bluesky._sessao()
            postar.assert_not_called()

    def test_bluesky_usa_link_normalizado_no_texto_e_no_facet(self):
        oferta = {"fonte": "Shopee", "productName": "Produto", "price": 50}
        with patch.object(bluesky, "_sessao", return_value={"accessJwt": "jwt", "did": "did:x"}), \
             patch.object(bluesky, "_upload_imagem", return_value=None), \
             patch.object(bluesky.requests, "post", return_value=Resposta({})) as postar:
            bluesky.postar(oferta, "  https://oferta.test/x  ")
        record = postar.call_args.kwargs["json"]["record"]
        self.assertTrue(record["text"].endswith("https://oferta.test/x"))
        self.assertEqual(
            "https://oferta.test/x",
            record["facets"][0]["features"][0]["uri"],
        )

    def test_bluesky_exibe_e_aponta_para_link_oficial_longo_quando_cabe(self):
        oferta = {"fonte": "Mercado Livre", "productName": "Produto", "price": 50}
        link = (
            "https://www.mercadolivre.com.br/produto/p/MLB123"
            "?matt_tool=71195511#source=lists&tracking_id=canal&wid=MLB123"
        )
        with patch.object(bluesky, "_sessao", return_value={"accessJwt": "jwt", "did": "did:x"}), \
             patch.object(bluesky, "_upload_imagem", return_value=None), \
             patch.object(bluesky.requests, "post", return_value=Resposta({})) as postar:
            bluesky.postar(oferta, link)
        record = postar.call_args.kwargs["json"]["record"]
        facet = record["facets"][0]
        texto_bytes = record["text"].encode("utf-8")
        exibido = texto_bytes[facet["index"]["byteStart"]:facet["index"]["byteEnd"]]
        self.assertEqual(link.encode("utf-8"), exibido)
        self.assertEqual(link, facet["features"][0]["uri"])


if __name__ == "__main__":
    unittest.main()
