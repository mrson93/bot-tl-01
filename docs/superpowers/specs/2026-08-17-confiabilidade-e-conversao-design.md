# Confiabilidade e conversão do bot de ofertas

## Objetivo

Melhorar a regularidade das postagens, a confiança no conteúdo e a recuperação de falhas sem acrescentar serviços pagos. O bot continuará executando no GitHub Actions, publicará uma oferta por rodada e usará o SQLite versionado no próprio repositório.

## Escopo

- Agendamento persistente com intervalo real de 12 a 18 minutos nos horários de pico e intervalo multiplicado por `ESPERA_FORA_PICO` fora deles.
- Histórico por oferta e por canal, com nova tentativa apenas nos canais que falharam.
- Repetição antecipada quando o preço cair pelo menos 15% desde a última publicação bem-sucedida.
- Preço anterior exibido somente quando a plataforma o fornecer.
- Padronização das chamadas, títulos e preços no Telegram e Bluesky.
- Fallback sem imagem, tentativas curtas para erros temporários e falhas visíveis no workflow.
- Relatório diário privado opcional no Telegram.
- Testes automatizados e documentação atualizada.

## Decisões de arquitetura

### Estado e migração

`postadas.db` continuará sendo a única persistência. `store.py` fará uma migração idempotente ao abrir o banco, preservando a tabela antiga `postadas` e seus registros. A tabela passará a guardar o último preço e o último desconto. Uma nova tabela de entregas registrará oferta, canal, situação, número de tentativas, erro e horário. Uma tabela simples de configuração persistirá `next_post_at` e o último relatório diário enviado.

O banco antigo não será apagado. Registros legados continuarão bloqueando repetições pelo período configurado; preço desconhecido não dará direito à repetição antecipada.

### Agendamento

Depois de ao menos uma entrega bem-sucedida, o bot sorteará e persistirá `next_post_at`. No pico, o sorteio será inclusivo entre `MIN_MINUTOS_ENTRE_POSTS` e `MAX_MINUTOS_ENTRE_POSTS`. Fora do pico, os dois limites serão multiplicados por `ESPERA_FORA_PICO` antes do sorteio.

Em `--once`, uma execução anterior a `next_post_at` termina sem buscar ofertas. Uma execução atrasada publica assim que possível. Se nenhuma oferta puder ser publicada, o bot não consumirá o intervalo normal: gravará uma nova tentativa após `RETRY_MINUTES`. O cron externo deve chamar o workflow com frequência suficiente para aproximar o horário persistido; recomenda-se a cada cinco minutos.

### Seleção e repetição

Uma oferta será elegível quando nunca tiver sido publicada, quando tiver ultrapassado `DIAS_ANTES_DE_REPETIR`, ou quando seu preço atual for pelo menos `QUEDA_PRECO_REPOST_PERCENT` menor que o último preço registrado. A queda de preço nunca permite duas publicações do mesmo item no mesmo dia.

Ofertas inéditas continuam prioritárias. Na ausência delas, quedas reais de preço vêm antes da repescagem por antiguidade. O peso das lojas e a pontuação por desconto e comissão permanecem.

### Entrega por canal

Cada canal receberá seu próprio link rastreado. Antes da publicação, o bot verificará se aquele canal já recebeu a versão atual da oferta. Sucesso e falha serão registrados separadamente. Uma falha no Bluesky não impedirá o registro do sucesso no Telegram e será tentada novamente em execução posterior.

As requisições de publicação terão até três tentativas para erros de rede, HTTP 429 e HTTP 5xx, com espera curta crescente. Erros permanentes de autenticação ou conteúdo não serão repetidos na mesma execução.

No Telegram, falha em `sendPhoto` causada pela imagem acionará `sendMessage` com o mesmo texto e botão. No Bluesky, imagem ausente, inválida ou maior que o limite não bloqueará o post de texto.

### Conteúdo

As chamadas obedecerão exatamente:

- abaixo de 40%: nenhuma chamada;
- de 40% até 70%, inclusive: `🔥 OFERTA`;
- acima de 70%: `🚨 BAIXOU MUITO`.

O bloco `De R$ ... por R$ ...` será usado apenas quando `precoOriginal` vier da API e for maior que o preço atual. Caso contrário, o texto mostrará o preço final em destaque e, se disponível, o percentual de desconto. Nenhum preço anterior será reconstruído matematicamente.

A alegação genérica de parcelamento será removida. O título não terá limite no Telegram. A limpeza removerá espaços, repetições adjacentes e ruído promocional de início/fim, mas não cortará no primeiro separador. No Bluesky, o título será encurtado somente para respeitar os 300 caracteres, sem cortar palavras.

Os números usarão o padrão brasileiro em todos os canais. O Botize não pode ser alterado pelo código deste repositório; sua padronização continuará dependendo do modelo configurado no próprio Botize. A documentação fornecerá o modelo equivalente.

### Relatório e observabilidade

Quando `TELEGRAM_ADMIN_ID` estiver preenchido, a primeira execução após `RELATORIO_HORA` enviará ao administrador um resumo do dia anterior: ofertas publicadas, entregas por canal, falhas, distribuição por loja e repetições por queda de preço. Sem essa variável, o recurso ficará desativado sem erro.

Logs indicarão claramente oferta escolhida, motivo da elegibilidade, horário da próxima postagem, fallback de imagem e falhas por canal. Falha ao persistir e enviar `postadas.db` no workflow fará a Action falhar; não haverá `continue-on-error` nessa etapa.

### Segurança

Nenhum segredo será incluído em código, documentação, logs ou testes. `.env` e `postadas.db` continuarão ignorados localmente, embora o workflow envie o banco explicitamente. A documentação orientará a rotação de todos os tokens e segredos já compartilhados fora do GitHub Secrets.

## Configurações novas

- `QUEDA_PRECO_REPOST_PERCENT=15`
- `TELEGRAM_ADMIN_ID=`
- `RELATORIO_HORA=8`
- `HTTP_MAX_TENTATIVAS=3`

As configurações existentes continuarão válidas. Os padrões serão seguros caso as novas variáveis não sejam cadastradas imediatamente no GitHub.

## Testes

Será usada a biblioteca padrão `unittest`, sem nova dependência. Os testes cobrirão migração do banco, janela de repetição, queda de preço, estado por canal, agendamento persistente, limites das chamadas, preço anterior confiável, título não cortado e fallback do Telegram. Requisições externas serão substituídas por respostas locais controladas.

O workflow executará os testes antes de `python main.py --once`. Uma falha impedirá postagem e atualização do banco.

## Critérios de aceitação

- Uma postagem bem-sucedida grava um único próximo horário e execuções precoces não publicam.
- Falha em um canal não elimina a tentativa futura desse canal.
- O mesmo produto não aparece duas vezes no mesmo dia.
- Uma queda de pelo menos 15% permite republicação antes de sete dias, mas apenas a partir do dia seguinte.
- Preço anterior inventado e parcelamento não confirmado não aparecem.
- 70% usa `OFERTA`; somente valores acima de 70% usam `BAIXOU MUITO`.
- Telegram publica texto quando a imagem falha.
- O relatório privado é enviado no máximo uma vez por dia quando configurado.
- Todos os testes passam no ambiente local e no GitHub Actions.
