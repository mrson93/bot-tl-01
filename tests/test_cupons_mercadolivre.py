import json
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch

import main
import mercadolivre
import radar_cupons
import store


class CuponsMercadoLivreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.patches = [patch.object(store, "_DB", Path(self.tmp.name) / "estado.db"),
                        patch.object(mercadolivre.mercadolivre_api, "pode_publicar", return_value=True),
                        patch.object(mercadolivre.mercadolivre_api.config, "MERCADOLIVRE_AFILIADO_PARAMETROS",
                                     "matt_word=canaltabarato&matt_tool=71195511")]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    def test_cupons_da_extensao_viram_vouchers_com_link_de_afiliado_e_melhores_primeiro(self):
        agora = time.time()
        cupons = [
            {"id": "1", "title": "8% OFF Multicategoria", "min_text": "Compra mínima R$ 350",
             "cap_text": "Limite de R$ 60", "min_value": 350, "cap_value": 60, "expires_at": int(agora) + 86400},
            {"id": "2", "title": "20% OFF em LIQUIDA", "min_text": "Sem compra mínima.",
             "cap_text": "Limite de R$ 1.000", "min_value": 0, "cap_value": 1000, "expires_at": int(agora) + 86400},
            {"id": "3", "title": "Vencido", "min_value": 0, "cap_value": 5, "expires_at": int(agora) - 10},
        ]
        with patch.object(mercadolivre.site_publisher, "ler_cupons_mercadolivre", return_value=(agora - 3600, cupons)):
            resultado = mercadolivre.buscar_cupons()
        self.assertEqual(["mercadolivre_cupom_2", "mercadolivre_cupom_1"], [c["id"] for c in resultado])
        primeiro = resultado[0]
        self.assertEqual(("voucher", "", "20% OFF em LIQUIDA"), (primeiro["tipo"], primeiro["codigo"], primeiro["titulo"]))
        self.assertEqual("Sem compra mínima · Limite de R$ 1.000 · ative na página de cupons do Mercado Livre",
                         primeiro["condicao"])
        self.assertTrue(primeiro["destino"].startswith("https://www.mercadolivre.com.br/cupons?"))
        self.assertIn("matt_tool=71195511", primeiro["destino"])

    def test_copia_de_cupons_velha_e_ignorada(self):
        with patch.object(mercadolivre.site_publisher, "ler_cupons_mercadolivre",
                          return_value=(time.time() - 30 * 3600, [{"id": "1", "title": "X OFF"}])):
            self.assertEqual([], mercadolivre.buscar_cupons())

    def test_alertas_de_cupom_respeitam_o_teto_do_dia(self):
        canal = Mock(NOME="Telegram", TRACKING_ID="")
        cupons = [{"id": f"mercadolivre_cupom_{i}", "fonte": "Mercado Livre", "codigo": "", "titulo": f"{i}% OFF",
                   "tipo": "voucher", "condicao": "", "destino": "https://www.mercadolivre.com.br/cupons",
                   "_fonte_obj": mercadolivre} for i in range(5)]
        with patch.object(main.config, "CUPOM_ALERTA_SEPARADO", True), \
             patch.object(main.config, "CUPOM_ALERTAS_POR_RODADA", 1), \
             patch.object(main.config, "CUPOM_ALERTAS_POR_DIA", 2), \
             patch.object(main.site_publisher, "esta_configurado", return_value=False), \
             patch.object(main, "canais_ativos", return_value=[canal]):
            for _ in range(4):
                main.publicar_cupons(cupons)
        self.assertEqual(2, canal.postar_cupom.call_count)


class CupomEncerradoTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.p = patch.object(store, "_DB", Path(self.tmp.name) / "estado.db")
        self.p.start()

    def tearDown(self):
        self.p.stop()
        self.tmp.cleanup()

    def _publicar(self, cid, expira=None):
        store.salvar_cupom({"id": cid, "fonte": "Mercado Livre", "codigo": "", "titulo": "20% OFF em LIQUIDA",
                            "tipo": "voucher", "condicao": "", "destino": "https://www.mercadolivre.com.br/cupons",
                            "ativo_em": None, "expira_em": expira})
        store.registrar_mensagem_cupom(cid, "Telegram", 555)
        store.registrar_mensagem_cupom(cid, "Site")

    def test_cupom_que_sumiu_da_pagina_vira_encerrado_no_telegram_e_no_site(self):
        self._publicar("mercadolivre_cupom_1")
        self._publicar("mercadolivre_cupom_2")
        ainda = [{"id": "mercadolivre_cupom_2", "fonte": "Mercado Livre"}]
        with patch.object(main.telegram_poster, "encerrar_cupom") as editar, \
             patch.object(main.site_publisher, "esta_configurado", return_value=True), \
             patch.object(main.site_publisher, "encerrar_cupom") as site:
            self.assertEqual(2, main.encerrar_cupons(ainda))
            self.assertEqual(0, main.encerrar_cupons(ainda))      # já avisado: não repete
        self.assertEqual("mercadolivre_cupom_1", editar.call_args.args[0]["id"])
        self.assertEqual("555", str(editar.call_args.args[1]))
        site.assert_called_once_with("mercadolivre_cupom_1")

    def test_sem_copia_do_mercado_livre_so_encerra_os_vencidos(self):
        self._publicar("mercadolivre_cupom_1")
        self._publicar("mercadolivre_cupom_3", expira=int(time.time()) - 60)
        with patch.object(main.telegram_poster, "encerrar_cupom") as editar, \
             patch.object(main.site_publisher, "esta_configurado", return_value=True), \
             patch.object(main.site_publisher, "encerrar_cupom"):
            main.encerrar_cupons([])                               # cópia não veio: não dá para dizer que sumiu
        self.assertEqual(["mercadolivre_cupom_3"], [c.args[0]["id"] for c in editar.call_args_list])

    def test_mensagem_do_telegram_fica_encerrada_e_sem_botao(self):
        resposta = Mock()
        resposta.json.return_value = {"ok": True}
        with patch.object(main.telegram_poster.requests, "post", return_value=resposta) as post, \
             patch.object(main.telegram_poster.config, "TELEGRAM_BOT_TOKEN", "t"), \
             patch.object(main.telegram_poster.config, "TELEGRAM_CHANNEL", "@canal"):
            main.telegram_poster.encerrar_cupom({"fonte": "Mercado Livre", "titulo": "20% OFF em LIQUIDA"}, "555")
        corpo = post.call_args.kwargs["json"]
        self.assertTrue(post.call_args.args[0].endswith("/editMessageText"))
        self.assertEqual((555, []), (corpo["message_id"], corpo["reply_markup"]["inline_keyboard"]))
        self.assertIn("CUPOM ENCERRADO · MERCADO LIVRE", corpo["text"])
        self.assertIn("<s>20% OFF em LIQUIDA</s>", corpo["text"])


class CanalDeCuponsTest(unittest.TestCase):
    def _postar(self, cupom):
        resposta = Mock()
        resposta.json.return_value = {"ok": True, "result": {"message_id": 77}}
        with patch.object(main.telegram_poster.requests, "post", return_value=resposta) as post, \
             patch.object(main.telegram_poster.config, "TELEGRAM_BOT_TOKEN", "t"), \
             patch.object(main.telegram_poster.config, "TELEGRAM_CHANNEL", "@CanalTaBarato"), \
             patch.object(main.telegram_poster.config, "TELEGRAM_CANAL_CUPONS", "@CanalTaBaratoCupons"):
            mensagem = main.telegram_poster.postar_cupom(cupom, "https://s.shopee.com.br/x")
        return mensagem, post.call_args.kwargs["json"]

    def test_cupom_com_codigo_vai_para_o_canal_de_cupons_com_copiar_e_ativar(self):
        mensagem, corpo = self._postar({"fonte": "Shopee", "codigo": "BLACK20", "titulo": "R$ 20 OFF"})
        self.assertEqual(77, mensagem)
        self.assertEqual("@CanalTaBaratoCupons", corpo["chat_id"])
        self.assertEqual([[{"text": "📋 Copiar código", "copy_text": {"text": "BLACK20"}}],
                          [{"text": "🛒 Ativar na loja", "url": "https://s.shopee.com.br/x"}]],
                         corpo["reply_markup"]["inline_keyboard"])

    def test_voucher_sem_codigo_tem_so_o_botao_de_ativar(self):
        _, corpo = self._postar({"fonte": "Mercado Livre", "codigo": "", "titulo": "20% OFF em LIQUIDA"})
        self.assertEqual([[{"text": "🎟 Ativar voucher", "url": "https://s.shopee.com.br/x"}]],
                         corpo["reply_markup"]["inline_keyboard"])

    def test_convite_diario_no_canal_de_ofertas(self):
        treze = datetime(2026, 11, 27, 13, 5, tzinfo=main.FUSO_BRASILIA)
        resposta = Mock()
        resposta.json.return_value = {"ok": True}
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(store, "_DB", Path(tmp) / "estado.db"), \
             patch.object(main.telegram_poster, "esta_configurada", return_value=True), \
             patch.object(main.config, "TELEGRAM_CANAL_CUPONS", "@CanalTaBaratoCupons"), \
             patch.object(main.requests, "post", return_value=resposta) as post:
            self.assertTrue(main.enviar_convite_cupons_se_preciso(treze))
            self.assertFalse(main.enviar_convite_cupons_se_preciso(treze))          # uma vez por dia
            self.assertFalse(main.enviar_convite_cupons_se_preciso(treze.replace(hour=15)))
        botao = post.call_args.kwargs["json"]["reply_markup"]["inline_keyboard"][0][0]
        self.assertEqual("https://t.me/CanalTaBaratoCupons", botao["url"])


