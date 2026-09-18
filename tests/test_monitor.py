import os
import unittest
from datetime import datetime, timezone
from unittest.mock import Mock, patch

import monitor
import store


class MonitorTest(unittest.TestCase):
    def test_resumo_privado_identifica_sucesso_e_falha_por_canal(self):
        resposta = Mock()
        resposta.json.return_value = {"ok": True}
        sessao = Mock(post=Mock(return_value=resposta))
        with patch.object(monitor.config, "TELEGRAM_ADMIN_ID", "123"), \
             patch.object(monitor.config, "TELEGRAM_BOT_TOKEN", "token"):
            self.assertTrue(monitor.enviar_resumo_publicacao(
                "Shopee", "Produto", {"Telegram": "✅ publicado", "Facebook": "❌ falhou"}, sessao))
        mensagem = sessao.post.call_args.kwargs["json"]["text"]
        self.assertIn("Telegram: ✅ publicado", mensagem)
        self.assertIn("Facebook: ❌ falhou", mensagem)

    def test_estoque_lista_alerta_uma_vez_e_rearma(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(store, "_DB", Path(tmp) / "estado.db"), \
             patch.object(monitor, "_enviar_privado", return_value=True) as enviar:
            self.assertTrue(monitor.avisar_estoque_lista("Mercado Livre", 5))
            self.assertFalse(monitor.avisar_estoque_lista("Mercado Livre", 4))
            self.assertFalse(monitor.avisar_estoque_lista("Mercado Livre", 8))
            self.assertTrue(monitor.avisar_estoque_lista("Mercado Livre", 5))
            self.assertEqual(2, enviar.call_count)

    def test_alerta_uma_vez_apos_tres_falhas_e_rearma_com_sucesso(self):
        with patch.object(monitor.config, "FALHAS_CONSECUTIVAS_ALERTA", 3), \
             patch.object(monitor.store, "falhas_consecutivas", return_value=3), \
             patch.object(monitor.store, "falha_canal_ja_alertada",
                          side_effect=[False, True]), \
             patch.object(monitor.store, "marcar_falha_canal_alertada") as marcar, \
             patch.object(monitor.store, "limpar_alerta_falha_canal") as limpar, \
             patch.object(monitor, "enviar_alerta", return_value=True) as enviar:
            self.assertTrue(monitor.registrar_resultado_canal(
                "Facebook", False, "token expirado"
            ))
            self.assertFalse(monitor.registrar_resultado_canal(
                "Facebook", False, "token expirado"
            ))
            self.assertFalse(monitor.registrar_resultado_canal(
                "Facebook", True
            ))
        enviar.assert_called_once()
        marcar.assert_called_once_with("Facebook")
        limpar.assert_called_once_with("Facebook")

    def test_rejeita_repositorio_invalido(self):
        with patch.dict("os.environ", {
            "GITHUB_REPOSITORY": "dono/repositorio/outro",
            "GH_TOKEN": "token",
        }, clear=True):
            with self.assertRaisesRegex(RuntimeError, "invalido"):
                monitor.verificar_execucoes()

    def test_alerta_quando_execucao_fica_atrasada(self):
        resposta = Mock()
        resposta.json.return_value = {"workflow_runs": [{
            "created_at": "2026-08-22T10:00:00Z",
            "status": "completed", "conclusion": "success",
        }]}
        resposta.raise_for_status.return_value = None
        sessao = Mock(get=Mock(return_value=resposta))
        with patch.dict(os.environ, {"GITHUB_REPOSITORY": "dono/repo",
                                     "GH_TOKEN": "segredo"}):
            alerta = monitor.verificar_execucoes(
                datetime(2026, 8, 22, 10, 30, tzinfo=timezone.utc), sessao, 20
            )
        self.assertIn("30 minutos", alerta)
        self.assertNotIn("segredo", alerta)

    def test_execucao_recente_e_bem_sucedida_nao_alerta(self):
        resposta = Mock()
        resposta.json.return_value = {"workflow_runs": [{
            "created_at": "2026-08-22T10:15:00Z",
            "status": "completed", "conclusion": "success",
        }]}
        resposta.raise_for_status.return_value = None
        sessao = Mock(get=Mock(return_value=resposta))
        with patch.dict(os.environ, {"GITHUB_REPOSITORY": "dono/repo",
                                     "GH_TOKEN": "segredo"}):
            self.assertEqual("", monitor.verificar_execucoes(
                datetime(2026, 8, 22, 10, 20, tzinfo=timezone.utc), sessao, 20
            ))

    def test_ignora_chamada_antiga_do_cron_marcada_como_skipped(self):
        resposta = Mock()
        resposta.json.return_value = {"workflow_runs": [
            {"created_at": "2026-08-22T10:19:00Z", "status": "completed",
             "conclusion": "skipped"},
            {"created_at": "2026-08-22T10:15:00Z", "status": "completed",
             "conclusion": "success"},
        ]}
        resposta.raise_for_status.return_value = None
        sessao = Mock(get=Mock(return_value=resposta))
        with patch.dict(os.environ, {"GITHUB_REPOSITORY": "dono/repo",
                                     "GH_TOKEN": "segredo"}):
            self.assertEqual("", monitor.verificar_execucoes(
                datetime(2026, 8, 22, 10, 20, tzinfo=timezone.utc), sessao, 20
            ))
