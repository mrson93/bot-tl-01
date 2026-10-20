# Próximos passos

## Antes de ativar esta versão

- Rotacionar tokens e segredos que já apareceram em conversas ou prints.
- Criar o secret opcional `TELEGRAM_ADMIN_ID` para receber o resumo diário.
- [x] Usar cron-jobs econômicos: 15 minutos no pico e 30 minutos fora dele.
- Executar manualmente o workflow e confirmar os testes, Telegram e Bluesky.

## Depois de ativar

- Observar por três dias se os intervalos estão concentrados nos picos.
- Comparar as conversões e comissões de `telegram` e `bsky` no relatório privado.
- Conferir falhas, distribuição por loja e plataformas com posts sem conversão.
- Manter o backup até essa observação terminar.

## Melhorias orientadas pelo relatório

- [x] Guardar horário, faixa de preço, desconto, categoria e produtos convertidos.
- [x] Alertar muitas publicações sem conversão.
- [x] Capturar cupom e preço de aplicativo somente quando informados pela API.
- [x] Comparar todas as lojas e usar conversão histórica na seleção.
- [x] Usar chamadas por categoria e um único caminho de compra.
- [x] Preparar redirecionador próprio com fallback para o afiliado oficial.
- [ ] Aprovar um domínio nos programas, implantar o Worker e ativar `SHORTLINK_*`.
- [x] Reduzir as chamadas do cron-job.org para cerca de 52 por dia.
- [x] Evitar produtos muito parecidos e categorias repetidas em sequência.
- [x] Separar os testes da execução frequente do bot.
- [x] Preparar e validar a migração do SQLite para artefato remoto privado.
- [x] Adicionar monitor de execução e alertas de falhas consecutivas.
- [x] Preservar séries diárias e tendências de até 180 dias.
- [x] Criar teste A/B rastreável sem dados pessoais.
- [x] Normalizar a seleção por posts, comissão, recência e cancelamentos.

O Mercado Livre usa a lista pública de recomendações do próprio afiliado como fila curada, preservando o link rastreado que a plataforma gera. A Shein continua fora da automação enquanto não houver acesso oficial adequado à API de afiliados.