class RadarCuponsTest(unittest.TestCase):
    PAGINA = """
    <div class="tgme_widget_message_text js-message_text">🔥 Shopee: use o cupom <b>BLACK20</b> acima de R$ 99</div>
    <a><time datetime="2026-11-26T15:00:00+00:00"></time></a>
    <div class="tgme_widget_message_text js-message_text">Amazon cupom: PRIME30 · frete grátis hoje</div>
    <a><time datetime="2026-11-26T16:00:00+00:00"></time></a>
    <div class="tgme_widget_message_text js-message_text">Mercado Livre código: VELHO10</div>
    <a><time datetime="2026-11-20T16:00:00+00:00"></time></a>
    """

    def test_extrai_codigos_novos_por_loja_e_ignora_mensagens_antigas(self):
        self.assertEqual(["BLACK20"], radar_cupons.codigos("use o cupom BLACK20 acima de R$ 99"))
        self.assertEqual([], radar_cupons.codigos("cupom de 100 reais OFF hoje"))
        agora = datetime(2026, 11, 26, 18, tzinfo=timezone.utc).timestamp()
        sessao = Mock(get=Mock(return_value=Mock(status_code=200, text=self.PAGINA)))
        achados = radar_cupons.ler_canal("canal_teste", agora, sessao)
        self.assertEqual([("Shopee", "BLACK20"), ("Amazon", "PRIME30")], [(a["loja"], a["codigo"]) for a in achados])
        with self.assertRaises(ValueError):
            radar_cupons.ler_canal("../x", agora, sessao)

    def test_manda_so_os_novos_ao_admin_nas_horas_marcadas(self):
        sessao = Mock(get=Mock(return_value=Mock(status_code=200, text=self.PAGINA)))
        dez_horas = datetime(2026, 11, 26, 13, 5, tzinfo=timezone.utc)       # 10:05 em Brasília
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(store, "_DB", Path(tmp) / "estado.db"), \
             patch.object(radar_cupons.config, "RADAR_CUPONS_CANAIS", ("@canal_teste",)), \
             patch.object(radar_cupons.config, "RADAR_CUPONS_HORAS", [10, 15]), \
             patch.object(radar_cupons.time, "sleep"), \
             patch.object(radar_cupons.monitor, "enviar_mensagem_privada") as enviar:
            self.assertEqual(0, radar_cupons.executar(dez_horas.replace(hour=12), sessao))   # 09:05: fora da hora
            self.assertEqual(2, radar_cupons.executar(dez_horas, sessao))
            self.assertEqual(0, radar_cupons.executar(dez_horas.replace(minute=40), sessao))  # mesma hora
            self.assertEqual(0, radar_cupons.executar(dez_horas.replace(hour=18), sessao))     # 15:05: nada novo
        texto = enviar.call_args.args[0]
        self.assertIn("Shopee · BLACK20 — @canal_teste", texto)
        self.assertIn("/cupom", texto)
        self.assertEqual(1, enviar.call_count)

    def test_modo_a_cada_10_minutos_e_quieto_de_madrugada(self):
        sessao = Mock(get=Mock(return_value=Mock(status_code=200, text=self.PAGINA)))
        base = datetime(2026, 11, 26, 13, 0, tzinfo=timezone.utc)            # 10:00 em Brasília
        from datetime import timedelta
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(store, "_DB", Path(tmp) / "estado.db"), \
             patch.object(radar_cupons.config, "RADAR_CUPONS_CANAIS", ("canal_teste",)), \
             patch.object(radar_cupons.config, "RADAR_CUPONS_INTERVALO_MIN", 10), \
             patch.object(radar_cupons.time, "sleep"), \
             patch.object(radar_cupons.monitor, "enviar_mensagem_privada"):
            self.assertEqual(2, radar_cupons.executar(base, sessao))
            self.assertEqual(1, sessao.get.call_count)
            radar_cupons.executar(base + timedelta(minutes=5), sessao)       # cedo demais
            self.assertEqual(1, sessao.get.call_count)
            radar_cupons.executar(base + timedelta(minutes=10), sessao)
            self.assertEqual(2, sessao.get.call_count)
            radar_cupons.executar(datetime(2026, 11, 27, 5, 0, tzinfo=timezone.utc), sessao)   # 02:00
            self.assertEqual(2, sessao.get.call_count)

    def test_codigos_no_formato_do_ingresso_e_sem_palavras_comuns(self):
        self.assertEqual(["VALEHOJE", "CHEGOUOFF"],
                         radar_cupons.codigos("🎟️ VALEHOJE R$300 OFF acima de R$2299 🎟️ CHEGOUOFF 10% OFF"))
        self.assertEqual([], radar_cupons.codigos("CUPONS!! MERCADO LIVRE Usa logoooooo"))
        self.assertEqual(["L40CTTM249BF"], radar_cupons.codigos("Usa logoooooo: 🎟️ L40CTTM249BF 40% OFF máx R$150"))

    def test_avisa_o_admin_quando_o_canal_diz_que_esgotou(self):
        self.assertEqual(["VALEHOJE"], radar_cupons.esgotados(["VALEHOJE ESGOTOU 😭"], {"VALEHOJE", "OUTRO10"}))
        self.assertEqual([], radar_cupons.esgotados(["Corre que está esgotando: VALEHOJE"], {"VALEHOJE"}))
        pagina2 = self.PAGINA + """
        <div class="tgme_widget_message_text js-message_text">BLACK20 esgotou, galera</div>
        <a><time datetime="2026-11-26T17:00:00+00:00"></time></a>"""
        sessoes = [Mock(get=Mock(return_value=Mock(status_code=200, text=t))) for t in (self.PAGINA, pagina2, pagina2)]
        base = datetime(2026, 11, 26, 13, 0, tzinfo=timezone.utc)
        from datetime import timedelta
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(store, "_DB", Path(tmp) / "estado.db"), \
             patch.object(radar_cupons.config, "RADAR_CUPONS_CANAIS", ("canal_teste",)), \
             patch.object(radar_cupons.config, "RADAR_CUPONS_INTERVALO_MIN", 10), \
             patch.object(radar_cupons.time, "sleep"), \
             patch.object(radar_cupons.monitor, "enviar_mensagem_privada") as enviar:
            radar_cupons.executar(base, sessoes[0])
            radar_cupons.executar(base + timedelta(hours=4, minutes=10), sessoes[1])
            radar_cupons.executar(base + timedelta(hours=4, minutes=20), sessoes[2])   # não repete
        avisos = [c.args[0] for c in enviar.call_args_list if c.args[0].startswith("❌")]
        self.assertEqual(1, len(avisos))
        self.assertIn("BLACK20 (@canal_teste)", avisos[0])

    def test_sem_canais_o_radar_fica_desligado(self):
        with patch.object(radar_cupons.config, "RADAR_CUPONS_CANAIS", ()):
            self.assertEqual(0, radar_cupons.executar())


if __name__ == "__main__":
    unittest.main()
