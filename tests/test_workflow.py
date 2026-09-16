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
        self.assertIn("AMAZON_LIST_URL: ${{ vars.AMAZON_LIST_URL }}", workflow)

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

    def test_execucao_manual_pode_disparar_campanha_individual(self):
        workflow = Path(".github/workflows/bot.yml").read_text(encoding="utf-8")
        self.assertIn("campanha:", workflow)
        self.assertIn("inputs.campanha != ''", workflow)
        self.assertIn("inputs.campanha == 'shopee_vip'", workflow)
        self.assertIn("python main.py --campanha shopee_vip", workflow)

    def test_configuracoes_operacionais_vem_de_variaveis_seguras(self):
        workflow = Path(".github/workflows/bot.yml").read_text(encoding="utf-8")
        for nome in ("SHOPEE_ATIVA", "ALIEXPRESS_ATIVA", "PESO_SHOPEE",
                     "MIN_DISCOUNT", "MAX_POSTS_PER_RUN", "MAX_POSTS_PER_RUN_FORA_PICO", "HORA_INICIO",
                     "SHOPEE_VIP_URL", "SHOPEE_VIP_ATIVO", "SHOPEE_VIP_DIAS",
                     "SHOPEE_VIP_HORAS"):
            self.assertIn("vars." + nome, workflow)
        self.assertIn("vars.INTERVALO_ENTRE_POSTS_MINUTOS", workflow)
        self.assertIn("github.event.repository.visibility == 'private'", workflow)
        self.assertIn("timeout-minutes: 15", workflow)
        scheduler = Path("telegram-control/scheduler/wrangler.jsonc").read_text(
            encoding="utf-8")
        self.assertIn('"crons": ["* * * * *"]', scheduler)

    def test_facebook_comeca_desligado_e_token_fica_em_secret(self):
        workflow = Path(".github/workflows/bot.yml").read_text(encoding="utf-8")
        self.assertIn("FACEBOOK_PAGE_ACCESS_TOKEN: ${{ secrets.FACEBOOK_PAGE_ACCESS_TOKEN }}", workflow)
        self.assertIn("FACEBOOK_ATIVO: ${{ vars.FACEBOOK_ATIVO || 'false' }}", workflow)
        self.assertIn("FACEBOOK_PAGE_ID: ${{ vars.FACEBOOK_PAGE_ID }}", workflow)
        self.assertIn("FACEBOOK_MAX_POSTS_DIA: ${{ vars.FACEBOOK_MAX_POSTS_DIA || '4' }}", workflow)

        controle = Path("telegram-control/wrangler.jsonc").read_text(encoding="utf-8")
        self.assertIn('"name": "bot-tl-01"', controle)
        self.assertNotIn("FACEBOOK_PAGE_ACCESS_TOKEN", controle)

    def test_instagram_reutiliza_token_protegido_e_comeca_desligado(self):
        workflow = Path(".github/workflows/bot.yml").read_text(encoding="utf-8")
        self.assertIn("INSTAGRAM_STORIES_ATIVO: ${{ vars.INSTAGRAM_STORIES_ATIVO || 'false' }}", workflow)
        self.assertIn('INSTAGRAM_TRACKING_ID: "instagram"', workflow)
        self.assertIn('INSTAGRAM_USERNAME: "ofertascanaltabarato"', workflow)
        self.assertIn("INSTAGRAM_MAX_STORIES_DIA: ${{ vars.INSTAGRAM_MAX_STORIES_DIA || '0' }}", workflow)
        self.assertIn("INSTAGRAM_DIRECT_ATIVO: ${{ vars.INSTAGRAM_DIRECT_ATIVO || 'false' }}", workflow)
        self.assertEqual(1, workflow.count("FACEBOOK_PAGE_ACCESS_TOKEN: ${{ secrets.FACEBOOK_PAGE_ACCESS_TOKEN }}"))

    def test_direct_instagram_valida_assinatura_e_nao_guarda_mensagem(self):
        migration = Path("site/migrations/0009_instagram_direct.sql").read_text(encoding="utf-8")
        webhook = Path("site/functions/api/meta-webhook.js").read_text(encoding="utf-8")
        helper = Path("site/functions/_instagram_dm.js").read_text(encoding="utf-8")
        pages_config = Path("site/wrangler.toml.example").read_text(encoding="utf-8")
        self.assertIn("instagram_story_offers", migration)
        self.assertIn("instagram_dm_events", migration)
        self.assertIn("X-Hub-Signature-256", webhook)
        self.assertIn("META_APP_SECRET", webhook)
        self.assertIn("instagram_manage_messages", Path("site/README.md").read_text(encoding="utf-8"))
        self.assertNotIn("message_text", migration)
        self.assertIn("INSERT OR IGNORE", helper)
        self.assertIn("go.canaltabarato.com.br", pages_config)

    def test_site_tem_armazenamento_temporario_para_cartao_do_story(self):
        migration = Path("site/migrations/0008_story_assets.sql").read_text(encoding="utf-8")
        upload = Path("site/functions/api/story-assets.js").read_text(encoding="utf-8")
        serving = Path("site/functions/story-assets/[id].js").read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE IF NOT EXISTS story_assets", migration)
        self.assertIn("MAX_IMAGE_BYTES=850_000", upload)
        self.assertIn("authorized(request,env.PUBLISH_TOKEN)", upload)
        self.assertIn("crypto.randomUUID()", upload)
        self.assertIn("expires_at>?", serving)
        self.assertIn("image/jpeg", serving)
        self.assertIn("Content-Length", serving)
        self.assertIn("Uint8Array.from(row.image)", serving)
        self.assertIn("onRequestHead", serving)


if __name__ == "__main__":
    unittest.main()
