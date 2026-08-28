# Executar gratuitamente no GitHub Actions

O computador não precisa ficar ligado. O cron-job.org chama o workflow e o código decide se chegou a hora da próxima oferta.

## GitHub Secrets necessários

Cadastre em **Settings → Secrets and variables → Actions** somente os serviços usados:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ADMIN_ID` (opcional)
- `SHOPEE_APP_ID` e `SHOPEE_SECRET`
- `ALIEXPRESS_APP_KEY` e `ALIEXPRESS_APP_SECRET`
- `BLUESKY_APP_PASSWORD`
- credenciais Amazon, quando a API estiver ativa

Nunca envie `.env`, tokens ou senhas em commits, prints e mensagens.

## Cron-job.org

O workflow possui grades Econômica e Normal. A variável `BOT_MODE`, que também
pode ser controlada pelo painel privado do Telegram, seleciona a única grade que
reserva runner. Para execução manual, marque
`executar_bot`; para enviar somente o relatório, marque `somente_relatorio`.
Chamadas externas sem essas opções são ignoradas antes de reservar runner.

Resposta HTTP `204` significa que o GitHub aceitou a chamada.

## Atualizar o bot

Depois de um commit chegar à `main`, não é necessário alterar o cron. Execute **Actions → Bot de Ofertas → Run workflow** uma vez para conferir.

O workflow primeiro executa todos os testes. Se falharem, nenhuma oferta é publicada. Se o histórico não puder ser salvo no GitHub, a execução fica vermelha em vez de esconder o problema.

## Restaurar o código anterior

O backup desta atualização está em `codex/backup-antes-melhorias-2026-08-17`. Não apague essa branch até observar o bot funcionando por alguns dias.
