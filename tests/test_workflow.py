import unittest
from pathlib import Path


class WorkflowTest(unittest.TestCase):
    def test_estado_remoto_substitui_commits_do_banco(self):
        workflow = Path(".github/workflows/bot.yml").read_text(encoding="utf-8")
        # A primeira execução de uma instalação nova ainda não tem artefato.
        self.assertIn("python estado_remoto.py restaurar", workflow)
        self.assertNotIn("python estado_remoto.py restaurar --obrigatorio", workflow)
        self.assertIn("actions/upload-artifact@v7", workflow)
        self.assertIn("python estado_remoto.py preparar", workflow)
        self.assertIn("path: postadas.db.enc", workflow)
        self.assertIn("BOT_STATE_KEY: ${{ secrets.BOT_STATE_KEY }}", workflow)
        self.assertNotIn("git push", workflow)
        self.assertNotIn("python -m unittest", workflow)
        self.assertNotIn("schedule:", workflow)
        self.assertIn("inputs.executar_bot == true", workflow)
        self.assertIn("controlador Cloudflare", workflow)
        self.assertIn('MIN_MINUTOS_ENTRE_POSTS: "0"', workflow)
        self.assertIn('MAX_MINUTOS_ENTRE_POSTS: "0"', workflow)
        self.assertIn('MIN_MINUTOS_FORA_PICO: "0"', workflow)
        self.assertIn('MAX_MINUTOS_FORA_PICO: "0"', workflow)

    def test_testes_rodam_em_ci_separado(self):
        workflow = Path(".github/workflows/ci.yml").read_text(encoding="utf-8")
        self.assertIn("pull_request:", workflow)
        self.assertIn("python -m unittest discover -v", workflow)
        self.assertIn("node --test telegram-control/test/*.test.mjs", workflow)
        self.assertIn("node --check", workflow)

    def test_monitor_roda_somente_uma_vez_por_dia(self):
        workflow = Path(".github/workflows/monitor.yml").read_text(encoding="utf-8")
        self.assertIn('cron: "40 13 * * *"', workflow)
        self.assertEqual(1, workflow.count("- cron:"))
        self.assertIn("vars.BOT_MODE != 'pausado'", workflow)

    def test_execucao_manual_pode_enviar_somente_relatorio(self):
        workflow = Path(".github/workflows/bot.yml").read_text(encoding="utf-8")
        self.assertIn("executar_bot:", workflow)
        self.assertIn("somente_relatorio:", workflow)
        self.assertIn("python main.py --relatorio", workflow)
        self.assertIn("RELATORIO_HORA: ${{ vars.RELATORIO_HORA || '11' }}", workflow)
        self.assertIn("RELATORIO_MINUTO: ${{ vars.RELATORIO_MINUTO || '30' }}", workflow)
        self.assertIn('RELATORIO_AUTOMATICO_NA_EXECUCAO: "false"', workflow)
        self.assertIn("inputs.somente_relatorio == true", workflow)

    def test_configuracoes_operacionais_vem_de_variaveis_seguras(self):
        workflow = Path(".github/workflows/bot.yml").read_text(encoding="utf-8")
        for nome in ("SHOPEE_ATIVA", "ALIEXPRESS_ATIVA", "PESO_SHOPEE",
                     "MIN_DISCOUNT", "MAX_POSTS_PER_RUN", "MAX_POSTS_PER_RUN_FORA_PICO", "HORA_INICIO"):
            self.assertIn("vars." + nome, workflow)
        self.assertIn("vars.INTERVALO_ENTRE_POSTS_MINUTOS", workflow)
        self.assertIn("github.event.repository.visibility == 'private'", workflow)
        self.assertIn("timeout-minutes: 15", workflow)
        scheduler = Path("telegram-control/scheduler/wrangler.jsonc").read_text(
            encoding="utf-8")
        self.assertIn('"crons": ["* * * * *"]', scheduler)


if __name__ == "__main__":
    unittest.main()
